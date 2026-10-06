import { hostname } from "node:os";
import type { NextRequest } from "next/server";

import { SYSTEM_ACTOR, writeAudit } from "@/lib/audit";
import { ApiError, rateLimited, toErrorResponse } from "@/lib/api/errors";
import { clientIp } from "@/lib/client-ip";
import { constantTimeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { runPendingJobs } from "@/lib/queue";
import { scheduleRecurringJobs } from "@/lib/queue/handlers/schedule";
import { registerAllJobHandlers } from "@/lib/queue/register-all";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";

/**
 * POST /api/internal/jobs/run (blueprint §14.D8).
 *
 * The cron alternative to `npm run worker` for hosts without a long-running
 * process: an external scheduler POSTs here every minute with
 * `X-Cron-Secret: $CRON_SECRET`, and one batch of due jobs runs inside the
 * request. It is not an admin route (no session, no CSRF - the secret is the
 * credential) and not a public route (no CORS).
 *
 *   503  CRON_SECRET unset or shorter than 32 bytes - a deployment error,
 *        reported as such rather than as a 401 that sends someone hunting
 *        for a typo in the scheduler.
 *   401  wrong secret (constant-time compare; audited, rate-limited per IP so
 *        a brute force cannot flood the audit log).
 *   200  `{ data: { workerId, scheduled, releasedStale, claimed, ... } }`
 *
 * Runs are audited as the SYSTEM actor when they did something (a claim, a
 * stale lock release or a newly scheduled job); an idle minute writes nothing.
 */

export const dynamic = "force-dynamic";
/** Serverless hosts kill the function at their limit; keep batches modest. */
export const maxDuration = 60;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const MIN_SECRET_BYTES = 32;

export async function POST(req: NextRequest): Promise<Response> {
  const ip = clientIp(req.headers);
  const userAgent = req.headers.get("user-agent");

  try {
    const secret = env.CRON_SECRET;
    if (!secret || Buffer.byteLength(secret) < MIN_SECRET_BYTES) {
      throw new ApiError(503, "INTERNAL", "Cron is not configured: set CRON_SECRET (at least 32 bytes).");
    }

    const limited = await rateLimit(rateLimitKey("internal", "jobs.run", ip), { limit: 60, windowMs: 60_000 });
    if (!limited.ok) throw rateLimited(limited.retryAfterSec);

    const provided = req.headers.get("x-cron-secret") ?? "";
    if (!provided || !constantTimeEqual(provided, secret)) {
      await writeAudit({
        actor: SYSTEM_ACTOR,
        action: "jobs.cron_rejected",
        entityType: "Job",
        summary: `Rejected POST /api/internal/jobs/run from ${ip}: ${provided ? "wrong" : "missing"} X-Cron-Secret.`,
        ip,
        userAgent,
      });
      throw new ApiError(401, "UNAUTHORIZED", "Invalid cron secret.");
    }

    const requested = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "", 10);
    const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), MAX_LIMIT) : DEFAULT_LIMIT;
    const workerId = `cron:${hostname()}:${process.pid}`;

    registerAllJobHandlers();
    const scheduled = await scheduleRecurringJobs();
    const summary = await runPendingJobs({ limit, workerId });

    const didSomething = summary.claimed > 0 || summary.releasedStale > 0 || scheduled.enqueued.length > 0;
    if (didSomething) {
      await writeAudit({
        actor: SYSTEM_ACTOR,
        action: "jobs.cron_run",
        entityType: "Job",
        summary:
          `Cron batch (${workerId}): ${summary.claimed} claimed, ${summary.completed} completed, ` +
          `${summary.retried} retried, ${summary.failed} failed, ${summary.releasedStale} stale lock(s) released; ` +
          `scheduled ${scheduled.enqueued.join(", ") || "nothing new"}.`,
        diff: {
          limit,
          claimed: summary.claimed,
          completed: summary.completed,
          retried: summary.retried,
          failed: summary.failed,
          releasedStale: summary.releasedStale,
          scheduled: scheduled.enqueued,
          failures: summary.outcomes
            .filter((outcome) => outcome.status !== "COMPLETED")
            .map((outcome) => ({ id: outcome.id, type: outcome.type, status: outcome.status, error: outcome.error ?? null })),
        },
        ip,
        userAgent,
      });
    }

    return Response.json(
      {
        data: {
          workerId,
          scheduled,
          releasedStale: summary.releasedStale,
          claimed: summary.claimed,
          completed: summary.completed,
          retried: summary.retried,
          failed: summary.failed,
          outcomes: summary.outcomes,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
