import { db } from "@/lib/db";
import { JOB_TYPES, type JobType } from "@/lib/enums";
import { enqueue, hasJobHandler } from "@/lib/queue";
import { EMAIL_RETRY_FAILED_JOB, isEmailRetryJobKnown, retryFailedEmails } from "@/features/email/handlers";
import { periodKey, type RecurringCadence } from "./period";

/**
 * Recurring job schedule (blueprint §10 job list, D6, D9, F6).
 *
 * `scheduleRecurringJobs()` is called by the worker once a minute and by every
 * `POST /api/internal/jobs/run`. It is idempotent: each entry gets at most one
 * Job row per period bucket (see period.ts), so calling it more often costs
 * one indexed lookup per entry and creates nothing.
 *
 * Entries owned by wave-3 modules are listed here already but are enqueued
 * ONLY once a handler for the type is registered in this process - a job that
 * nobody handles would sit PENDING, then fail five times with "no handler".
 * A module therefore gets its schedule for free the moment register-all.ts
 * imports its handlers; change the cadence here if the default is wrong.
 *
 * Recurring jobs run at a negative priority so that business jobs (emails,
 * pricing at a sale boundary, after-payment work) always go first.
 */

export type RecurringJob = {
  type: JobType;
  every: RecurringCadence;
  payload?: Record<string, unknown>;
  /** Who provides the handler, for the "skipped" diagnostics. */
  owner: string;
};

export const RECURRING_JOBS: readonly RecurringJob[] = [
  { type: "rate_limit.purge", every: "daily", owner: "platform" },
  { type: "uploads.purge_pending", every: "hourly", owner: "platform" },
  { type: "earnings.mark_available", every: "hourly", owner: "platform" },
  // Safety nets: both handlers chain themselves to the next real boundary.
  { type: "content.expire", every: "hourly", owner: "platform" },
  { type: "pricing.refresh", every: "daily", owner: "platform" },
  // Wave-3 modules (enqueued once their handler is registered).
  { type: "orders.expire_unpaid", every: "15min", owner: "orders" },
  { type: "orders.cancel_unconfirmed_cod", every: "hourly", owner: "orders" },
  { type: "promotions.expire", every: "hourly", owner: "promotions" },
  { type: "stock.check_low", every: "daily", owner: "inventory" },
];

const RECURRING_PRIORITY = -10;

export type ScheduleSummary = {
  enqueued: string[];
  /** A job for this bucket already exists (any status). */
  deduplicated: string[];
  skipped: { type: string; reason: string }[];
  emailRetry:
    | { mode: "job"; created: boolean }
    | { mode: "inline"; requeued: number }
    | null;
};

/**
 * `enqueue()`'s dedupeKey only guarantees at most one OPEN job: a finished job
 * releases its key to the next enqueue, which would re-run a completed hourly
 * job on every tick. The pre-check treats any row for this bucket - finished
 * or not - as "done for this period". Two schedulers racing on the same key
 * are resolved by the unique index inside enqueue().
 */
async function enqueueOncePerPeriod(
  type: JobType,
  every: RecurringCadence,
  payload: Record<string, unknown>,
  now: Date,
): Promise<"created" | "exists"> {
  const dedupeKey = periodKey(type, every, now);
  const existing = await db.job.findUnique({ where: { dedupeKey }, select: { id: true } });
  if (existing) return "exists";
  const result = await enqueue(type, payload, { dedupeKey, priority: RECURRING_PRIORITY });
  return result.deduplicated ? "exists" : "created";
}

export async function scheduleRecurringJobs(now: Date = new Date()): Promise<ScheduleSummary> {
  const summary: ScheduleSummary = { enqueued: [], deduplicated: [], skipped: [], emailRetry: null };

  for (const job of RECURRING_JOBS) {
    if (!(JOB_TYPES as readonly string[]).includes(job.type)) {
      summary.skipped.push({ type: job.type, reason: "not in JOB_TYPES" });
      continue;
    }
    if (!hasJobHandler(job.type)) {
      summary.skipped.push({ type: job.type, reason: `no handler registered (owner: ${job.owner})` });
      continue;
    }
    const outcome = await enqueueOncePerPeriod(job.type, job.every, job.payload ?? {}, now);
    (outcome === "created" ? summary.enqueued : summary.deduplicated).push(job.type);
  }

  // Failed-email retry: a proper hourly job once enums.ts lists
  // "email.retry_failed"; until then the sweep runs inline. It is cheap (one
  // indexed query) and self-throttling - retryFailedEmails() only touches rows
  // whose last attempt is more than an hour old.
  if (isEmailRetryJobKnown() && hasJobHandler(EMAIL_RETRY_FAILED_JOB)) {
    const outcome = await enqueueOncePerPeriod(EMAIL_RETRY_FAILED_JOB, "hourly", {}, now);
    summary.emailRetry = { mode: "job", created: outcome === "created" };
  } else {
    const result = await retryFailedEmails(now);
    summary.emailRetry = { mode: "inline", requeued: result.requeued };
  }

  return summary;
}
