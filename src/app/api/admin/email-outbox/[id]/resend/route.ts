import { writeAudit } from "@/lib/audit";
import { apiOk, withAdminApi } from "@/lib/api/admin";
import { conflict, notFound } from "@/lib/api/errors";
import { requeueOutboxEmail } from "@/features/email/handlers";
import { getEmailOutboxItem } from "@/features/jobs/queries";

/**
 * POST /api/admin/email-outbox/:id/resend
 *
 * Puts the row back to QUEUED and enqueues a fresh `email.send` job (the
 * worker delivers it within one poll). Works for FAILED and CANCELLED rows,
 * and for SENT rows as a deliberate re-send of the same content; a row that
 * is SENDING right now is refused with 409.
 *
 * Permission: `email_outbox.view` is read-only by definition (D14), so this
 * write is guarded by `jobs.manage` - resending IS triggering a job, and the
 * roles that hold it (admin, super-admin) are the ones who operate the queue.
 * `email_templates.manage` was the alternative, but editing a template is an
 * authoring concern, not an operational one.
 */
export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const row = await getEmailOutboxItem(params.id);
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
      ip,
      userAgent: req.headers.get("user-agent"),
    });

    return apiOk({ id: row.id, status: "QUEUED", jobId: result.jobId });
  },
  { permission: "jobs.manage" },
);

/** The audit log is broad-read (audit.view); keep recipient addresses out of it. */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
