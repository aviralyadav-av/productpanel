import type { Faq, Prisma } from "@prisma/client";

import { notFound, validationError } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";
import { sanitizeHtml } from "@/lib/sanitize/html";

import { normalizeGroupName, type FaqFlag, type FaqFormValues, type FaqPatchValues } from "./schemas";

/**
 * FAQ mutations (blueprint §4.8, §11.21, D13).
 *
 * Positions are GLOBAL and contiguous: the storefront (`getFaqGroups`) orders
 * rows by `position` and lists groups in order of first appearance, so the
 * only way to give the operator control over both the question order inside
 * a group and the order of the groups themselves is to renumber every row
 * after each structural change. Twelve to a few hundred rows - one
 * `updateMany` per row inside the transaction is fine.
 *
 * Answers are sanitised with the `basic` profile: an FAQ answer is a short
 * paragraph with links and emphasis, not an article; headings and tables
 * would break the accordion layout.
 *
 * No `server-only` / `next/*` imports: cache invalidation and revalidatePath
 * happen in actions.ts and the REST routes after the transaction commits.
 */

type Db = Prisma.TransactionClient;

const ORDER: Prisma.FaqOrderByWithRelationInput[] = [{ position: "asc" }, { createdAt: "asc" }];

function snapshot(row: Faq): Record<string, unknown> {
  const { createdAt, updatedAt, ...rest } = row;
  void createdAt;
  void updatedAt;
  return rest;
}

async function loadFaq(tx: Db, id: string): Promise<Faq> {
  const row = await tx.faq.findUnique({ where: { id } });
  if (!row) throw notFound("FAQ");
  return row;
}

/** Group names in storefront order (by the position of each group's first row). */
export async function listGroupOrder(tx: Db): Promise<string[]> {
  const rows = await tx.faq.findMany({ orderBy: ORDER, select: { group: true } });
  const seen: string[] = [];
  for (const row of rows) {
    const name = normalizeGroupName(row.group);
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

/**
 * Rewrite every position so rows are contiguous, groups keep (or take) the
 * given order and questions keep their relative order inside a group.
 * `within` overrides the question order for one group (a drag-and-drop
 * result); ids missing from it are appended in their current order.
 */
async function renumber(tx: Db, opts: { groupOrder?: string[]; within?: { group: string; ids: string[] } } = {}): Promise<number> {
  const rows = await tx.faq.findMany({ orderBy: ORDER, select: { id: true, group: true, position: true } });
  const byGroup = new Map<string, Array<{ id: string; position: number }>>();
  for (const row of rows) {
    const name = normalizeGroupName(row.group);
    const list = byGroup.get(name) ?? [];
    list.push({ id: row.id, position: row.position });
    byGroup.set(name, list);
  }

  const currentOrder = [...byGroup.keys()];
  const wanted = (opts.groupOrder ?? []).map(normalizeGroupName).filter((name) => byGroup.has(name));
  const groupOrder = [...wanted, ...currentOrder.filter((name) => !wanted.includes(name))];

  let next = 0;
  let changed = 0;
  for (const name of groupOrder) {
    let list = byGroup.get(name) ?? [];
    if (opts.within && opts.within.group === name) {
      const requested = opts.within.ids.filter((id) => list.some((row) => row.id === id));
      const rest = list.filter((row) => !requested.includes(row.id));
      list = [...requested.map((id) => list.find((row) => row.id === id)!), ...rest];
    }
    for (const row of list) {
      if (row.position !== next) {
        await tx.faq.update({ where: { id: row.id }, data: { position: next } });
        changed += 1;
      }
      next += 1;
    }
  }
  return changed;
}

function cleanAnswer(html: string): string {
  const clean = sanitizeHtml(html, "basic");
  if (!clean) throw validationError({ answer: "The answer is empty once unsupported markup is removed." });
  return clean;
}

export async function createFaq(input: FaqFormValues, actor: AuditActor): Promise<Faq> {
  return db.$transaction(async (tx) => {
    const group = normalizeGroupName(input.group);
    /**
     * A new question joins the END of its group - or the end of the board when
     * the group itself is new. `position` is a 32-bit Int, so the placeholder
     * is a real neighbouring position (never a sentinel like MAX_SAFE_INTEGER,
     * which Postgres rejects outright); the row briefly ties with the first row
     * of the following group and `renumber` below settles the whole board back
     * into contiguous positions, grouping by name and keeping ties in
     * creation order - which puts this row last inside its own group.
     */
    const [lastInGroup, lastOverall] = await Promise.all([
      tx.faq.findFirst({ where: { group }, orderBy: { position: "desc" }, select: { position: true } }),
      tx.faq.findFirst({ orderBy: { position: "desc" }, select: { position: true } }),
    ]);
    const created = await tx.faq.create({
      data: {
        question: input.question,
        answer: cleanAnswer(input.answer),
        group,
        enabled: input.enabled,
        isFeatured: input.isFeatured,
        position: (lastInGroup?.position ?? lastOverall?.position ?? -1) + 1,
      },
    });
    await renumber(tx);
    const row = await loadFaq(tx, created.id);
    await writeAudit(tx, {
      actor,
      action: "faq.create",
      entityType: "Faq",
      entityId: row.id,
      entityLabel: row.question,
      summary: `Added FAQ "${row.question}" to group "${row.group}".`,
      diff: diffOf(null, snapshot(row)),
    });
    return row;
  });
}

export async function updateFaq(id: string, patch: FaqPatchValues, actor: AuditActor): Promise<Faq> {
  return db.$transaction(async (tx) => {
    const before = await loadFaq(tx, id);
    const group = patch.group !== undefined ? normalizeGroupName(patch.group) : before.group;
    const movedGroup = group !== before.group;
    const data: Prisma.FaqUpdateInput = {};
    if (patch.question !== undefined) data.question = patch.question;
    if (patch.answer !== undefined) data.answer = cleanAnswer(patch.answer);
    if (patch.enabled !== undefined) data.enabled = patch.enabled;
    if (patch.isFeatured !== undefined) data.isFeatured = patch.isFeatured;
    if (movedGroup) {
      data.group = group;
      // Land at the end of the destination group.
      const last = await tx.faq.findFirst({ where: { group }, orderBy: { position: "desc" }, select: { position: true } });
      data.position = (last?.position ?? -1) + 1;
    }
    if (Object.keys(data).length === 0) return before;

    await tx.faq.update({ where: { id }, data });
    if (movedGroup) {
      // The moved row shares a position with the next group's first row; the order below resolves it.
      const order = await listGroupOrder(tx);
      await renumber(tx, { groupOrder: order, within: { group, ids: [...(await tx.faq.findMany({ where: { group, id: { not: id } }, orderBy: ORDER, select: { id: true } })).map((row) => row.id), id] } });
    }
    const row = await loadFaq(tx, id);
    await writeAudit(tx, {
      actor,
      action: "faq.update",
      entityType: "Faq",
      entityId: row.id,
      entityLabel: row.question,
      summary: movedGroup ? `Updated FAQ "${row.question}" and moved it from "${before.group}" to "${row.group}".` : `Updated FAQ "${row.question}".`,
      diff: diffOf(snapshot(before), snapshot(row)),
    });
    return row;
  });
}

/** Enabled / featured toggles from the board; a no-op when nothing changes. */
export async function setFaqFlag(id: string, flag: FaqFlag, value: boolean, actor: AuditActor): Promise<Faq> {
  return db.$transaction(async (tx) => {
    const before = await loadFaq(tx, id);
    if (before[flag] === value) return before;
    const row = await tx.faq.update({ where: { id }, data: { [flag]: value } });
    const verb = flag === "enabled" ? (value ? "Enabled" : "Disabled") : value ? "Featured" : "Unfeatured";
    await writeAudit(tx, {
      actor,
      action: flag === "enabled" ? "faq.status_change" : "faq.feature",
      entityType: "Faq",
      entityId: row.id,
      entityLabel: row.question,
      summary: `${verb} FAQ "${row.question}".`,
      diff: diffOf({ [flag]: before[flag] }, { [flag]: value }),
    });
    return row;
  });
}

export async function deleteFaq(id: string, actor: AuditActor): Promise<{ id: string; question: string; group: string }> {
  return db.$transaction(async (tx) => {
    const row = await loadFaq(tx, id);
    await tx.faq.delete({ where: { id } });
    await renumber(tx);
    await writeAudit(tx, {
      actor,
      action: "faq.delete",
      entityType: "Faq",
      entityId: row.id,
      entityLabel: row.question,
      summary: `Deleted FAQ "${row.question}" from group "${row.group}".`,
      diff: diffOf(snapshot(row), null),
    });
    return { id: row.id, question: row.question, group: row.group };
  });
}

/** Drag-and-drop result for one group. Every id must belong to that group (422 otherwise). */
export async function reorderFaqs(input: { group: string; ids: string[] }, actor: AuditActor): Promise<{ moved: number; group: string }> {
  return db.$transaction(async (tx) => {
    const group = normalizeGroupName(input.group);
    const members = await tx.faq.findMany({ where: { group }, select: { id: true } });
    const memberIds = new Set(members.map((row) => row.id));
    const unknown = input.ids.filter((id) => !memberIds.has(id));
    if (unknown.length > 0) throw validationError({ ids: `${unknown.length} question(s) are not in group "${group}". Reload and try again.` });
    const moved = await renumber(tx, { within: { group, ids: input.ids } });
    if (moved > 0) {
      await writeAudit(tx, {
        actor,
        action: "faq.reorder",
        entityType: "Faq",
        entityLabel: group,
        summary: `Reordered ${input.ids.length} FAQs in group "${group}".`,
        diff: diffOf(null, { group, ids: input.ids }),
      });
    }
    return { moved, group };
  });
}

/** Storefront order of the groups themselves. */
export async function reorderFaqGroups(groups: string[], actor: AuditActor): Promise<{ moved: number }> {
  return db.$transaction(async (tx) => {
    const moved = await renumber(tx, { groupOrder: groups });
    if (moved > 0) {
      await writeAudit(tx, {
        actor,
        action: "faq.group_reorder",
        entityType: "Faq",
        summary: `Reordered FAQ groups: ${groups.map(normalizeGroupName).join(" → ")}.`,
        diff: diffOf(null, { groups }),
      });
    }
    return { moved };
  });
}

/**
 * Rename a group. Renaming onto an existing name merges into it: the renamed
 * questions follow the destination's own, so nothing the operator ordered
 * before gets shuffled.
 */
export async function renameFaqGroup(input: { from: string; to: string }, actor: AuditActor, action = "faq.group_rename"): Promise<{ moved: number; from: string; to: string; merged: boolean }> {
  return db.$transaction(async (tx) => {
    const from = normalizeGroupName(input.from);
    const to = normalizeGroupName(input.to);
    if (from === to) throw validationError({ to: "Choose a different name." });
    const order = await listGroupOrder(tx);
    if (!order.includes(from)) throw notFound(`FAQ group "${from}"`);
    const merged = order.includes(to);
    const destinationFirst = await tx.faq.findMany({ where: { group: to }, orderBy: ORDER, select: { id: true } });
    const moving = await tx.faq.findMany({ where: { group: from }, orderBy: ORDER, select: { id: true } });
    const result = await tx.faq.updateMany({ where: { group: from }, data: { group: to } });
    // A pure rename keeps the group's slot; a merge keeps the destination's slot.
    const groupOrder = merged ? order.filter((name) => name !== from) : order.map((name) => (name === from ? to : name));
    await renumber(tx, { groupOrder, within: { group: to, ids: [...destinationFirst, ...moving].map((row) => row.id) } });
    await writeAudit(tx, {
      actor,
      action,
      entityType: "Faq",
      entityLabel: to,
      summary: merged ? `Merged FAQ group "${from}" (${result.count} questions) into "${to}".` : `Renamed FAQ group "${from}" to "${to}" (${result.count} questions).`,
      diff: diffOf({ group: from }, { group: to, moved: result.count }),
    });
    return { moved: result.count, from, to, merged };
  });
}

/** "Delete group" = move its questions elsewhere; questions are never deleted implicitly. */
export async function deleteFaqGroup(input: { group: string; moveTo: string }, actor: AuditActor): Promise<{ moved: number; from: string; to: string }> {
  const result = await renameFaqGroup({ from: input.group, to: input.moveTo }, actor, "faq.group_delete");
  return { moved: result.moved, from: result.from, to: result.to };
}
