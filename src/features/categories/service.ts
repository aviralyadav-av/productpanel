import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { slugify } from "@/lib/validation";
import { conflict, notFound, validationError } from "@/lib/api/errors";
import { commissionTargetKey } from "@/lib/enums";
import {
  applyReorderMoves,
  buildPath,
  CategoryTreeError,
  depthOfPath,
  moveCategory,
  recomputeSubtreePaths,
  wouldCreateCycle,
  type ReorderMove,
} from "@/features/catalog/category-tree";

import {
  MAX_CATEGORY_DEPTH,
  type CategoryPatch,
  type CategoryValues,
  type CommissionOverrideInput,
  type DeleteCategoryInput,
} from "./schemas";
import { deepestDepthAfterMove, descendantIdsOf, nextSlugCandidate } from "./tree-helpers";

import {
  CATEGORY_SELECT,
  categoryUsage,
  loadNodes,
  queueSubtreeRecompute,
  requireCategory,
  type CategoryRecord,
  type ClientMeta,
  type Db,
} from "./shared";

export * from "./shared";
export * from "./attribute-assignments";

/**
 * Category tree mutations (blueprint §11.1-3, §11.23, §14.A1-A2, A6, A9, G5).
 *
 * Every function takes the caller's transaction client as its first argument
 * and never opens one itself: the Server Action, the REST handler and the
 * check script each decide the transaction boundary (and the check script
 * rolls it back). Audit rows are written INSIDE that transaction so a
 * category change without its audit row cannot exist (D13).
 *
 * Nothing here imports `server-only` or `next/*`; cache invalidation and
 * `revalidatePath` belong to the Next layer (./revalidate.ts).
 */

// ---------------------------------------------------------------------------
// Slugs (§11.23)
// ---------------------------------------------------------------------------

async function takenSlugs(tx: Db, prefix: string): Promise<Set<string>> {
  const rows = await tx.category.findMany({
    where: { OR: [{ slug: prefix }, { slug: { startsWith: `${prefix}-` } }] },
    select: { slug: true },
  });
  return new Set(rows.map((row) => row.slug));
}

/** Create-time rule: a duplicate slug is suffixed, never rejected. */
export async function uniqueCategorySlug(tx: Db, wanted: string): Promise<string> {
  const base = slugify(wanted) || "category";
  return nextSlugCandidate(base, await takenSlugs(tx, base));
}

/** Edit-time rule: a duplicate slug is an explicit field error. */
async function assertSlugFree(tx: Db, slug: string, exceptId: string): Promise<void> {
  const existing = await tx.category.findUnique({ where: { slug }, select: { id: true } });
  if (existing && existing.id !== exceptId) {
    throw validationError({ slug: "Another category already uses this slug." }, "That slug is already in use.");
  }
}

// ---------------------------------------------------------------------------
// Create / update / flags
// ---------------------------------------------------------------------------

async function nextSiblingPosition(tx: Db, parentId: string | null): Promise<number> {
  const last = await tx.category.findFirst({
    where: { parentId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return last ? last.position + 1 : 0;
}

async function requireParent(tx: Db, parentId: string) {
  const parent = await tx.category.findUnique({
    where: { id: parentId },
    select: { id: true, path: true, depth: true, name: true },
  });
  if (!parent) throw validationError({ parentId: "That parent category no longer exists." });
  return parent;
}

function assertDepth(deepest: number): void {
  if (deepest > MAX_CATEGORY_DEPTH) {
    throw validationError(
      { parentId: `Categories can be nested at most ${MAX_CATEGORY_DEPTH + 1} levels deep.` },
      `Categories can be nested at most ${MAX_CATEGORY_DEPTH + 1} levels deep.`,
    );
  }
}

export async function createCategory(
  tx: Db,
  input: CategoryValues,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<CategoryRecord> {
  const parent = input.parentId ? await requireParent(tx, input.parentId) : null;
  assertDepth((parent?.depth ?? -1) + 1);

  const slug = await uniqueCategorySlug(tx, input.slug ?? input.name);
  const path = buildPath(parent?.path ?? null, slug);

  const created = await tx.category.create({
    data: {
      name: input.name,
      slug,
      path,
      depth: depthOfPath(path),
      parentId: parent?.id ?? null,
      position: input.position ?? (await nextSiblingPosition(tx, parent?.id ?? null)),
      description: input.description ?? null,
      isActive: input.isActive,
      isFeatured: input.isFeatured,
      imageMediaId: input.imageMediaId ?? null,
      iconMediaId: input.iconMediaId ?? null,
      bannerMediaId: input.bannerMediaId ?? null,
      iconName: input.iconName ?? null,
      metaTitle: input.metaTitle ?? null,
      metaDescription: input.metaDescription ?? null,
      metaKeywords: input.metaKeywords ?? null,
      canonicalUrl: input.canonicalUrl ?? null,
      ogImageMediaId: input.ogImageMediaId ?? null,
      noIndex: input.noIndex,
    },
    select: CATEGORY_SELECT,
  });

  await writeAudit(tx, {
    actor,
    action: "category.create",
    entityType: "Category",
    entityId: created.id,
    entityLabel: created.name,
    summary: parent ? `Created category "${created.name}" under "${parent.name}"` : `Created root category "${created.name}"`,
    diff: diffOf(null, { ...created }),
    ...meta,
  });

  return created;
}

export type UpdateCategoryResult = {
  category: CategoryRecord;
  /** True when the slug or parent changed and the subtree's paths were rewritten. */
  structural: boolean;
  recomputeQueued: boolean;
};

export async function updateCategory(
  tx: Db,
  id: string,
  patch: CategoryPatch,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<UpdateCategoryResult> {
  const before = await requireCategory(tx, id);

  const slug = patch.slug !== undefined ? patch.slug : before.slug;
  if (slug !== before.slug) await assertSlugFree(tx, slug, id);

  const parentId = patch.parentId !== undefined ? patch.parentId : before.parentId;
  const parentChanged = parentId !== before.parentId;
  if (parentChanged) {
    if (parentId === id) throw validationError({ parentId: "A category cannot be its own parent." });
    if (parentId) await requireParent(tx, parentId);
    const nodes = await loadNodes(tx);
    if (wouldCreateCycle(id, parentId, nodes)) {
      throw validationError(
        { parentId: "A category cannot be moved under one of its own descendants." },
        "A category cannot be moved under one of its own descendants.",
      );
    }
    assertDepth(deepestDepthAfterMove(nodes, id, parentId));
  }

  const position =
    patch.position !== undefined
      ? patch.position
      : parentChanged
        ? await nextSiblingPosition(tx, parentId)
        : before.position;

  const after = await tx.category.update({
    where: { id },
    data: {
      name: patch.name ?? before.name,
      slug,
      description: patch.description !== undefined ? patch.description : before.description,
      position,
      isActive: patch.isActive ?? before.isActive,
      isFeatured: patch.isFeatured ?? before.isFeatured,
      imageMediaId: patch.imageMediaId !== undefined ? patch.imageMediaId : before.imageMediaId,
      iconMediaId: patch.iconMediaId !== undefined ? patch.iconMediaId : before.iconMediaId,
      bannerMediaId: patch.bannerMediaId !== undefined ? patch.bannerMediaId : before.bannerMediaId,
      iconName: patch.iconName !== undefined ? patch.iconName : before.iconName,
      metaTitle: patch.metaTitle !== undefined ? patch.metaTitle : before.metaTitle,
      metaDescription: patch.metaDescription !== undefined ? patch.metaDescription : before.metaDescription,
      metaKeywords: patch.metaKeywords !== undefined ? patch.metaKeywords : before.metaKeywords,
      canonicalUrl: patch.canonicalUrl !== undefined ? patch.canonicalUrl : before.canonicalUrl,
      ogImageMediaId: patch.ogImageMediaId !== undefined ? patch.ogImageMediaId : before.ogImageMediaId,
      noIndex: patch.noIndex ?? before.noIndex,
    },
    select: CATEGORY_SELECT,
  });

  let structural = false;
  let recomputeQueued = false;
  if (parentChanged) {
    // moveCategory re-checks the cycle, rewrites path/depth for the subtree and
    // queues the facet recompute (the effective attribute set changed - A6).
    const moved = await moveCategory(tx, { id, parentId, position });
    structural = true;
    recomputeQueued = moved.products > 0;
  } else if (slug !== before.slug) {
    // A slug change only moves URLs: Product.categoryPath follows the new
    // path but the effective attribute set is untouched, so no recompute.
    await recomputeSubtreePaths(tx, id);
    structural = true;
  }

  const category = structural ? await requireCategory(tx, id) : after;

  await writeAudit(tx, {
    actor,
    action: "category.update",
    entityType: "Category",
    entityId: id,
    entityLabel: category.name,
    summary: parentChanged
      ? `Moved category "${category.name}" to ${category.path}`
      : `Updated category "${category.name}"`,
    diff: diffOf({ ...before }, { ...category }),
    ...meta,
  });

  return { category, structural, recomputeQueued };
}

export type CategoryFlag = "isActive" | "isFeatured";

export async function setCategoryFlag(
  tx: Db,
  id: string,
  flag: CategoryFlag,
  value: boolean,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<CategoryRecord> {
  const before = await requireCategory(tx, id);
  if (before[flag] === value) return before;

  const after = await tx.category.update({ where: { id }, data: { [flag]: value }, select: CATEGORY_SELECT });

  const verb =
    flag === "isActive" ? (value ? "Enabled" : "Disabled") : value ? "Featured" : "Unfeatured";
  await writeAudit(tx, {
    actor,
    action: flag === "isActive" ? "category.status_change" : "category.feature",
    entityType: "Category",
    entityId: id,
    entityLabel: after.name,
    summary: `${verb} category "${after.name}"`,
    diff: diffOf({ [flag]: before[flag] }, { [flag]: value }),
    ...meta,
  });
  return after;
}

// ---------------------------------------------------------------------------
// Delete (§11.1)
// ---------------------------------------------------------------------------

export type DeleteCategoryResult = {
  id: string;
  name: string;
  reassignedTo: { id: string; name: string } | null;
  movedChildren: number;
  movedProducts: number;
};

export async function deleteCategory(
  tx: Db,
  input: DeleteCategoryInput,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<DeleteCategoryResult> {
  const category = await requireCategory(tx, input.id);
  const usage = await categoryUsage(tx, input.id);
  const reassignTo = input.reassignTo ?? null;

  if ((usage.children > 0 || usage.products > 0) && !reassignTo) {
    const parts: string[] = [];
    if (usage.children > 0) parts.push(`${usage.children} sub-categor${usage.children === 1 ? "y" : "ies"}`);
    if (usage.products > 0) parts.push(`${usage.products} product${usage.products === 1 ? "" : "s"}`);
    throw conflict(
      `"${category.name}" still holds ${parts.join(" and ")}. Choose a category to move them to first.`,
      { children: String(usage.children), products: String(usage.products) },
    );
  }

  let target: { id: string; name: string; path: string; depth: number } | null = null;
  if (reassignTo) {
    if (reassignTo === input.id) {
      throw validationError({ reassignTo: "Choose a different category to move things into." });
    }
    const found = await tx.category.findUnique({
      where: { id: reassignTo },
      select: { id: true, name: true, path: true, depth: true },
    });
    if (!found) throw validationError({ reassignTo: "That category no longer exists." });
    const nodes = await loadNodes(tx);
    if (descendantIdsOf(nodes, input.id).includes(reassignTo)) {
      throw validationError(
        { reassignTo: "Cannot move things into a sub-category of the one being deleted." },
        "Cannot move things into a sub-category of the one being deleted.",
      );
    }
    const children = nodes.filter((node) => node.parentId === input.id);
    for (const child of children) assertDepth(deepestDepthAfterMove(nodes, child.id, reassignTo));
    target = found;
  }

  let movedProducts = 0;
  let movedChildren = 0;

  if (target) {
    const products = await tx.product.updateMany({
      where: { categoryId: input.id },
      data: { categoryId: target.id, categoryPath: target.path },
    });
    movedProducts = products.count;

    const children = await tx.category.findMany({
      where: { parentId: input.id },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    let position = await nextSiblingPosition(tx, target.id);
    for (const child of children) {
      await tx.category.update({ where: { id: child.id }, data: { parentId: target.id, position } });
      await recomputeSubtreePaths(tx, child.id);
      position += 1;
    }
    movedChildren = children.length;
  }

  // CategoryAttribute and CommissionRule cascade; Banner, NavigationItem and
  // OrderItem references null out (the schema's onDelete rules). Products and
  // children were moved above, so the Restrict FKs are satisfied.
  await tx.category.delete({ where: { id: input.id } });

  if (target && (movedProducts > 0 || movedChildren > 0)) {
    // The moved products now live under a different effective attribute set.
    await queueSubtreeRecompute(tx, target.id);
  }

  await writeAudit(tx, {
    actor,
    action: "category.delete",
    entityType: "Category",
    entityId: input.id,
    entityLabel: category.name,
    summary: target
      ? `Deleted category "${category.name}"; moved ${movedProducts} product(s) and ${movedChildren} sub-categor${movedChildren === 1 ? "y" : "ies"} to "${target.name}"`
      : `Deleted empty category "${category.name}"`,
    diff: diffOf({ ...category }, null),
    ...meta,
  });

  return {
    id: input.id,
    name: category.name,
    reassignedTo: target ? { id: target.id, name: target.name } : null,
    movedChildren,
    movedProducts,
  };
}

// ---------------------------------------------------------------------------
// Reorder (G5)
// ---------------------------------------------------------------------------

/**
 * Rewrite one sibling list as 0..n-1 in its current order, optionally with
 * `insert.id` forced to index `insert.position`. applyReorderMoves stores the
 * dropped node's position but leaves its new siblings' numbers alone, which
 * would let two rows share a slot; renumbering keeps the order the operator
 * saw when they let go.
 */
async function renumberSiblings(
  tx: Db,
  parentId: string | null,
  insert?: { id: string; position: number },
): Promise<void> {
  const siblings = await tx.category.findMany({
    where: { parentId },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, position: true },
  });
  let ordered = siblings.map((row) => row.id);
  if (insert) {
    ordered = ordered.filter((id) => id !== insert.id);
    ordered.splice(Math.max(0, Math.min(insert.position, ordered.length)), 0, insert.id);
  }
  for (const [index, id] of ordered.entries()) {
    const current = siblings.find((row) => row.id === id);
    if (current && current.position === index) continue;
    await tx.category.update({ where: { id }, data: { position: index } });
  }
}

export type ReorderResult = { moved: number; categories: number; products: number };

export async function reorderCategories(
  tx: Db,
  moves: readonly ReorderMove[],
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<ReorderResult> {
  if (moves.length === 0) return { moved: 0, categories: 0, products: 0 };

  const nodes = await loadNodes(tx);
  const before = new Map(nodes.map((node) => [node.id, node.parentId]));
  // Depth cap against the tree as it will be after the whole batch.
  const projected = nodes.map((node) => ({ ...node }));
  for (const move of moves) {
    const node = projected.find((row) => row.id === move.id);
    if (!node) throw notFound("Category");
    node.parentId = move.parentId;
  }
  for (const move of moves) assertDepth(deepestDepthAfterMove(projected, move.id, move.parentId));

  let result: ReorderResult;
  try {
    result = await applyReorderMoves(tx, moves);
  } catch (error) {
    // CategoryTreeError is the domain helper's vocabulary; the API speaks
    // ApiError, so the two structural failures are translated here.
    if (error instanceof CategoryTreeError) {
      if (error.code === "NOT_FOUND") throw notFound("Category");
      throw conflict(error.message);
    }
    throw error;
  }

  const touchedParents = new Set<string | null>();
  for (const move of moves) {
    await renumberSiblings(tx, move.parentId, { id: move.id, position: move.position });
    touchedParents.add(move.parentId);
    const previous = before.get(move.id) ?? null;
    if (previous !== move.parentId && !touchedParents.has(previous)) {
      await renumberSiblings(tx, previous);
      touchedParents.add(previous);
    }
  }

  const names = await tx.category.findMany({
    where: { id: { in: moves.map((move) => move.id) } },
    select: { id: true, name: true },
  });
  const label = names.map((row) => `"${row.name}"`).join(", ");
  await writeAudit(tx, {
    actor,
    action: "category.reorder",
    entityType: "Category",
    entityId: moves.length === 1 ? moves[0].id : null,
    entityLabel: names.length === 1 ? names[0].name : null,
    summary:
      moves.length === 1
        ? `Reordered category ${label}${result.categories > 0 ? " (re-parented)" : ""}`
        : `Reordered ${moves.length} categories: ${label}`,
    diff: { moves: moves.map((move) => ({ ...move })) },
    ...meta,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Commission override (B3) - CATEGORY scope only
// ---------------------------------------------------------------------------

const COMMISSION_SELECT = {
  id: true,
  scope: true,
  targetKey: true,
  categoryId: true,
  rateBps: true,
  fixedPaise: true,
  isActive: true,
  note: true,
  updatedAt: true,
} satisfies Prisma.CommissionRuleSelect;

export type CategoryCommissionRule = Prisma.CommissionRuleGetPayload<{ select: typeof COMMISSION_SELECT }>;

export async function getCategoryCommissionRule(
  tx: Db | undefined,
  categoryId: string,
): Promise<CategoryCommissionRule | null> {
  return (tx ?? db).commissionRule.findUnique({
    where: { targetKey: commissionTargetKey("CATEGORY", categoryId) },
    select: COMMISSION_SELECT,
  });
}

export async function saveCategoryCommission(
  tx: Db,
  input: CommissionOverrideInput,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<CategoryCommissionRule> {
  const category = await requireCategory(tx, input.categoryId);
  const targetKey = commissionTargetKey("CATEGORY", input.categoryId);
  const before = await getCategoryCommissionRule(tx, input.categoryId);

  const rule = await tx.commissionRule.upsert({
    where: { targetKey },
    update: { rateBps: input.rateBps, fixedPaise: input.fixedPaise, note: input.note ?? null, isActive: true },
    create: {
      scope: "CATEGORY",
      targetKey,
      categoryId: input.categoryId,
      rateBps: input.rateBps,
      fixedPaise: input.fixedPaise,
      note: input.note ?? null,
      isActive: true,
    },
    select: COMMISSION_SELECT,
  });

  await writeAudit(tx, {
    actor,
    action: "category.commission_set",
    entityType: "Category",
    entityId: input.categoryId,
    entityLabel: category.name,
    summary: `Set commission override for "${category.name}" to ${(input.rateBps / 100).toFixed(2)}%${input.fixedPaise ? ` + ₹${(input.fixedPaise / 100).toFixed(2)}` : ""}`,
    diff: diffOf(before ? { ...before } : null, { ...rule }),
    ...meta,
  });
  return rule;
}

export async function removeCategoryCommission(
  tx: Db,
  categoryId: string,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<{ removed: boolean }> {
  const category = await requireCategory(tx, categoryId);
  const before = await getCategoryCommissionRule(tx, categoryId);
  if (!before) return { removed: false };

  await tx.commissionRule.delete({ where: { id: before.id } });
  await writeAudit(tx, {
    actor,
    action: "category.commission_remove",
    entityType: "Category",
    entityId: categoryId,
    entityLabel: category.name,
    summary: `Removed commission override for "${category.name}" (was ${(before.rateBps / 100).toFixed(2)}%)`,
    diff: diffOf({ ...before }, null),
    ...meta,
  });
  return { removed: true };
}
