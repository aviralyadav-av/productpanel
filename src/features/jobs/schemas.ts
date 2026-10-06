import { z } from "zod";

import { JOB_STATUSES, type JobStatus } from "@/lib/enums";
import { one, type SearchParams } from "@/lib/list-params";

/**
 * Client-safe vocabulary for /admin/jobs: the URL contract, the action inputs
 * and the view models the components render.
 *
 * queries.ts imports Prisma, so the table and the detail sheet cannot import
 * it; everything they need to know about a job's SHAPE lives here.
 */

export type JobFilters = {
  q: string;
  status?: JobStatus;
  type?: string;
  from?: Date;
  to?: Date;
};

/** `from`/`to` are IST calendar days (the DateRangePicker writes yyyy-mm-dd). */
export function parseIstDayParam(value: string | undefined, end: boolean): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseJobFilters(params: SearchParams): JobFilters {
  const status = one(params, "status");
  return {
    q: (one(params, "q") ?? "").trim(),
    status: (JOB_STATUSES as readonly string[]).includes(status ?? "") ? (status as JobStatus) : undefined,
    type: one(params, "type") || undefined,
    from: parseIstDayParam(one(params, "from"), false),
    to: parseIstDayParam(one(params, "to"), true),
  };
}

export function hasJobFilters(filters: JobFilters): boolean {
  return Boolean(filters.q || filters.status || filters.type || filters.from || filters.to);
}

export const jobIdSchema = z.string().min(1, "Pick a job.");
export const jobActionSchema = z.object({ action: z.enum(["requeue", "cancel"]) });

export const RUN_PENDING_LIMIT = 20;
export const RUN_PENDING_WORKER_ID = "admin-ui";

// ---------------------------------------------------------------------------
// Client-safe view models (dates as ISO strings)
// ---------------------------------------------------------------------------

export type JobRowView = {
  id: string;
  type: string;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  dedupeKey: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** False when nothing in this process handles the type - the job cannot run. */
  hasHandler: boolean;
};

export type JobDetailView = JobRowView & {
  payload: unknown;
  result: unknown;
};

export type JobStatsView = {
  byStatus: Record<JobStatus, number>;
  openByType: Record<string, number>;
  failedByType: Record<string, number>;
  oldestPendingRunAt: string | null;
  /** COMPLETED in the last 24 h - the "is anything actually running?" number. */
  completed24h: number;
  failed24h: number;
  /** The oldest due job has been waiting long enough that nothing is polling. */
  workerLagging: boolean;
};

export type RecurringJobView = {
  type: string;
  every: string;
  owner: string;
  /** A cadence only starts once something registers a handler for the type. */
  hasHandler: boolean;
  lastRunAt: string | null;
  lastStatus: JobStatus | null;
  nextExpectedAt: string | null;
};

export type JobsPageData = {
  stats: JobStatsView;
  knownTypes: string[];
  registeredTypes: string[];
  presentTypes: string[];
  recurring: RecurringJobView[];
};

export type RunSummaryView = {
  releasedStale: number;
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
  outcomes: { id: string; type: string; status: string; durationMs: number; error?: string }[];
};

/** Human cadence labels for the scheduler table. */
export const CADENCE_LABELS: Record<string, string> = {
  "15min": "Every 15 minutes",
  hourly: "Hourly",
  daily: "Daily",
};
