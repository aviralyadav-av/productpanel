import type { EmailTemplate, Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { conflict, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { sanitizeHtml } from "@/lib/sanitize/html";

import { renderTemplate, type EmailVars, type RenderedEmail } from "./render";
import { queueRawEmail } from "./service";
import { previewVarsFor, unknownVariablesFor } from "./templates-samples";
import type { TemplateFormValues } from "./templates-schemas";

/**
 * Writes on EmailTemplate (blueprint §1 "Email templates", §4.9, E3).
 *
 * No `next/*` and no `server-only` imports: the Server Actions, the REST
 * handlers, the check script and (if it ever needs to) the worker all call
 * the same functions. Everything mutating runs in one transaction with its
 * audit row, because "who changed the order confirmation, and to what" is
 * exactly the question asked after a bad send.
 *
 * The one rule that is not negotiable: `htmlBody` is sanitised with the
 * `email` profile on the way in (D12). An operator pastes designed markup
 * from anywhere, and the result is mailed to customers - the editor is a
 * publishing surface, not a trusted one.
 */

type Db = Prisma.TransactionClient;
export type ClientMeta = { ip?: string | null; userAgent?: string | null };

export async function loadTemplate(id: string, client: Db | typeof db = db): Promise<EmailTemplate> {
  const row = await client.emailTemplate.findUnique({ where: { id } });
  if (!row) throw notFound("Email template");
  return row;
}

/** Same lookup by the stable `key`, for services that address templates by name. */
export async function loadTemplateByKey(key: string, client: Db | typeof db = db): Promise<EmailTemplate> {
  const row = await client.emailTemplate.findUnique({ where: { key } });
  if (!row) throw notFound("Email template");
  return row;
}

export async function updateEmailTemplate(
  id: string,
  values: TemplateFormValues,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<EmailTemplate> {
  const before = await loadTemplate(id);

  const htmlBody = sanitizeHtml(values.htmlBody, "email");
  if (!htmlBody.trim()) {
    throw conflict("After sanitising, the HTML body is empty. Emails allow a limited set of tags - check for a stray script or iframe.");
  }
  const textBody = values.textBody?.trim() ? values.textBody : null;

  return db.$transaction(async (tx) => {
    const row = await tx.emailTemplate.update({
      where: { id },
      data: {
        name: values.name,
        subject: values.subject,
        htmlBody,
        textBody,
        isActive: values.isActive,
        updatedById: actor.id,
      },
    });

    const diff = diffOf(
      {
        name: before.name,
        subject: before.subject,
        htmlBody: before.htmlBody,
        textBody: before.textBody,
        isActive: before.isActive,
      },
      { name: row.name, subject: row.subject, htmlBody: row.htmlBody, textBody: row.textBody, isActive: row.isActive },
    );

    // A no-op save writes no audit row: an operator opening a template and
    // pressing Save should not look like a change in the log.
    if (diff) {
      await writeAudit(tx, {
        actor,
        action: "email_template.update",
        entityType: "EmailTemplate",
        entityId: row.id,
        entityLabel: row.key,
        summary: `Updated the "${row.name}" email template (${row.key}).`,
        diff,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    return row;
  });
}

export async function setTemplateActive(
  id: string,
  isActive: boolean,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<EmailTemplate> {
  const before = await loadTemplate(id);
  if (before.isActive === isActive) return before;

  return db.$transaction(async (tx) => {
    const row = await tx.emailTemplate.update({
      where: { id },
      data: { isActive, updatedById: actor.id },
    });
    await writeAudit(tx, {
      actor,
      action: "email_template.update",
      entityType: "EmailTemplate",
      entityId: row.id,
      entityLabel: row.key,
      // Worth spelling out: queueEmail() silently skips an inactive template,
      // so this switch stops a whole class of customer email.
      summary: isActive
        ? `Enabled the "${row.name}" email (${row.key}); it will be sent again.`
        : `Disabled the "${row.name}" email (${row.key}); it will no longer be queued.`,
      diff: { isActive: { from: before.isActive, to: isActive } },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return row;
  });
}

export type TemplatePreview = RenderedEmail & {
  vars: EmailVars;
  unknownVariables: string[];
};

/** Render a stored template with sample data (plus any overrides). */
export function previewTemplate(
  template: Pick<EmailTemplate, "key" | "subject" | "htmlBody" | "textBody" | "variables">,
  overrides: EmailVars = {},
): TemplatePreview {
  const source = { subject: template.subject, htmlBody: template.htmlBody, textBody: template.textBody };
  const vars = previewVarsFor(source, template.key, template.variables, overrides);
  return {
    ...renderTemplate(source, vars),
    vars,
    unknownVariables: unknownVariablesFor(source, template.key, template.variables),
  };
}

export type TestSendResult = {
  outboxId: string | null;
  queued: boolean;
  email: string;
  subject: string;
  reason: string | null;
};

/**
 * "Send test email to me": renders the STORED template with sample data and
 * queues it to the actor's own address as a raw email.
 *
 * Raw rather than `queueEmail`, for two reasons: a disabled template must
 * still be testable (that is how you check the copy before enabling it), and
 * a test must never take the real dedupe key - `order_confirmation:Order:x`
 * would then block the customer's actual confirmation.
 */
export async function sendTestEmail(input: {
  id: string;
  actor: AuditActor & { name?: string | null };
  vars?: EmailVars;
  meta?: ClientMeta;
}): Promise<TestSendResult> {
  const template = await loadTemplate(input.id);
  const email = input.actor.email?.trim();
  if (!email) throw conflict("Your admin account has no email address to send to.");

  const rendered = previewTemplate(template, input.vars ?? {});
  const subject = `[Test] ${rendered.subject}`;

  const result = await queueRawEmail({
    to: { email, name: input.actor.name ?? null },
    subject,
    html: rendered.html,
    text: rendered.text,
    entity: { type: "EmailTemplate", id: template.id },
    // No dedupe key: pressing "send test" twice must produce two emails.
    dedupeKey: null,
  });

  await writeAudit({
    actor: input.actor,
    action: "email_template.test_send",
    entityType: "EmailTemplate",
    entityId: template.id,
    entityLabel: template.key,
    summary: `Sent a test "${template.name}" email to themselves.`,
    diff: { queued: result.queued, outboxId: result.queued ? result.outboxId : null },
    ip: input.meta?.ip,
    userAgent: input.meta?.userAgent,
  });

  return {
    outboxId: result.outboxId,
    queued: result.queued,
    email,
    subject,
    reason: result.queued ? null : result.reason,
  };
}

/**
 * The audit actions whose diff can be replayed backwards. `restore` rows are
 * included so an operator can undo an undo.
 */
const RESTORABLE_ACTIONS = ["email_template.update", "email_template.restore"];

/** Fields a restore is allowed to put back (never `variables`, never ids). */
const RESTORABLE_FIELDS = ["name", "subject", "htmlBody", "textBody", "isActive"] as const;
type RestorableField = (typeof RESTORABLE_FIELDS)[number];

type DiffEntry = { from?: unknown; to?: unknown };

/**
 * There is no "reset to the seeded default": the seed only refreshes `name`
 * and `variables` on re-run, so the shipped copy is not recoverable from the
 * database once edited. What IS recoverable is the previous version, because
 * every save stores a `{ field: { from, to } }` diff in the append-only audit
 * log (D13). That is what this reads back.
 */
export function restorableFieldsFrom(diff: unknown): Partial<Record<RestorableField, unknown>> {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) return {};
  const entries = diff as Record<string, DiffEntry>;
  const out: Partial<Record<RestorableField, unknown>> = {};
  for (const field of RESTORABLE_FIELDS) {
    const entry = entries[field];
    if (entry && typeof entry === "object" && "from" in entry) out[field] = entry.from;
  }
  return out;
}

export type RestorePointRow = {
  auditId: string;
  at: Date;
  actorEmail: string;
  fields: RestorableField[];
  values: Partial<Record<RestorableField, unknown>>;
};

/** The most recent change to this template that can be rolled back. */
export async function findRestorePoint(
  templateId: string,
  client: Db | typeof db = db,
): Promise<RestorePointRow | null> {
  const rows = await client.auditLog.findMany({
    where: { entityType: "EmailTemplate", entityId: templateId, action: { in: RESTORABLE_ACTIONS } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, createdAt: true, actorEmail: true, diff: true },
  });

  for (const row of rows) {
    const values = restorableFieldsFrom(row.diff);
    const fields = Object.keys(values) as RestorableField[];
    if (fields.length > 0) {
      return { auditId: row.id, at: row.createdAt, actorEmail: row.actorEmail, fields, values };
    }
  }
  return null;
}

export type RestoreResult = { template: EmailTemplate; fields: string[]; restoredFrom: Date };

export async function restoreTemplateVersion(
  id: string,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<RestoreResult> {
  const before = await loadTemplate(id);
  const point = await findRestorePoint(id);
  if (!point) {
    throw conflict("There is no earlier version to restore - this template has not been edited since it was seeded.");
  }

  const data: Prisma.EmailTemplateUncheckedUpdateInput = { updatedById: actor.id };
  for (const field of point.fields) {
    const value = point.values[field];
    if (field === "isActive") data.isActive = Boolean(value);
    else if (field === "textBody") data.textBody = typeof value === "string" ? value : null;
    else if (typeof value !== "string") continue;
    else if (field === "htmlBody") data.htmlBody = sanitizeHtml(value, "email");
    else if (field === "subject") data.subject = value;
    else if (field === "name") data.name = value;
  }

  return db.$transaction(async (tx) => {
    const row = await tx.emailTemplate.update({ where: { id }, data });
    await writeAudit(tx, {
      actor,
      action: "email_template.restore",
      entityType: "EmailTemplate",
      entityId: row.id,
      entityLabel: row.key,
      summary: `Restored the "${row.name}" email template (${row.key}) to the version before ${point.at.toISOString()}.`,
      diff: diffOf(
        { name: before.name, subject: before.subject, htmlBody: before.htmlBody, textBody: before.textBody, isActive: before.isActive },
        { name: row.name, subject: row.subject, htmlBody: row.htmlBody, textBody: row.textBody, isActive: row.isActive },
      ),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { template: row, fields: point.fields as string[], restoredFrom: point.at };
  });
}
