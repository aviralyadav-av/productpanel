import type { Job, Prisma } from "@prisma/client";

import type { JobStatus, JobType } from "@/lib/enums";

/**
 * The job queue is a Postgres table (`Job`), not a broker. At this scale a
 * `FOR UPDATE SKIP LOCKED` claim is simpler to operate than Redis and gives
 * the same at-least-once guarantee - which is why every handler must be
 * idempotent (§11.30): a job that succeeds after the worker crashed before
 * marking it COMPLETED will run twice.
 */

export type JobPayload = Record<string, unknown>;

export type JobContext<P extends JobPayload = JobPayload> = {
  job: Job;
  payload: P;
  /** Appends to the job's result log; also echoed to stdout by the worker. */
  log: (message: string) => void;
};

/**
 * A handler's return value is stored in `Job.result` (must be JSON-serialisable)
 * so the admin jobs page can show what a run actually did.
 */
export type JobHandler<P extends JobPayload = JobPayload> = (
  ctx: JobContext<P>,
) => Promise<unknown>;

export type EnqueueOptions = {
  runAt?: Date;
  /** Higher runs first among due jobs. Default 0. */
  priority?: number;
  /** Default 5. */
  maxAttempts?: number;
  /**
   * At most one PENDING/RUNNING job per key (F6). A second enqueue with the same
   * key while one is open returns the existing job and creates nothing.
   */
  dedupeKey?: string;
  /** Compose with the caller's transaction so the job commits with the change. */
  tx?: Prisma.TransactionClient;
};

export type EnqueueResult = {
  id: string;
  type: JobType;
  /** True when an open job with the same dedupeKey already existed. */
  deduplicated: boolean;
};

export type RunPendingOptions = {
  /** Jobs claimed per call. Default 20. */
  limit?: number;
  /** Identifies this worker in `Job.lockedBy` for stale-lock diagnosis. */
  workerId: string;
  /** Only claim these types (a dedicated worker). Default: every registered type. */
  types?: readonly string[];
};

export type JobRunOutcome = {
  id: string;
  type: string;
  status: Extract<JobStatus, "COMPLETED" | "FAILED" | "PENDING">;
  durationMs: number;
  error?: string;
};

export type RunSummary = {
  releasedStale: number;
  claimed: number;
  completed: number;
  /** Failed and scheduled for another attempt. */
  retried: number;
  /** Failed for good (attempts exhausted). */
  failed: number;
  outcomes: JobRunOutcome[];
};

export type JobStats = {
  byStatus: Record<JobStatus, number>;
  /** PENDING + RUNNING per type, for the jobs page. */
  openByType: Record<string, number>;
  failedByType: Record<string, number>;
  /** Oldest due-but-unclaimed job, a direct measure of worker lag. */
  oldestPendingRunAt: Date | null;
};
