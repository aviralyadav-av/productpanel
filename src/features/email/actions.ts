"use server";

import { revalidatePath } from "next/cache";

import { ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { conflict, notFound } from "@/lib/api/errors";
import { db } from "@/lib/db";

import { requeueOutboxEmail } from "./handlers";
import {
  restoreTemplateVersion,
  sendTestEmail,
  setTemplateActive,
  updateEmailTemplate,
} from "./templates-service";
import {
  setTemplateActiveSchema,
  templateFormSchema,
  templateIdSchema,
  type TemplateFormInput,
} from "./templates-schemas";

/**
 * Server Actions for the email templates screen. Thin wrappers: parse, call
 * the service, revalidate, return an ActionResult - every rule about
 * sanitisation, auditing and transactions lives in templates-service.ts so
 * the REST handlers behave identically.
 *
 * Permissions: `email_templates.manage` to edit or test-send (a test send is
 * an authoring act - you are checking your own copy), `jobs.manage` to resend
 * something from the outbox (that is operating the queue, D14).
 */

const LIST_PATH = "/admin/email-templates";

export type SaveTemplateResult = { id: string; key: string };

export async function updateEmailTemplateAction(
  id: string,
  input: TemplateFormInput,
): Promise<ActionResult<SaveTemplateResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("email_templates.manage");
    const parsedId = templateIdSchema.safeParse(id);
    if (!parsedId.success) return zodFail(parsedId.error);
    const parsed = templateFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const row = await updateEmailTemplate(parsedId.data, parsed.data, actor);
    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${row.id}`);
    return ok({ id: row.id, key: row.key }, `Saved the "${row.name}" template.`);
  });
}

export async function setEmailTemplateActiveAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("email_templates.manage");
    const parsed = setTemplateActiveSchema.safeParse({ isActive });
    if (!parsed.success) return zodFail(parsed.error);

    const row = await setTemplateActive(id, parsed.data.isActive, actor);
    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${row.id}`);
    return ok(
      { id: row.id, isActive: row.isActive },
      row.isActive
        ? `"${row.name}" is active again and will be sent.`
        : `"${row.name}" is disabled; the platform will stop queueing it.`,
    );
  });
}

export type TestSendActionResult = {
  outboxId: string | null;
  email: string;
  subject: string;
  queued: boolean;
};

export async function sendTestEmailAction(
  id: string,
  vars?: Record<string, string>,
): Promise<ActionResult<TestSendActionResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("email_templates.manage");
    const result = await sendTestEmail({ id, actor, vars });
    revalidatePath(`${LIST_PATH}/${id}`);

    return ok(
      { outboxId: result.outboxId, email: result.email, subject: result.subject, queued: result.queued },
      result.queued
        ? `Test email queued to ${result.email}. It sends on the next worker poll - watch it on the Outbox tab.`
        : `The email was not queued (${result.reason ?? "unknown reason"}).`,
    );
  });
}

export async function restoreEmailTemplateAction(
  id: string,
): Promise<ActionResult<{ id: string; fields: string[] }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("email_templates.manage");
    const result = await restoreTemplateVersion(id, actor);
    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${id}`);
    return ok(
      { id: result.template.id, fields: result.fields },
      `Restored ${result.fields.join(", ")} to the version before the last change.`,
    );
  });
}

/**
 * Outbox tab: put a row back in the queue. Guarded by `jobs.manage` for the
 * reason stated in the REST route - `email_outbox.view` is read-only by
 * definition, and resending IS triggering a job.
 */
export async function resendOutboxEmailAction(
  id: string,
): Promise<ActionResult<{ id: string; jobId: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("jobs.manage");

    const row = await db.emailOutbox.findUnique({
      where: { id },
      select: { id: true, subject: true, status: true, attempts: true, toEmail: true, templateKey: true, entityType: true, entityId: true },
    });
    if (!row) throw notFound("Email");

    const result = await requeueOutboxEmail(row.id);
    if (!result.ok) {
      if (result.reason === "not_found") throw notFound("Email");
      throw conflict("This email is being sent right now; wait for it to finish.");
    }

    await writeAudit({
      actor,
      action: "email_outbox.resend",
      entityType: "EmailOutbox",
      entityId: row.id,
      entityLabel: row.subject,
      summary: `Resent email "${row.subject}" (${row.templateKey ?? "raw"}) to ${maskEmail(row.toEmail)}; was ${row.status} after ${row.attempts} attempt(s).`,
      diff: {
        status: { from: row.status, to: "QUEUED" },
        jobId: result.jobId,
        entityType: row.entityType,
        entityId: row.entityId,
      },
    });

    revalidatePath(LIST_PATH);
    return ok({ id: row.id, jobId: result.jobId }, "Queued again; the worker sends it on its next poll.");
  });
}

/** The audit log is broadly readable (audit.view); keep addresses out of it. */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
