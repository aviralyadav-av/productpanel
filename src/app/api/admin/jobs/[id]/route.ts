import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { conflict, notFound } from "@/lib/api/errors";
import { cancelJob, requeueJob } from "@/lib/queue";
import { getJob } from "@/features/jobs/queries";

/**
 * GET  /api/admin/jobs/:id                          full row incl. payload + result   (jobs.view)
 * POST /api/admin/jobs/:id { action: requeue|cancel }                                  (jobs.manage)
 *
 * requeue: any non-RUNNING job goes back to PENDING at attempt 0 - the way to
 *          rerun a FAILED job after fixing its cause, or a COMPLETED one on
 *          purpose. A RUNNING job is left alone; if its worker died the stale
 *          lock is released automatically after 10 minutes.
 * cancel:  PENDING only. RUNNING jobs finish; finished jobs are history.
 * Both are audited (D13) with the previous status.
 */

const actionSchema = z.object({ action: z.enum(["requeue", "cancel"]) });

export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const job = await getJob(params.id);
    if (!job) throw notFound("Job");
    return apiOk(job);
  },
  { permission: "jobs.view" },
);

export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const { action } = await parseJsonBody(req, actionSchema);
    const before = await getJob(params.id);
    if (!before) throw notFound("Job");
    const userAgent = req.headers.get("user-agent");

    if (action === "requeue") {
      if (before.status === "RUNNING") {
        throw conflict("This job is running. Wait for it to finish, or for its lock to expire, before requeueing.");
      }
      const job = await requeueJob(params.id);
      if (!job) throw conflict("The job changed state while requeueing; reload and try again.");

      await writeAudit({
        actor,
        action: "jobs.requeue",
        entityType: "Job",
        entityId: job.id,
        entityLabel: job.type,
        summary: `Requeued ${job.type} job ${job.id} (was ${before.status}, ${before.attempts} attempt(s)).`,
        diff: { status: { from: before.status, to: job.status }, attempts: { from: before.attempts, to: 0 } },
        ip,
        userAgent,
      });
      return apiOk(job);
    }

    const cancelled = await cancelJob(params.id);
    if (!cancelled) throw conflict(`Only PENDING jobs can be cancelled; this job is ${before.status}.`);
    const job = await getJob(params.id);

    await writeAudit({
      actor,
      action: "jobs.cancel",
      entityType: "Job",
      entityId: before.id,
      entityLabel: before.type,
      summary: `Cancelled ${before.type} job ${before.id} (was ${before.status}).`,
      diff: { status: { from: before.status, to: "CANCELLED" } },
      ip,
      userAgent,
    });
    return apiOk(job);
  },
  { permission: "jobs.manage" },
);
