import { db } from "@/lib/db";
import { JOB_TYPES, type JobType } from "@/lib/enums";
import { getMailer } from "@/lib/mailer";
import { enqueue, registerJobHandler } from "@/lib/queue";

/**
 * Email SENDING (blueprint §10, F6). `queueEmail()` in ./service.ts writes the
 * EmailOutbox row and enqueues `email.send { outboxId }` (runAt = scheduledAt,
 * dedupeKey `email.send:<outboxId>`); this module turns that row into a
 * delivery through whatever `getMailer()` returns (SMTP or console).
 *
 * Idempotency is the whole design: the row is claimed QUEUED→SENDING with a
 * conditional update, so a job that runs twice (crash after send, before the
 * COMPLETED mark) finds the row already SENDING or SENT and stops. A failed
 * delivery puts the row back to QUEUED while the job still has attempts left -
 * the queue's exponential backoff is the retry schedule - and marks it FAILED
 * only when the job is exhausted, so the outbox page and the job list agree.
 */

export type EmailSendPayload = { outboxId: string };

/**
 * Not yet in JOB_TYPES (enums.ts is frozen for this wave); registered through
 * a cast. The scheduler enqueues it only once the enum gains the value and
 * runs `retryFailedEmails()` inline until then.
 */
export const EMAIL_RETRY_FAILED_JOB = "email.retry_failed" as JobType;

/** FAILED rows older than this stay failed for an operator to look at. */
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Minimum gap between automatic retries of the same FAILED row. */
const RETRY_COOLDOWN_MS = 60 * 60 * 1000;
/** Clock-skew tolerance before a row is considered "not due yet". */
const DUE_TOLERANCE_MS = 60 * 1000;

export type EmailSendResult =
  | { sent: true; messageId: string; transport: string }
  | { sent: false; skipped: string };

/**
 * Deliver one outbox row. Exported so an admin action can call it
 * synchronously when an operator wants immediate feedback.
 */
export async function sendOutboxEmail(
  outboxId: string,
  options: { attempt: number; maxAttempts: number },
): Promise<EmailSendResult> {
  const row = await db.emailOutbox.findUnique({ where: { id: outboxId } });
  if (!row) return { sent: false, skipped: "outbox row no longer exists" };
  if (row.status !== "QUEUED") return { sent: false, skipped: `status is ${row.status}` };
  if (row.scheduledAt.getTime() > Date.now() + DUE_TOLERANCE_MS) {
    // The job's runAt equals scheduledAt, so this only happens when the row
    // was rescheduled after the job was created. Failing the attempt hands
    // the delay to the queue's backoff instead of silently dropping the mail.
    throw new Error(`email ${outboxId} is scheduled for ${row.scheduledAt.toISOString()}; not due yet`);
  }

  const claimed = await db.emailOutbox.updateMany({
    where: { id: outboxId, status: "QUEUED" },
    data: { status: "SENDING", attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return { sent: false, skipped: "claimed by another worker" };

  try {
    const mailer = await getMailer();
    const result = await mailer.send({
      to: row.toEmail,
      toName: row.toName,
      subject: row.subject,
      html: row.htmlBody,
      text: row.textBody,
    });

    await db.emailOutbox.update({
      where: { id: outboxId },
      data: {
        status: "SENT",
        sentAt: new Date(),
        providerMessageId: result.messageId,
        lastError: null,
      },
    });
    return { sent: true, messageId: result.messageId, transport: mailer.transport };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = options.attempt >= options.maxAttempts;
    await db.emailOutbox.update({
      where: { id: outboxId },
      data: {
        status: exhausted ? "FAILED" : "QUEUED",
        lastError: message.slice(0, 2000),
      },
    });
    // Rethrow so the queue records the failure and schedules the retry.
    throw error;
  }
}

/**
 * Put a FAILED (or CANCELLED) row back in the queue with a fresh send job.
 * SENT rows are re-sent as a copy of the same content; the dedupe key on the
 * job is per outbox row, so a double click on "resend" creates one job.
 * `scheduledAt` is bumped to now, which is also what the retry sweep uses as
 * "last attempt" for its cooldown.
 */
export async function requeueOutboxEmail(
  outboxId: string,
): Promise<{ ok: true; jobId: string } | { ok: false; reason: "not_found" | "sending" }> {
  const row = await db.emailOutbox.findUnique({
    where: { id: outboxId },
    select: { id: true, status: true },
  });
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "SENDING") return { ok: false, reason: "sending" };

  await db.emailOutbox.update({
    where: { id: outboxId },
    data: { status: "QUEUED", scheduledAt: new Date(), lastError: null },
  });
  const job = await enqueue(
    "email.send",
    { outboxId },
    { dedupeKey: `email.send:${outboxId}`, priority: 5 },
  );
  return { ok: true, jobId: job.id };
}

/**
 * Sweep: FAILED rows younger than 24 h whose last attempt is more than an hour
 * old go back to QUEUED with a new job - so a transient SMTP outage heals
 * itself, while an address that keeps bouncing is retried at most hourly and
 * then left FAILED after a day. Safe to call as often as you like.
 */
export async function retryFailedEmails(now = new Date()): Promise<{ requeued: number }> {
  const rows = await db.emailOutbox.findMany({
    where: {
      status: "FAILED",
      createdAt: { gte: new Date(now.getTime() - RETRY_WINDOW_MS) },
      scheduledAt: { lt: new Date(now.getTime() - RETRY_COOLDOWN_MS) },
    },
    select: { id: true },
    orderBy: { scheduledAt: "asc" },
    take: 500,
  });

  let requeued = 0;
  for (const row of rows) {
    const result = await requeueOutboxEmail(row.id);
    if (result.ok) requeued += 1;
  }
  return { requeued };
}

let registered = false;

export function registerEmailJobHandlers(): void {
  if (registered) return;
  registered = true;

  registerJobHandler<EmailSendPayload>("email.send", async ({ job, payload, log }) => {
    if (typeof payload.outboxId !== "string" || !payload.outboxId) {
      throw new Error("email.send payload requires outboxId");
    }
    const result = await sendOutboxEmail(payload.outboxId, {
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
    });
    log(result.sent ? `sent via ${result.transport} (${result.messageId})` : `skipped: ${result.skipped}`);
    return result;
  });

  registerJobHandler(EMAIL_RETRY_FAILED_JOB, async ({ log }) => {
    const result = await retryFailedEmails();
    log(`requeued ${result.requeued} failed email(s)`);
    return result;
  });
}

/** True once enums.ts lists the retry job; the scheduler checks this. */
export function isEmailRetryJobKnown(): boolean {
  return (JOB_TYPES as readonly string[]).includes(EMAIL_RETRY_FAILED_JOB);
}
