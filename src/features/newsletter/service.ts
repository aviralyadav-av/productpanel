import type { Prisma } from "@prisma/client";

import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { NEWSLETTER_STATUS_META, type NewsletterStatus } from "@/lib/enums";
import { randomToken } from "@/lib/crypto";
import { stripHtml } from "@/lib/sanitize/html";
import { emitEvent } from "@/features/notifications/service";

import { parseSubscriberCsv } from "./csv";
import {
  MAX_IMPORT_ROWS,
  SUBSCRIBE_ACCEPTED_MESSAGE,
  isHoneypotTripped,
  subscribeSchema,
  type AddSubscriberValues,
  type BulkSubscribersInput,
  type ImportSubscribersValues,
  type SubscribeValues,
  type UpdateSubscriberValues,
} from "./schemas";
import type { ImportReport, ImportRowReport } from "./types";

/**
 * Business rules for newsletter subscribers (blueprint §1 Newsletter, §4.8,
 * §14.D9, E3). No `server-only` / `next/*` imports so the check scripts, the
 * seed and the job worker can call these directly; the Server Actions and the
 * REST handlers are thin wrappers.
 *
 * Two invariants everything here protects:
 *  1. `unsubscribeToken` is unguessable and stable for the life of the row -
 *     an unsubscribe link printed in an email two years ago must keep working.
 *  2. The public endpoints answer identically whether or not the address is
 *     already on the list, so nobody can use the form to test whether an
 *     address is a customer of ours.
 */

type Db = Prisma.TransactionClient;
export type NewsletterActor = AuditActor;
type ClientInfo = { ip?: string | null };

const SUBSCRIBER_SELECT = {
  id: true,
  email: true,
  name: true,
  status: true,
  source: true,
  unsubscribeToken: true,
  subscribedAt: true,
  unsubscribedAt: true,
  createdAt: true,
} satisfies Prisma.NewsletterSubscriberSelect;

export type SubscriberRecord = Prisma.NewsletterSubscriberGetPayload<{ select: typeof SUBSCRIBER_SELECT }>;

/** The link the `newsletter_welcome` email prints; served by GET /api/v1/newsletter/unsubscribe/:token. */
/**
 * Addresses are stored lower-cased. The Zod schemas already do this, but the
 * service normalises again: the column is `@unique` and case-sensitive, so one
 * caller that skips the schema (a seed module, a script) would otherwise
 * create "Asha@x.com" beside "asha@x.com" and mail her twice.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function unsubscribeUrlFor(token: string): string {
  return `${env.APP_ORIGIN.replace(/\/$/, "")}/api/v1/newsletter/unsubscribe/${encodeURIComponent(token)}`;
}

function newToken(): string {
  return randomToken(24);
}

async function requireSubscriber(tx: Db, id: string): Promise<SubscriberRecord> {
  const row = await tx.newsletterSubscriber.findUnique({ where: { id }, select: SUBSCRIBER_SELECT });
  if (!row) throw notFound("Subscriber");
  return row;
}

// ---------------------------------------------------------------------------
// Public intake (D9 5/h/IP, E3)
// ---------------------------------------------------------------------------

export type SubscribeResult = { message: string; created: boolean; resubscribed: boolean };

/**
 * POST /api/v1/newsletter/subscribe. Creates or reactivates the row and sends
 * `newsletter_welcome` once - a shopper who submits the footer form five times
 * gets one email, because the welcome is only emitted when the row actually
 * transitions into SUBSCRIBED.
 */
export async function subscribeFromPublic(input: { values: SubscribeValues; ip: string | null }): Promise<SubscribeResult> {
  const { values } = input;
  if (isHoneypotTripped(values)) return { message: SUBSCRIBE_ACCEPTED_MESSAGE, created: false, resubscribed: false };

  const email = normalizeEmail(values.email);
  const name = values.name ? stripHtml(values.name) || null : null;
  const source = values.source ? stripHtml(values.source) || null : "storefront";

  const outcome = await db.$transaction(async (tx) => {
    const existing = await tx.newsletterSubscriber.findUnique({ where: { email }, select: SUBSCRIBER_SELECT });

    if (existing && existing.status === "SUBSCRIBED") {
      // Already on the list: refresh the name if they gave us one, nothing else.
      if (name && name !== existing.name) {
        await tx.newsletterSubscriber.update({ where: { id: existing.id }, data: { name } });
      }
      return { row: existing, created: false, resubscribed: false };
    }

    const row = existing
      ? await tx.newsletterSubscriber.update({
          where: { id: existing.id },
          data: { status: "SUBSCRIBED", name: name ?? existing.name, source: source ?? existing.source, subscribedAt: new Date(), unsubscribedAt: null },
          select: SUBSCRIBER_SELECT,
        })
      : await tx.newsletterSubscriber.create({
          data: { email, name, source, status: "SUBSCRIBED", unsubscribeToken: newToken() },
          select: SUBSCRIBER_SELECT,
        });

    await emitEvent(
      "newsletter.subscribed",
      { subscriberId: row.id, email: row.email, name: row.name, unsubscribeUrl: unsubscribeUrlFor(row.unsubscribeToken) },
      tx,
    );

    return { row, created: !existing, resubscribed: Boolean(existing) };
  });

  return { message: SUBSCRIBE_ACCEPTED_MESSAGE, created: outcome.created, resubscribed: outcome.resubscribed };
}

export type UnsubscribeResult = { ok: boolean; email: string | null; alreadyUnsubscribed: boolean };

/**
 * GET /api/v1/newsletter/unsubscribe/:token - a one-click link from an email,
 * so it must work without a session and must be idempotent (mail clients
 * pre-fetch links). An unknown token reports "ok: false" and the route still
 * renders a friendly page rather than an error.
 */
export async function unsubscribeByToken(token: string): Promise<UnsubscribeResult> {
  const row = await db.newsletterSubscriber.findUnique({ where: { unsubscribeToken: token }, select: SUBSCRIBER_SELECT });
  if (!row) return { ok: false, email: null, alreadyUnsubscribed: false };
  if (row.status === "UNSUBSCRIBED") return { ok: true, email: row.email, alreadyUnsubscribed: true };

  await db.newsletterSubscriber.update({
    where: { id: row.id },
    data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() },
  });
  return { ok: true, email: row.email, alreadyUnsubscribed: false };
}

/** Convenience for the intake route: parse + subscribe in one call. */
export async function subscribeFromRequestBody(body: unknown, ip: string | null): Promise<SubscribeResult> {
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) throw badRequest("Enter a valid email address.", { email: "Invalid." });
  return subscribeFromPublic({ values: parsed.data, ip });
}

// ---------------------------------------------------------------------------
// Admin writes
// ---------------------------------------------------------------------------

export async function addSubscriber(values: AddSubscriberValues, actor: NewsletterActor, client: ClientInfo = {}): Promise<SubscriberRecord> {
  const email = normalizeEmail(values.email);
  return db.$transaction(async (tx) => {
    const existing = await tx.newsletterSubscriber.findUnique({ where: { email }, select: { id: true, status: true } });
    if (existing) throw conflict("That address is already on the list.", { email: "Already subscribed." });

    const row = await tx.newsletterSubscriber.create({
      data: {
        email,
        name: values.name,
        source: values.source ?? "admin",
        status: values.status,
        unsubscribeToken: newToken(),
        unsubscribedAt: values.status === "UNSUBSCRIBED" ? new Date() : null,
      },
      select: SUBSCRIBER_SELECT,
    });

    await writeAudit(tx, {
      actor,
      action: "newsletter.subscriber_add",
      entityType: "NewsletterSubscriber",
      entityId: row.id,
      entityLabel: row.email,
      summary: `Added ${row.email} to the newsletter list.`,
      diff: diffOf(null, { email: row.email, name: row.name, status: row.status, source: row.source }),
      ip: client.ip,
    });
    return row;
  });
}

export async function updateSubscriber(
  id: string,
  patch: UpdateSubscriberValues,
  actor: NewsletterActor,
  client: ClientInfo = {},
): Promise<SubscriberRecord> {
  return db.$transaction(async (tx) => {
    const before = await requireSubscriber(tx, id);
    const data: Prisma.NewsletterSubscriberUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.source !== undefined) data.source = patch.source;
    if (patch.status !== undefined && patch.status !== before.status) {
      data.status = patch.status;
      data.unsubscribedAt = patch.status === "UNSUBSCRIBED" ? new Date() : null;
      if (patch.status === "SUBSCRIBED") data.subscribedAt = new Date();
    }

    const after = await tx.newsletterSubscriber.update({ where: { id }, data, select: SUBSCRIBER_SELECT });
    await writeAudit(tx, {
      actor,
      action: "newsletter.subscriber_update",
      entityType: "NewsletterSubscriber",
      entityId: id,
      entityLabel: after.email,
      summary: `Updated ${after.email}.`,
      diff: diffOf(
        { name: before.name, source: before.source, status: before.status },
        { name: after.name, source: after.source, status: after.status },
      ),
      ip: client.ip,
    });
    return after;
  });
}

export async function setSubscriberStatus(
  id: string,
  status: NewsletterStatus,
  actor: NewsletterActor,
  client: ClientInfo = {},
): Promise<SubscriberRecord> {
  return updateSubscriber(id, { status }, actor, client);
}

export async function deleteSubscriber(id: string, actor: NewsletterActor, client: ClientInfo = {}): Promise<{ id: string; email: string }> {
  return db.$transaction(async (tx) => {
    const row = await requireSubscriber(tx, id);
    await tx.newsletterSubscriber.delete({ where: { id } });
    await writeAudit(tx, {
      actor,
      action: "newsletter.subscriber_delete",
      entityType: "NewsletterSubscriber",
      entityId: id,
      entityLabel: row.email,
      summary: `Removed ${row.email} from the newsletter list.`,
      diff: diffOf({ email: row.email, name: row.name, status: row.status, source: row.source }, null),
      ip: client.ip,
    });
    return { id, email: row.email };
  });
}

export type BulkSubscribersResult = { op: BulkSubscribersInput["op"]; requested: number; affected: number };

/** One transaction; audited with the id count (D13). */
export async function bulkSubscribers(
  input: BulkSubscribersInput,
  actor: NewsletterActor,
  client: ClientInfo = {},
): Promise<BulkSubscribersResult> {
  const ids = [...new Set(input.ids)];
  return db.$transaction(async (tx) => {
    let affected = 0;
    if (input.op === "delete") {
      affected = (await tx.newsletterSubscriber.deleteMany({ where: { id: { in: ids } } })).count;
    } else {
      const status: NewsletterStatus = input.op === "unsubscribe" ? "UNSUBSCRIBED" : "SUBSCRIBED";
      affected = (
        await tx.newsletterSubscriber.updateMany({
          where: { id: { in: ids }, status: { not: status } },
          data:
            status === "UNSUBSCRIBED"
              ? { status, unsubscribedAt: new Date() }
              : { status, unsubscribedAt: null, subscribedAt: new Date() },
        })
      ).count;
    }

    await writeAudit(tx, {
      actor,
      action: `newsletter.bulk_${input.op}`,
      entityType: "NewsletterSubscriber",
      summary: `Bulk ${input.op}: ${affected} of ${ids.length} subscriber(s).`,
      diff: { op: input.op, requested: ids.length, affected, ids: ids.slice(0, 200) },
      ip: client.ip,
    });
    return { op: input.op, requested: ids.length, affected };
  });
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PREVIEW_ROWS = 200;

type PlannedRow = { line: number; email: string; name: string | null; action: ImportRowReport["action"]; message?: string };

/**
 * Validate the file and work out what each row would do. The plan is built
 * before anything is written so the dialog can show the same numbers the
 * apply step will produce, and so a file with a bad row is rejected as a whole
 * rather than half-imported.
 */
async function planImport(values: ImportSubscribersValues): Promise<{ plan: PlannedRow[]; report: ImportReport }> {
  const { rows, errors } = parseSubscriberCsv(values.csv);
  const fileErrors = [...errors];

  if (rows.length > MAX_IMPORT_ROWS) {
    fileErrors.push(`The file has ${rows.length} rows; import at most ${MAX_IMPORT_ROWS} at a time.`);
  }

  const capped = rows.slice(0, MAX_IMPORT_ROWS);
  const seen = new Set<string>();
  const plan: PlannedRow[] = [];
  let duplicates = 0;

  for (const row of capped) {
    const email = row.email.trim().toLowerCase();
    const name = row.name.trim() || null;

    if (!email) {
      plan.push({ line: row.line, email, name, action: "error", message: "Missing email." });
      continue;
    }
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
      plan.push({ line: row.line, email, name, action: "error", message: "Not a valid email address." });
      continue;
    }
    if (seen.has(email)) {
      duplicates += 1;
      plan.push({ line: row.line, email, name, action: "skip", message: "Duplicate row in this file." });
      continue;
    }
    seen.add(email);
    plan.push({ line: row.line, email, name, action: "create" });
  }

  const candidates = plan.filter((row) => row.action === "create").map((row) => row.email);
  const existing =
    candidates.length > 0
      ? await db.newsletterSubscriber.findMany({ where: { email: { in: candidates } }, select: { email: true, status: true, name: true } })
      : [];
  const byEmail = new Map(existing.map((row) => [row.email, row]));

  for (const row of plan) {
    if (row.action !== "create") continue;
    const found = byEmail.get(row.email);
    if (!found) continue;
    if (found.status === "SUBSCRIBED") {
      row.action = row.name && row.name !== found.name ? "update" : "skip";
      if (row.action === "skip") row.message = "Already subscribed.";
    } else {
      row.action = "resubscribe";
      row.message = `Was ${NEWSLETTER_STATUS_META[found.status as NewsletterStatus]?.label.toLowerCase() ?? found.status}.`;
    }
  }

  const invalid = plan.filter((row) => row.action === "error").length;
  const toCreate = plan.filter((row) => row.action === "create").length;
  const toUpdate = plan.filter((row) => row.action === "resubscribe" || row.action === "update").length;

  const report: ImportReport = {
    dryRun: !values.apply,
    totalRows: capped.length,
    valid: capped.length - invalid,
    invalid,
    duplicates,
    toCreate,
    toUpdate,
    created: 0,
    updated: 0,
    fileErrors,
    rows: plan.slice(0, PREVIEW_ROWS).map((row) => ({ line: row.line, email: row.email || null, name: row.name, action: row.action, message: row.message })),
  };

  return { plan, report };
}

/** Dry run: what the file would do, without writing anything. */
export async function previewSubscriberImport(values: ImportSubscribersValues): Promise<ImportReport> {
  const { report } = await planImport({ ...values, apply: false });
  return report;
}

/** Apply the plan in one transaction (all or nothing) and audit it (D13). */
export async function applySubscriberImport(
  values: ImportSubscribersValues,
  actor: NewsletterActor,
  client: ClientInfo = {},
): Promise<ImportReport> {
  const { plan, report } = await planImport({ ...values, apply: true });
  if (report.fileErrors.length > 0) return report;
  if (report.invalid > 0) {
    report.fileErrors.push(`${report.invalid} row(s) are invalid; fix them and import again.`);
    return report;
  }

  const source = values.source ?? "import";
  const writable = plan.filter((row) => row.action === "create" || row.action === "resubscribe" || row.action === "update");
  if (writable.length === 0) return report;

  const counts = await db.$transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    for (const row of writable) {
      if (row.action === "create") {
        await tx.newsletterSubscriber.create({
          data: { email: row.email, name: row.name, source, status: "SUBSCRIBED", unsubscribeToken: newToken() },
        });
        created += 1;
      } else {
        await tx.newsletterSubscriber.update({
          where: { email: row.email },
          data:
            row.action === "resubscribe"
              ? { status: "SUBSCRIBED", name: row.name ?? undefined, subscribedAt: new Date(), unsubscribedAt: null }
              : { name: row.name ?? undefined },
        });
        updated += 1;
      }
    }

    await writeAudit(tx, {
      actor,
      action: "newsletter.import",
      entityType: "NewsletterSubscriber",
      summary: `Imported ${created} new and updated ${updated} newsletter subscriber(s) from CSV.`,
      diff: { source, totalRows: report.totalRows, created, updated, skipped: report.totalRows - created - updated },
      ip: client.ip,
    });

    return { created, updated };
  });

  return { ...report, dryRun: false, created: counts.created, updated: counts.updated };
}
