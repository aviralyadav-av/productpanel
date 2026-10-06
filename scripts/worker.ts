import "dotenv/config";
import { hostname } from "node:os";

import { db } from "@/lib/db";
import { listJobHandlers, runPendingJobs } from "@/lib/queue";
import { scheduleRecurringJobs } from "@/lib/queue/handlers/schedule";
import { registerAllJobHandlers } from "@/lib/queue/register-all";

/**
 * Long-running job worker (blueprint §10, F6). `npm run worker`.
 *
 * One process, one loop: every POLL_MS it claims up to BATCH due jobs with
 * `FOR UPDATE SKIP LOCKED` and runs them in sequence, and once a minute it
 * refreshes the recurring schedule. Several workers can run at once - the
 * claim is atomic - and a cron hitting /api/internal/jobs/run in parallel is
 * equally safe; `workerId` (host:pid) is what `Job.lockedBy` shows.
 *
 * Shutdown: SIGINT/SIGTERM stop claiming, let the in-flight job finish, then
 * disconnect. A hung SMTP socket cannot keep the process alive past 30 s.
 *
 * Runs as plain tsx: nothing on the import path may pull in `server-only` or
 * `next/*` statically (audit.ts and cache-tags.ts guard their Next imports).
 */

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const POLL_MS = positiveInt(process.env.WORKER_POLL_MS, 5_000);
const BATCH = Math.min(positiveInt(process.env.WORKER_BATCH, 20), 200);
const SCHEDULE_EVERY_MS = 60_000;
const ERROR_BACKOFF_MS = 15_000;
const SHUTDOWN_DEADLINE_MS = 30_000;

const workerId = `${hostname()}:${process.pid}`;
const tag = `[worker ${workerId}]`;

let stopping = false;
let wake: (() => void) | null = null;

/** Interruptible sleep so a shutdown signal does not wait out the poll. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = null;
      resolve();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = null;
      resolve();
    };
  });
}

async function main(): Promise<void> {
  registerAllJobHandlers();
  console.log(`${tag} started; poll ${POLL_MS} ms, batch ${BATCH}`);
  console.log(`${tag} handlers: ${listJobHandlers().sort().join(", ")}`);

  let lastScheduleAt = 0;

  while (!stopping) {
    try {
      if (Date.now() - lastScheduleAt >= SCHEDULE_EVERY_MS) {
        const scheduled = await scheduleRecurringJobs();
        lastScheduleAt = Date.now();
        if (scheduled.enqueued.length > 0) console.log(`${tag} scheduled: ${scheduled.enqueued.join(", ")}`);
        if (scheduled.emailRetry?.mode === "inline" && scheduled.emailRetry.requeued > 0) {
          console.log(`${tag} requeued ${scheduled.emailRetry.requeued} failed email(s)`);
        }
      }

      const summary = await runPendingJobs({ limit: BATCH, workerId });
      if (summary.claimed > 0 || summary.releasedStale > 0) {
        console.log(
          `${tag} claimed ${summary.claimed}: ${summary.completed} completed, ${summary.retried} retried, ${summary.failed} failed` +
            (summary.releasedStale > 0 ? `; released ${summary.releasedStale} stale lock(s)` : ""),
        );
      }

      if (stopping) break;
      // A full batch means there is probably more due work: go straight back.
      if (summary.claimed < BATCH) await sleep(POLL_MS);
    } catch (error) {
      // Typically the database is unreachable. Keep the process alive and
      // back off; systemd/pm2 restarts are for crashes, not for outages.
      console.error(`${tag} tick failed:`, error);
      if (!stopping) await sleep(ERROR_BACKOFF_MS);
    }
  }
}

function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`${tag} ${signal} received - finishing the current job, then exiting`);
  wake?.();
  setTimeout(() => {
    console.error(`${tag} shutdown deadline passed; exiting`);
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main()
  .then(async () => {
    await db.$disconnect();
    console.log(`${tag} stopped`);
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(`${tag} fatal:`, error);
    await db.$disconnect().catch(() => undefined);
    process.exit(1);
  });
