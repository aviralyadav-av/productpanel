import type { EmailOutbox, Job, Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  EMAIL_OUTBOX_STATUSES,
  JOB_STATUSES,
  JOB_TYPES,
  type EmailOutboxStatus,
  type JobStatus,
} from "@/lib/enums";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";
import { jobStats, listJobHandlers, type JobStats } from "@/lib/queue";
import { RECURRING_JOBS } from "@/lib/queue/handlers/schedule";

import type {
  JobDetailView,
  JobFilters,
  JobRowView,
  JobsPageData,
  RecurringJobView,
} from "./schemas";

/**
 * Read models for the Jobs and Email outbox admin pages (blueprint §2 System ->
 * Jobs / Email outbox, D14 `jobs.view` / `email_outbox.view`).
 *
 * Lists omit the wide columns (job payload/result, email bodies): a page of 25
 * rows should not ship 25 rendered HTML emails. The detail readers return the
 * full row. Both lists sort with `id` as a tiebreaker so paging is stable when
 * many rows share a timestamp.
 */

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const JOB_SORTS = ["createdAt", "runAt", "updatedAt", "completedAt", "priority", "attempts", "type", "status"] as const;
export type JobSort = (typeof JOB_SORTS)[number];

export type JobListFilters = {
  status?: string | null;
  type?: string | null;
  /** Matches id exactly, or type / lastError / dedupeKey / lockedBy by substring. */
  q?: string | null;
};

export type JobListRow = Omit<Job, "payload" | "result">;

const JOB_LIST_SELECT = {
  id: true,
  type: true,
  status: true,
  priority: true,
  attempts: true,
  maxAttempts: true,
  runAt: true,
  lockedAt: true,
  lockedBy: true,
  lastError: true,
  dedupeKey: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
} satisfies Prisma.JobSelect;

function isJobStatus(value: string): value is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value);
}

function isJobSort(value: string): value is JobSort {
  return (JOB_SORTS as readonly string[]).includes(value);
}

export function buildJobWhere(filters: JobListFilters): Prisma.JobWhereInput {
  const where: Prisma.JobWhereInput = {};
  const status = filters.status?.trim();
  if (status && isJobStatus(status)) where.status = status;
  const type = filters.type?.trim();
  if (type) where.type = type;

  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { id: q },
      { type: { contains: q, mode: "insensitive" } },
      { lastError: { contains: q, mode: "insensitive" } },
      { dedupeKey: { contains: q, mode: "insensitive" } },
      { lockedBy: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

export async function listJobs(
  params: ListParams,
  filters: JobListFilters = {},
): Promise<{ rows: JobListRow[]; meta: PageMeta }> {
  const where = buildJobWhere({ ...filters, q: filters.q ?? params.q });
  const sort: JobSort = isJobSort(params.sort) ? params.sort : "createdAt";

  const [rows, total] = await Promise.all([
    db.job.findMany({
      where,
      select: JOB_LIST_SELECT,
      orderBy: [{ [sort]: params.order }, { id: params.order }],
      skip: params.skip,
      take: params.pageSize,
    }),
    db.job.count({ where }),
  ]);

  return { rows, meta: buildPageMeta(total, params) };
}

export async function getJob(id: string): Promise<Job | null> {
  return db.job.findUnique({ where: { id } });
}

export type JobsOverview = {
  stats: JobStats;
  /** Every type enums.ts knows. */
  knownTypes: readonly string[];
  /** Types with a handler in THIS process (the web server's view, not necessarily the worker's). */
  registeredTypes: string[];
  /** Distinct types that actually have rows, for the filter dropdown. */
  presentTypes: string[];
};

export async function jobsOverview(): Promise<JobsOverview> {
  const [stats, present] = await Promise.all([
    jobStats(),
    db.job.groupBy({ by: ["type"], orderBy: { type: "asc" } }),
  ]);
  return {
    stats,
    knownTypes: JOB_TYPES,
    registeredTypes: listJobHandlers().sort(),
    presentTypes: present.map((row) => row.type),
  };
}

// ---------------------------------------------------------------------------
// Email outbox
// ---------------------------------------------------------------------------

export const EMAIL_OUTBOX_SORTS = [
  "createdAt",
  "scheduledAt",
  "sentAt",
  "status",
  "attempts",
  "toEmail",
  "subject",
  "templateKey",
] as const;
export type EmailOutboxSort = (typeof EMAIL_OUTBOX_SORTS)[number];

export type EmailOutboxFilters = {
  status?: string | null;
  templateKey?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Matches id exactly, or recipient / subject / lastError by substring. */
  q?: string | null;
};

export type EmailOutboxListRow = Omit<EmailOutbox, "htmlBody" | "textBody">;

const OUTBOX_LIST_SELECT = {
  id: true,
  templateKey: true,
  toEmail: true,
  toName: true,
  subject: true,
  status: true,
  attempts: true,
  lastError: true,
  providerMessageId: true,
  dedupeKey: true,
  scheduledAt: true,
  sentAt: true,
  entityType: true,
  entityId: true,
  createdAt: true,
} satisfies Prisma.EmailOutboxSelect;

function isOutboxStatus(value: string): value is EmailOutboxStatus {
  return (EMAIL_OUTBOX_STATUSES as readonly string[]).includes(value);
}

function isOutboxSort(value: string): value is EmailOutboxSort {
  return (EMAIL_OUTBOX_SORTS as readonly string[]).includes(value);
}

export function buildEmailOutboxWhere(filters: EmailOutboxFilters): Prisma.EmailOutboxWhereInput {
  const where: Prisma.EmailOutboxWhereInput = {};
  const status = filters.status?.trim();
  if (status && isOutboxStatus(status)) where.status = status;
  const templateKey = filters.templateKey?.trim();
  if (templateKey) where.templateKey = templateKey;
  const entityType = filters.entityType?.trim();
  if (entityType) where.entityType = entityType;
  const entityId = filters.entityId?.trim();
  if (entityId) where.entityId = entityId;

  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { id: q },
      { toEmail: { contains: q, mode: "insensitive" } },
      { toName: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
      { lastError: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

export async function listEmailOutbox(
  params: ListParams,
  filters: EmailOutboxFilters = {},
): Promise<{ rows: EmailOutboxListRow[]; meta: PageMeta }> {
  const where = buildEmailOutboxWhere({ ...filters, q: filters.q ?? params.q });
  const sort: EmailOutboxSort = isOutboxSort(params.sort) ? params.sort : "createdAt";

  const [rows, total] = await Promise.all([
    db.emailOutbox.findMany({
      where,
      select: OUTBOX_LIST_SELECT,
      orderBy: [{ [sort]: params.order }, { id: params.order }],
      skip: params.skip,
      take: params.pageSize,
    }),
    db.emailOutbox.count({ where }),
  ]);

  return { rows, meta: buildPageMeta(total, params) };
}

export async function getEmailOutboxItem(id: string): Promise<EmailOutbox | null> {
  return db.emailOutbox.findUnique({ where: { id } });
}

export type EmailOutboxStats = {
  byStatus: Record<EmailOutboxStatus, number>;
  /** FAILED rows created in the last 24 h - the ones the retry sweep still cares about. */
  failedLast24h: number;
  /** Oldest QUEUED row that is due, a direct measure of worker lag. */
  oldestDueQueuedAt: Date | null;
};

export async function emailOutboxStats(now = new Date()): Promise<EmailOutboxStats> {
  const [grouped, failedLast24h, oldestDue] = await Promise.all([
    db.emailOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
    db.emailOutbox.count({
      where: { status: "FAILED", createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    }),
    db.emailOutbox.findFirst({
      where: { status: "QUEUED", scheduledAt: { lte: now } },
      orderBy: { scheduledAt: "asc" },
      select: { scheduledAt: true },
    }),
  ]);

  const byStatus = Object.fromEntries(EMAIL_OUTBOX_STATUSES.map((status) => [status, 0])) as Record<
    EmailOutboxStatus,
    number
  >;
  for (const row of grouped) {
    if (isOutboxStatus(row.status)) byStatus[row.status] = row._count._all;
  }

  return { byStatus, failedLast24h, oldestDueQueuedAt: oldestDue?.scheduledAt ?? null };
}

// ---------------------------------------------------------------------------
// /admin/jobs read model (wave 3)
// ---------------------------------------------------------------------------

/**
 * Everything the jobs page renders, in client-safe shapes. Added here rather
 * than in a second file so the infra module's readers above and the screen's
 * readers stay next to each other - they query the same two tables and share
 * the "which types exist / which have handlers" answer.
 *
 * IMPORTANT about `hasHandler`: it reports the WEB process's registry. The
 * worker is a separate process (`npm run worker`), so a type can be handled
 * there and unregistered here. The page says as much rather than pretending
 * one number covers both.
 */

function toJobRowView(row: JobListRow, registered: ReadonlySet<string>): JobRowView {
  return {
    id: row.id,
    type: row.type,
    status: (JOB_STATUSES as readonly string[]).includes(row.status) ? (row.status as JobStatus) : "PENDING",
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    runAt: row.runAt.toISOString(),
    lockedAt: row.lockedAt?.toISOString() ?? null,
    lockedBy: row.lockedBy,
    lastError: row.lastError,
    dedupeKey: row.dedupeKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    hasHandler: registered.has(row.type),
  };
}

function jobWhereFromFilters(filters: JobFilters): Prisma.JobWhereInput {
  const where = buildJobWhere({ status: filters.status ?? null, type: filters.type ?? null, q: filters.q || null });
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  return where;
}

export async function listJobRows(
  params: ListParams,
  filters: JobFilters,
): Promise<{ rows: JobRowView[]; meta: PageMeta; total: number }> {
  const where = jobWhereFromFilters(filters);
  const sort: JobSort = isJobSort(params.sort) ? params.sort : "createdAt";
  const registered = new Set(listJobHandlers());

  const [rows, total] = await Promise.all([
    db.job.findMany({
      where,
      select: JOB_LIST_SELECT,
      orderBy: [{ [sort]: params.order }, { id: params.order }],
      skip: params.skip,
      take: params.pageSize,
    }),
    db.job.count({ where }),
  ]);

  return { rows: rows.map((row) => toJobRowView(row, registered)), meta: buildPageMeta(total, params), total };
}

/** Counts for the status tabs, computed with the status filter dropped. */
export async function jobStatusCounts(
  filters: JobFilters,
): Promise<Record<JobStatus, number> & { all: number }> {
  const grouped = await db.job.groupBy({
    by: ["status"],
    where: jobWhereFromFilters({ ...filters, status: undefined }),
    _count: { _all: true },
  });

  const counts = Object.fromEntries(JOB_STATUSES.map((status) => [status, 0])) as Record<JobStatus, number>;
  let all = 0;
  for (const row of grouped) {
    all += row._count._all;
    if (isJobStatus(row.status)) counts[row.status as JobStatus] = row._count._all;
  }
  return { ...counts, all };
}

export async function getJobDetail(id: string): Promise<JobDetailView | null> {
  const row = await getJob(id);
  if (!row) return null;
  const registered = new Set(listJobHandlers());
  const { payload, result, ...rest } = row;
  return {
    ...toJobRowView(rest as JobListRow, registered),
    payload: payload as unknown,
    result: (result ?? null) as unknown,
  };
}

const CADENCE_MS: Record<string, number> = {
  "15min": 15 * 60_000,
  hourly: 60 * 60_000,
  daily: 24 * 60 * 60_000,
};

/**
 * The recurring schedule with its real state: when each cadence last produced
 * a Job row, how that run ended, and when the next bucket is due. A row with
 * `hasHandler: false` is the important one - `scheduleRecurringJobs()` skips
 * those, so the cadence is documented but dormant.
 */
export async function recurringJobStatus(now = new Date()): Promise<RecurringJobView[]> {
  const registered = new Set(listJobHandlers());

  return Promise.all(
    RECURRING_JOBS.map(async (entry) => {
      const last = await db.job.findFirst({
        where: { type: entry.type },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, status: true, completedAt: true },
      });
      const size = CADENCE_MS[entry.every] ?? CADENCE_MS.hourly;
      const nextExpectedAt = new Date(Math.floor(now.getTime() / size) * size + size);

      return {
        type: entry.type,
        every: entry.every,
        owner: entry.owner,
        hasHandler: registered.has(entry.type),
        lastRunAt: (last?.completedAt ?? last?.createdAt)?.toISOString() ?? null,
        lastStatus: last && isJobStatus(last.status) ? (last.status as JobStatus) : null,
        nextExpectedAt: registered.has(entry.type) ? nextExpectedAt.toISOString() : null,
      };
    }),
  );
}

export async function jobsPageData(now = new Date()): Promise<JobsPageData> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [overview, completed24h, failed24h, recurring] = await Promise.all([
    jobsOverview(),
    db.job.count({ where: { status: "COMPLETED", completedAt: { gte: dayAgo } } }),
    db.job.count({ where: { status: "FAILED", updatedAt: { gte: dayAgo } } }),
    recurringJobStatus(now),
  ]);

  return {
    stats: {
      byStatus: overview.stats.byStatus,
      openByType: overview.stats.openByType,
      failedByType: overview.stats.failedByType,
      oldestPendingRunAt: overview.stats.oldestPendingRunAt?.toISOString() ?? null,
      completed24h,
      failed24h,
      // Computed here rather than in the banner: a component that reads the
      // clock during render is impure, and this is a server answer anyway.
      workerLagging: overview.stats.oldestPendingRunAt
        ? now.getTime() - overview.stats.oldestPendingRunAt.getTime() > 15 * 60_000
        : false,
    },
    knownTypes: [...overview.knownTypes],
    registeredTypes: overview.registeredTypes,
    presentTypes: overview.presentTypes,
    recurring,
  };
}
