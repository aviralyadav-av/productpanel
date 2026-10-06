import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_TYPES,
  type NotificationSeverity,
  type NotificationType,
} from "@/lib/enums";
import { startOfIstDay } from "@/lib/dates";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";

import type { NotificationFilters, NotificationRow } from "./schemas";

/**
 * The read side of the notification centre (blueprint §1 Notifications, §10).
 *
 * Every query is scoped to ONE user id. Notifications are fanned out per
 * recipient at write time (see service.ts), so "my inbox" is an indexed range
 * scan on (userId, readAt, createdAt) and never a permission filter at read
 * time - which also means a user keeps the history they were entitled to when
 * the event happened, even if their role changed since.
 */

const LIST_SELECT = {
  id: true,
  type: true,
  severity: true,
  title: true,
  body: true,
  href: true,
  entityType: true,
  entityId: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

type Raw = Prisma.NotificationGetPayload<{ select: typeof LIST_SELECT }>;

function toRow(row: Raw): NotificationRow {
  return {
    id: row.id,
    // The column is a plain String (F-conventions); anything unknown is shown
    // as SYSTEM rather than crashing a page an operator needs.
    type: (NOTIFICATION_TYPES as readonly string[]).includes(row.type)
      ? (row.type as NotificationType)
      : "SYSTEM",
    severity: (NOTIFICATION_SEVERITIES as readonly string[]).includes(row.severity)
      ? (row.severity as NotificationSeverity)
      : "info",
    title: row.title,
    body: row.body,
    href: row.href,
    entityType: row.entityType,
    entityId: row.entityId,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function buildNotificationWhere(
  userId: string,
  filters: NotificationFilters,
  options: { includeType?: boolean } = {},
): Prisma.NotificationWhereInput {
  const where: Prisma.NotificationWhereInput = { userId };
  if (options.includeType !== false && filters.type) where.type = filters.type;
  if (filters.severity) where.severity = filters.severity;
  if (filters.unreadOnly) where.readAt = null;

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  const q = filters.q.trim();
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { body: { contains: q, mode: "insensitive" } },
      { entityId: q },
    ];
  }
  return where;
}

/**
 * Unread first, then newest first. The two-key ORDER BY is what the grouping
 * in schemas.ts assumes: unread rows arrive contiguously, then read rows in
 * day order.
 */
export async function listNotifications(
  userId: string,
  params: ListParams,
  filters: NotificationFilters,
): Promise<{ rows: NotificationRow[]; meta: PageMeta; total: number }> {
  const where = buildNotificationWhere(userId, filters);

  const [rows, total] = await Promise.all([
    db.notification.findMany({
      where,
      select: LIST_SELECT,
      orderBy: [{ readAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }, { id: "desc" }],
      skip: params.skip,
      take: params.pageSize,
    }),
    db.notification.count({ where }),
  ]);

  return { rows: rows.map(toRow), meta: buildPageMeta(total, params), total };
}

export type NotificationTypeCounts = Record<NotificationType, number> & { all: number };

/**
 * Counts for the type filter, computed with the type filter itself dropped so
 * a selected tab never renders as "0" while showing rows.
 */
export async function notificationTypeCounts(
  userId: string,
  filters: NotificationFilters,
): Promise<NotificationTypeCounts> {
  const where = buildNotificationWhere(userId, filters, { includeType: false });
  const grouped = await db.notification.groupBy({
    by: ["type"],
    where,
    _count: { _all: true },
  });

  const counts = Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, 0])) as Record<
    NotificationType,
    number
  >;
  let all = 0;
  for (const row of grouped) {
    all += row._count._all;
    if ((NOTIFICATION_TYPES as readonly string[]).includes(row.type)) {
      counts[row.type as NotificationType] = row._count._all;
    }
  }
  return { ...counts, all };
}

export type NotificationOverview = {
  unread: number;
  total: number;
  unreadCritical: number;
  /** Rows created in the current IST day, read or not. */
  today: number;
  lastAt: string | null;
};

export async function notificationOverview(
  userId: string,
  now = new Date(),
): Promise<NotificationOverview> {
  const startOfDay = startOfIstDay(now);

  const [unread, total, unreadCritical, today, last] = await Promise.all([
    db.notification.count({ where: { userId, readAt: null } }),
    db.notification.count({ where: { userId } }),
    db.notification.count({ where: { userId, readAt: null, severity: "critical" } }),
    db.notification.count({ where: { userId, createdAt: { gte: startOfDay } } }),
    db.notification.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return { unread, total, unreadCritical, today, lastAt: last?.createdAt.toISOString() ?? null };
}
