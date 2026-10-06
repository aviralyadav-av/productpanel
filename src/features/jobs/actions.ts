"use server";

import { revalidatePath } from "next/cache";

import { ok, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { conflict, notFound } from "@/lib/api/errors";
import { cancelJob, requeueJob, runPendingJobs } from "@/lib/queue";
import { scheduleRecurringJobs } from "@/lib/queue/handlers/schedule";
import { registerAllJobHandlers } from "@/lib/queue/register-all";

import { getJob } from "./queries";
import { RUN_PENDING_LIMIT, RUN_PENDING_WORKER_ID, type RunSummaryView } from "./schemas";

/**
 * Server Actions for /admin/jobs (D14 `jobs.view` / `jobs.manage`).
 *
 * These mirror `POST /api/admin/jobs/:id` exactly - the infra module shipped
 * the REST side, this is the same three operations for the screen. Both are
 * audited: requeueing a payout job or cancelling an email is an operational
 * decision with money or customer contact behind it (D13).
 */

const PATH = "/admin/jobs";

export async function requeueJobAction(
  id: string,
): Promise<ActionResult<{ id: string; status: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("jobs.manage");

    const before = await getJob(id);
    if (!before) throw notFound("Job");
    if (before.status === "RUNNING") {
      throw conflict(
        "This job is running. Wait for it to finish, or for its 10-minute lock to expire, before requeueing.",
      );
    }

    const job = await requeueJob(id);
    if (!job) throw conflict("The job changed state while requeueing; reload and try again.");

    await writeAudit({
      actor,
      action: "jobs.requeue",
      entityType: "Job",
      entityId: job.id,
      entityLabel: job.type,
      summary: `Requeued ${job.type} job ${job.id} (was ${before.status}, ${before.attempts} attempt(s)).`,
      diff: { status: { from: before.status, to: job.status }, attempts: { from: before.attempts, to: 0 } },
    });

    revalidatePath(PATH);
    return ok({ id: job.id, status: job.status }, `Requeued ${job.type}. It runs on the next worker poll.`);
  });
}

export async function cancelJobAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("jobs.manage");

    const before = await getJob(id);
    if (!before) throw notFound("Job");

    const cancelled = await cancelJob(id);
    if (!cancelled) throw conflict(`Only PENDING jobs can be cancelled; this job is ${before.status}.`);

    await writeAudit({
      actor,
      action: "jobs.cancel",
      entityType: "Job",
      entityId: before.id,
      entityLabel: before.type,
      summary: `Cancelled ${before.type} job ${before.id} (was ${before.status}).`,
      diff: { status: { from: before.status, to: "CANCELLED" } },
    });

    revalidatePath(PATH);
    return ok({ id: before.id }, `Cancelled ${before.type}.`);
  });
}

export type RunPendingResult = {
  summary: RunSummaryView;
  scheduled: { enqueued: string[]; skipped: { type: string; reason: string }[] };
};

/**
 * "Run pending now": registers every handler in THIS process, tops up the
 * recurring schedule, then drains up to 20 due jobs inline.
 *
 * This exists because the worker is a separate process an operator may not
 * have running (a fresh deploy, a demo, a laptop). It is not a replacement
 * for it: the request is capped at 20 jobs so it cannot outlive a serverless
 * invocation, and `workerId` is `admin-ui` so a job claimed here is
 * distinguishable in `lockedBy` when someone asks who ran it.
 */
export async function runPendingJobsAction(): Promise<ActionResult<RunPendingResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("jobs.manage");

    registerAllJobHandlers();
    const scheduled = await scheduleRecurringJobs();
    const summary = await runPendingJobs({ limit: RUN_PENDING_LIMIT, workerId: RUN_PENDING_WORKER_ID });

    await writeAudit({
      actor,
      action: "jobs.run",
      entityType: "Job",
      entityId: null,
      entityLabel: RUN_PENDING_WORKER_ID,
      summary: `Ran the queue from the admin UI: claimed ${summary.claimed}, completed ${summary.completed}, retried ${summary.retried}, failed ${summary.failed}.`,
      diff: {
        claimed: summary.claimed,
        completed: summary.completed,
        retried: summary.retried,
        failed: summary.failed,
        releasedStale: summary.releasedStale,
        enqueuedRecurring: scheduled.enqueued,
      },
    });

    revalidatePath(PATH);

    const message =
      summary.claimed === 0
        ? "Nothing was due. The queue is empty or every job is scheduled for later."
        : `Ran ${summary.claimed} job${summary.claimed === 1 ? "" : "s"}: ${summary.completed} completed, ${summary.retried} will retry, ${summary.failed} failed for good.`;

    return ok(
      {
        summary: {
          releasedStale: summary.releasedStale,
          claimed: summary.claimed,
          completed: summary.completed,
          retried: summary.retried,
          failed: summary.failed,
          outcomes: summary.outcomes.map((outcome) => ({
            id: outcome.id,
            type: outcome.type,
            status: outcome.status,
            durationMs: outcome.durationMs,
            error: outcome.error,
          })),
        },
        scheduled: { enqueued: scheduled.enqueued, skipped: scheduled.skipped },
      },
      message,
    );
  });
}
