import { Prisma, type Job } from "@prisma/client";

import { db } from "@/lib/db";
import { JOB_STATUSES, jobTypeSchema, type JobStatus, type JobType } from "@/lib/enums";
import type {
  EnqueueOptions,
  EnqueueResult,
  JobHandler,
  JobPayload,
  JobRunOutcome,
  JobStats,
  RunPendingOptions,
  RunSummary,
} from "./types";

export type * from "./types";

/**
 * Postgres-backed job queue (blueprint §10, F6, §11.30).
 *
 * Why a table and not a broker: the platform already has exactly one durable,
 * transactional store, and a job that is enqueued inside the same transaction
 * as the business change it follows (an order's confirmation email) can never
 * be lost or sent for an order that rolled back. A broker would need an outbox
 * table to get that property - which is this table.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`, so several workers (or a cron hit
 * racing the long-running worker) never run the same job twice at once. They
 * MAY run it twice in sequence after a crash, which is why handlers are
 * idempotent and why `dedupeKey` exists.
 */

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LIMIT = 20;
/** A RUNNING job older than this is presumed orphaned by a dead worker. */
const STALE_LOCK_MINUTES = 10;
/** Backoff: 30s, 1m, 2m, 4m, 8m ... capped at 6h. */
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;
const MAX_ERROR_LENGTH = 2000;

// The registry lives on globalThis so the Next dev hot-reload does not silently
// forget handlers that a route module registered before the module re-ran.
const globalForQueue = globalThis as unknown as {
  __jobHandlers?: Map<string, JobHandler>;
};
const handlers: Map<string, JobHandler> =
  globalForQueue.__jobHandlers ?? (globalForQueue.__jobHandlers = new Map());

export function registerJobHandler<P extends JobPayload = JobPayload>(
  type: JobType,
  handler: JobHandler<P>,
): void {
  handlers.set(type, handler as JobHandler);
}

export function listJobHandlers(): JobType[] {
  return [...handlers.keys()] as JobType[];
}

export function hasJobHandler(type: string): boolean {
  return handlers.has(type);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

function errorMessage(error: unknown): string {
  const text =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}...` : text;
}

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS);
}

/**
 * Queue a job. Validates the type against JOB_TYPES so a misspelt job name
 * fails at the call site instead of sitting PENDING forever.
 */
export async function enqueue<P extends JobPayload>(
  type: JobType,
  payload: P,
  options: EnqueueOptions = {},
): Promise<EnqueueResult> {
  const parsedType = jobTypeSchema.parse(type);
  const client = options.tx ?? db;
  const data = {
    type: parsedType,
    payload: payload as Prisma.InputJsonValue,
    priority: options.priority ?? 0,
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    runAt: options.runAt ?? new Date(),
    dedupeKey: options.dedupeKey ?? null,
  };

  if (!options.dedupeKey) {
    const job = await client.job.create({ data, select: { id: true } });
    return { id: job.id, type: parsedType, deduplicated: false };
  }

  // The key means "at most one OPEN job", but the column is unique across all
  // rows. A finished job with the same key therefore releases its key before
  // the new one is created, so a recurring dedupe key (one facet recompute per
  // product) keeps working after the first run completes.
  const existing = await client.job.findUnique({
    where: { dedupeKey: options.dedupeKey },
    select: { id: true, status: true },
  });

  if (existing && (existing.status === "PENDING" || existing.status === "RUNNING")) {
    return { id: existing.id, type: parsedType, deduplicated: true };
  }

  if (existing) {
    await client.job.update({
      where: { id: existing.id },
      data: { dedupeKey: null },
    });
  }

  try {
    const job = await client.job.create({ data, select: { id: true } });
    return { id: job.id, type: parsedType, deduplicated: false };
  } catch (error) {
    // Two callers raced on the same key outside a transaction; the other one
    // won and its job is the one that will run. Inside a transaction Postgres
    // has already aborted it, so there is nothing to recover - rethrow.
    if (isUniqueViolation(error) && !options.tx) {
      const winner = await client.job.findUnique({
        where: { dedupeKey: options.dedupeKey },
        select: { id: true },
      });
      if (winner) return { id: winner.id, type: parsedType, deduplicated: true };
    }
    throw error;
  }
}

/** Put orphaned RUNNING jobs back in the queue. Returns how many. */
async function releaseStaleLocks(): Promise<number> {
  return db.$executeRaw`
    UPDATE "Job"
       SET status = 'PENDING', "lockedAt" = NULL, "lockedBy" = NULL,
           "lastError" = COALESCE("lastError", '') || ' [lock released: worker did not finish]',
           "updatedAt" = now()
     WHERE status = 'RUNNING'
       AND "lockedAt" < now() - make_interval(mins => ${STALE_LOCK_MINUTES})`;
}

/**
 * Atomically claim up to `limit` due jobs. `attempts` is incremented at claim
 * time so a worker that dies mid-run still burns an attempt and the job cannot
 * loop forever between crashes.
 */
async function claimJobs(
  limit: number,
  workerId: string,
  types?: readonly string[],
): Promise<Job[]> {
  const typeFilter =
    types && types.length > 0
      ? Prisma.sql`AND type IN (${Prisma.join([...types])})`
      : Prisma.empty;

  return db.$queryRaw<Job[]>`
    UPDATE "Job"
       SET status = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId},
           attempts = attempts + 1, "updatedAt" = now()
     WHERE id IN (
       SELECT id FROM "Job"
        WHERE status = 'PENDING' AND "runAt" <= now() ${typeFilter}
        ORDER BY priority DESC, "runAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING *`;
}

function payloadOf(job: Job): JobPayload {
  return job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
    ? (job.payload as JobPayload)
    : {};
}

async function runOne(job: Job): Promise<JobRunOutcome> {
  const startedAt = Date.now();
  const logLines: string[] = [];
  const handler = handlers.get(job.type);

  try {
    if (!handler) {
      throw new Error(`No handler registered for job type "${job.type}" in this process`);
    }

    const result = await handler({
      job,
      payload: payloadOf(job),
      log: (message) => {
        logLines.push(message);
        console.log(`[job ${job.type} ${job.id}] ${message}`);
      },
    });

    const stored: Record<string, Prisma.InputJsonValue> = {};
    if (result !== undefined) stored.result = result as Prisma.InputJsonValue;
    if (logLines.length > 0) stored.log = logLines;

    await db.job.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        result: stored,
      },
    });

    return {
      id: job.id,
      type: job.type,
      status: "COMPLETED",
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = errorMessage(error);
    const exhausted = job.attempts >= job.maxAttempts;
    console.error(`[job ${job.type} ${job.id}] attempt ${job.attempts} failed: ${message}`);

    await db.job.update({
      where: { id: job.id },
      data: exhausted
        ? {
            status: "FAILED",
            lockedAt: null,
            lockedBy: null,
            lastError: message,
            completedAt: new Date(),
          }
        : {
            status: "PENDING",
            lockedAt: null,
            lockedBy: null,
            lastError: message,
            runAt: new Date(Date.now() + backoffMs(job.attempts)),
          },
    });

    return {
      id: job.id,
      type: job.type,
      status: exhausted ? "FAILED" : "PENDING",
      durationMs: Date.now() - startedAt,
      error: message,
    };
  }
}

/**
 * One worker tick: release stale locks, claim due jobs, run them in sequence.
 * Sequential on purpose - handlers hit the same database and the same SMTP
 * server, and a burst of 20 parallel exports would starve the admin UI.
 */
export async function runPendingJobs(options: RunPendingOptions): Promise<RunSummary> {
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 200));
  const releasedStale = await releaseStaleLocks();
  const jobs = await claimJobs(limit, options.workerId, options.types);

  const summary: RunSummary = {
    releasedStale,
    claimed: jobs.length,
    completed: 0,
    retried: 0,
    failed: 0,
    outcomes: [],
  };

  for (const job of jobs) {
    const outcome = await runOne(job);
    summary.outcomes.push(outcome);
    if (outcome.status === "COMPLETED") summary.completed += 1;
    else if (outcome.status === "FAILED") summary.failed += 1;
    else summary.retried += 1;
  }

  return summary;
}

/** Reset a finished job so the next tick runs it again from attempt 1. */
export async function requeueJob(id: string): Promise<Job | null> {
  const job = await db.job.findUnique({ where: { id } });
  if (!job || job.status === "RUNNING") return null;

  return db.job.update({
    where: { id },
    data: {
      status: "PENDING",
      attempts: 0,
      runAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      completedAt: null,
    },
  });
}

/** Cancel a job that has not started. RUNNING jobs finish; finished ones are history. */
export async function cancelJob(id: string): Promise<boolean> {
  const result = await db.job.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "CANCELLED", completedAt: new Date() },
  });
  return result.count === 1;
}

export async function jobStats(): Promise<JobStats> {
  const [byStatusRows, openRows, failedRows, oldest] = await Promise.all([
    db.job.groupBy({ by: ["status"], _count: { _all: true } }),
    db.job.groupBy({
      by: ["type"],
      where: { status: { in: ["PENDING", "RUNNING"] } },
      _count: { _all: true },
    }),
    db.job.groupBy({ by: ["type"], where: { status: "FAILED" }, _count: { _all: true } }),
    db.job.findFirst({
      where: { status: "PENDING", runAt: { lte: new Date() } },
      orderBy: { runAt: "asc" },
      select: { runAt: true },
    }),
  ]);

  const byStatus = Object.fromEntries(
    JOB_STATUSES.map((status) => [status, 0]),
  ) as Record<JobStatus, number>;
  for (const row of byStatusRows) {
    if ((JOB_STATUSES as readonly string[]).includes(row.status)) {
      byStatus[row.status as JobStatus] = row._count._all;
    }
  }

  return {
    byStatus,
    openByType: Object.fromEntries(openRows.map((row) => [row.type, row._count._all])),
    failedByType: Object.fromEntries(failedRows.map((row) => [row.type, row._count._all])),
    oldestPendingRunAt: oldest?.runAt ?? null,
  };
}
