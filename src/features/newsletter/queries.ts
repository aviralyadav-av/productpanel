import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { NEWSLETTER_STATUSES, type NewsletterStatus } from "@/lib/enums";
import { buildPageMeta, type ListParams } from "@/lib/list-params";

import type { NewsletterFilters, NewsletterSort } from "./schemas";
import type { NewsletterKpis, NewsletterStatusCounts, SubscriberListResult, SubscriberRow } from "./types";

/**
 * Read side of /admin/newsletter. Everything the screen needs is four cheap
 * queries; the growth sparkline is a single grouped scan rather than twelve
 * counts, because "how is the list growing" should not cost twelve round trips.
 */

const LIST_SELECT = {
  id: true,
  email: true,
  name: true,
  status: true,
  source: true,
  subscribedAt: true,
  unsubscribedAt: true,
  createdAt: true,
} satisfies Prisma.NewsletterSubscriberSelect;

type ListRow = Prisma.NewsletterSubscriberGetPayload<{ select: typeof LIST_SELECT }>;

function toRow(row: ListRow): SubscriberRow {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status as NewsletterStatus,
    source: row.source,
    subscribedAt: row.subscribedAt.toISOString(),
    unsubscribedAt: row.unsubscribedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function buildSubscriberWhere(
  filters: NewsletterFilters,
  options: { includeStatus?: boolean } = {},
): Prisma.NewsletterSubscriberWhereInput {
  const clauses: Prisma.NewsletterSubscriberWhereInput[] = [];
  if ((options.includeStatus ?? true) && filters.status) clauses.push({ status: filters.status });
  if (filters.source) clauses.push(filters.source === "none" ? { source: null } : { source: filters.source });
  if (filters.from || filters.to) clauses.push({ subscribedAt: { gte: filters.from, lte: filters.to } });
  if (filters.q) {
    const q = filters.q;
    clauses.push({
      OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { id: q }],
    });
  }
  return clauses.length > 0 ? { AND: clauses } : {};
}

function orderBy(sort: NewsletterSort, order: "asc" | "desc"): Prisma.NewsletterSubscriberOrderByWithRelationInput[] {
  switch (sort) {
    case "email":
      return [{ email: order }];
    case "name":
      return [{ name: { sort: order, nulls: "last" } }, { email: "asc" }];
    case "status":
      return [{ status: order }, { subscribedAt: "desc" }];
    case "source":
      return [{ source: { sort: order, nulls: "last" } }, { subscribedAt: "desc" }];
    default:
      return [{ subscribedAt: order }, { id: order }];
  }
}

export async function listSubscribers(
  params: ListParams & { sort: NewsletterSort },
  filters: NewsletterFilters,
): Promise<SubscriberListResult> {
  const where = buildSubscriberWhere(filters);
  const [total, rows] = await Promise.all([
    db.newsletterSubscriber.count({ where }),
    db.newsletterSubscriber.findMany({
      where,
      orderBy: orderBy(params.sort, params.order),
      skip: params.skip,
      take: params.pageSize,
      select: LIST_SELECT,
    }),
  ]);
  return { rows: rows.map(toRow), meta: buildPageMeta(total, params) };
}

/** One page of rows for the streamed export; same filters, no meta. */
export async function pageSubscribersForExport(
  filters: NewsletterFilters,
  sort: NewsletterSort,
  order: "asc" | "desc",
  skip: number,
  take: number,
): Promise<SubscriberRow[]> {
  const rows = await db.newsletterSubscriber.findMany({
    where: buildSubscriberWhere(filters),
    orderBy: orderBy(sort, order),
    skip,
    take,
    select: LIST_SELECT,
  });
  return rows.map(toRow);
}

export async function subscriberStatusCounts(filters: NewsletterFilters): Promise<NewsletterStatusCounts> {
  const grouped = await db.newsletterSubscriber.groupBy({
    by: ["status"],
    where: buildSubscriberWhere(filters, { includeStatus: false }),
    _count: { _all: true },
  });
  const counts = Object.fromEntries(NEWSLETTER_STATUSES.map((status) => [status, 0])) as Record<NewsletterStatus, number>;
  let all = 0;
  for (const row of grouped) {
    if ((NEWSLETTER_STATUSES as readonly string[]).includes(row.status)) counts[row.status as NewsletterStatus] = row._count._all;
    all += row._count._all;
  }
  return { ...counts, all };
}

/** Distinct sources for the filter dropdown (small list; a full scan is fine). */
export async function listSubscriberSources(): Promise<string[]> {
  const rows = await db.newsletterSubscriber.findMany({
    where: { source: { not: null } },
    distinct: ["source"],
    select: { source: true },
    orderBy: { source: "asc" },
    take: 50,
  });
  return rows.map((row) => row.source).filter((source): source is string => Boolean(source));
}

type MonthCount = { month: string; count: bigint | number };

function monthKeys(count: number, now: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let index = count - 1; index >= 0; index -= 1) {
    const month = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - index, 1));
    keys.push(`${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
}

/**
 * KPI strip: current list size, churn this month, bounces, and 12 months of
 * NET growth (joins minus unsubscribes) for the sparkline.
 */
export async function newsletterKpis(now = new Date()): Promise<NewsletterKpis> {
  const keys = monthKeys(12, now);
  const since = new Date(`${keys[0]}-01T00:00:00+05:30`);
  const monthStart = new Date(`${keys[keys.length - 1]}-01T00:00:00+05:30`);

  const [subscribed, bounced, unsubscribedThisMonth, addedThisMonth, joins, leaves] = await Promise.all([
    db.newsletterSubscriber.count({ where: { status: "SUBSCRIBED" } }),
    db.newsletterSubscriber.count({ where: { status: "BOUNCED" } }),
    db.newsletterSubscriber.count({ where: { status: "UNSUBSCRIBED", unsubscribedAt: { gte: monthStart } } }),
    db.newsletterSubscriber.count({ where: { subscribedAt: { gte: monthStart } } }),
    db.$queryRaw<MonthCount[]>`
      SELECT to_char(date_trunc('month', "subscribedAt" AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month,
             COUNT(*) AS count
      FROM "NewsletterSubscriber"
      WHERE "subscribedAt" >= ${since}
      GROUP BY 1
    `,
    db.$queryRaw<MonthCount[]>`
      SELECT to_char(date_trunc('month', "unsubscribedAt" AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month,
             COUNT(*) AS count
      FROM "NewsletterSubscriber"
      WHERE "unsubscribedAt" IS NOT NULL AND "unsubscribedAt" >= ${since}
      GROUP BY 1
    `,
  ]);

  const joinsByMonth = new Map(joins.map((row) => [row.month, Number(row.count)]));
  const leavesByMonth = new Map(leaves.map((row) => [row.month, Number(row.count)]));

  return {
    subscribed,
    unsubscribedThisMonth,
    bounced,
    addedThisMonth,
    growth: keys.map((key) => (joinsByMonth.get(key) ?? 0) - (leavesByMonth.get(key) ?? 0)),
    growthLabels: keys.map(monthLabel),
  };
}
