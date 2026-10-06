import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { EMAIL_OUTBOX_STATUSES, type EmailOutboxStatus } from "@/lib/enums";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";
import {
  NOTIFICATION_EVENTS,
  type NotificationEventKey,
} from "@/features/notifications/events";
import {
  buildEmailOutboxWhere,
  emailOutboxStats,
  getEmailOutboxItem,
  type EmailOutboxFilters,
} from "@/features/jobs/queries";

import { findRestorePoint } from "./templates-service";
import { documentedVariables, EVENT_BY_TEMPLATE_KEY, isEmailTemplateKey, unknownVariablesFor } from "./templates-samples";
import type {
  OutboxDetailView,
  OutboxFilters,
  OutboxListRow,
  OutboxStatsView,
  TemplateEditorData,
  TemplateFilters,
  TemplateListRow,
  TemplateSort,
} from "./templates-schemas";

/**
 * The read side of /admin/email-templates (blueprint §1 "Email templates").
 *
 * Two things this file is careful about:
 *  - the LIST never selects `htmlBody`. Eighteen rendered emails is a payload
 *    nobody reads on a table screen; the editor selects it for one row.
 *  - "last sent" comes from EmailOutbox grouped by `templateKey`, computed in
 *    ONE groupBy rather than a per-row count, so the table is two queries
 *    whatever the number of templates.
 *
 * The outbox list/detail reuse the infra module's readers
 * (`@/features/jobs/queries`) and only add the day-range filter and the
 * client-safe serialisation the tab renders.
 */

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const TEMPLATE_LIST_SELECT = {
  id: true,
  key: true,
  name: true,
  subject: true,
  htmlBody: true,
  textBody: true,
  variables: true,
  isActive: true,
  updatedAt: true,
  updatedBy: { select: { name: true, email: true } },
} satisfies Prisma.EmailTemplateSelect;

function buildTemplateWhere(filters: TemplateFilters): Prisma.EmailTemplateWhereInput {
  const where: Prisma.EmailTemplateWhereInput = {};
  if (filters.active !== undefined) where.isActive = filters.active;

  const q = filters.q.trim();
  if (q) {
    where.OR = [
      { key: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
      { htmlBody: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

/** One groupBy for the whole page: rows ever queued, failures, last send. */
async function outboxCountsByKey(): Promise<
  Map<string, { total: number; failed: number; lastSentAt: Date | null }>
> {
  const [totals, failures, lastSends] = await Promise.all([
    db.emailOutbox.groupBy({ by: ["templateKey"], _count: { _all: true } }),
    db.emailOutbox.groupBy({ by: ["templateKey"], where: { status: "FAILED" }, _count: { _all: true } }),
    db.emailOutbox.groupBy({ by: ["templateKey"], where: { sentAt: { not: null } }, _max: { sentAt: true } }),
  ]);

  const map = new Map<string, { total: number; failed: number; lastSentAt: Date | null }>();
  const entry = (key: string | null) => {
    if (!key) return null;
    const existing = map.get(key) ?? { total: 0, failed: 0, lastSentAt: null };
    map.set(key, existing);
    return existing;
  };

  for (const row of totals) {
    const item = entry(row.templateKey);
    if (item) item.total = row._count._all;
  }
  for (const row of failures) {
    const item = entry(row.templateKey);
    if (item) item.failed = row._count._all;
  }
  for (const row of lastSends) {
    const item = entry(row.templateKey);
    if (item) item.lastSentAt = row._max.sentAt ?? null;
  }
  return map;
}

export async function listEmailTemplates(
  params: ListParams & { sort: TemplateSort },
  filters: TemplateFilters,
): Promise<{ rows: TemplateListRow[]; meta: PageMeta; total: number; activeCount: number }> {
  const where = buildTemplateWhere(filters);
  const orderBy: Prisma.EmailTemplateOrderByWithRelationInput =
    params.sort === "isActive" ? { isActive: params.order } : { [params.sort]: params.order };

  const [rows, total, activeCount, counts] = await Promise.all([
    db.emailTemplate.findMany({
      where,
      select: TEMPLATE_LIST_SELECT,
      orderBy: [orderBy, { key: "asc" }],
      skip: params.skip,
      take: params.pageSize,
    }),
    db.emailTemplate.count({ where }),
    db.emailTemplate.count({ where: { isActive: true } }),
    outboxCountsByKey(),
  ]);

  return {
    rows: rows.map((row) => {
      const outbox = counts.get(row.key);
      const source = { subject: row.subject, htmlBody: row.htmlBody, textBody: row.textBody };
      return {
        id: row.id,
        key: row.key,
        name: row.name,
        subject: row.subject,
        isActive: row.isActive,
        variableCount: documentedVariables(row.key, row.variables).length,
        unknownCount: unknownVariablesFor(source, row.key, row.variables).length,
        updatedAt: row.updatedAt.toISOString(),
        updatedByName: row.updatedBy?.name ?? row.updatedBy?.email ?? null,
        sentCount: outbox?.total ?? 0,
        lastSentAt: outbox?.lastSentAt?.toISOString() ?? null,
        failedCount: outbox?.failed ?? 0,
      };
    }),
    meta: buildPageMeta(total, params),
    total,
    activeCount,
  };
}

/** One line of "when is this sent?", straight from the event matrix (E3). */
function eventDescriptionFor(key: string): { eventKey: string | null; description: string | null } {
  const eventKey = isEmailTemplateKey(key) ? EVENT_BY_TEMPLATE_KEY[key] : undefined;
  if (!eventKey) {
    return {
      eventKey: null,
      description: "No event queues this template automatically; a service sends it directly.",
    };
  }
  const definition = NOTIFICATION_EVENTS[eventKey as NotificationEventKey];
  const audience = definition.notificationType
    ? ` It also raises the ${definition.notificationType} admin notification.`
    : "";
  return { eventKey, description: `Queued when the platform emits "${eventKey}".${audience}` };
}

export async function getEmailTemplateEditor(id: string): Promise<TemplateEditorData | null> {
  const row = await db.emailTemplate.findUnique({
    where: { id },
    select: {
      id: true,
      key: true,
      name: true,
      subject: true,
      htmlBody: true,
      textBody: true,
      variables: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      updatedBy: { select: { name: true, email: true } },
    },
  });
  if (!row) return null;

  const [grouped, lastSent, activity, restorePoint] = await Promise.all([
    db.emailOutbox.groupBy({ by: ["status"], where: { templateKey: row.key }, _count: { _all: true } }),
    db.emailOutbox.findFirst({
      where: { templateKey: row.key, sentAt: { not: null } },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
    db.auditLog.findMany({
      where: { entityType: "EmailTemplate", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, action: true, summary: true, actorEmail: true, createdAt: true },
    }),
    findRestorePoint(id),
  ]);

  const byStatus = new Map(grouped.map((item) => [item.status, item._count._all]));
  const count = (status: EmailOutboxStatus) => byStatus.get(status) ?? 0;
  const event = eventDescriptionFor(row.key);

  return {
    id: row.id,
    key: row.key,
    name: row.name,
    subject: row.subject,
    htmlBody: row.htmlBody,
    textBody: row.textBody,
    variables: row.variables,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedBy?.name ?? row.updatedBy?.email ?? null,
    eventKey: event.eventKey,
    eventDescription: event.description,
    stats: {
      total: [...byStatus.values()].reduce((sum, value) => sum + value, 0),
      sent: count("SENT"),
      queued: count("QUEUED") + count("SENDING"),
      failed: count("FAILED"),
      lastSentAt: lastSent?.sentAt?.toISOString() ?? null,
    },
    activity: activity.map((entry) => ({
      id: entry.id,
      action: entry.action,
      summary: entry.summary,
      actorEmail: entry.actorEmail,
      createdAt: entry.createdAt.toISOString(),
    })),
    restorePoint: restorePoint
      ? {
          auditId: restorePoint.auditId,
          at: restorePoint.at.toISOString(),
          actorEmail: restorePoint.actorEmail,
          fields: restorePoint.fields as string[],
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Outbox tab
// ---------------------------------------------------------------------------

function toOutboxFilters(filters: OutboxFilters): EmailOutboxFilters {
  return {
    status: filters.status ?? null,
    templateKey: filters.templateKey ?? null,
    entityType: filters.entityType ?? null,
    entityId: filters.entityId ?? null,
    q: filters.q || null,
  };
}

function outboxWhere(filters: OutboxFilters): Prisma.EmailOutboxWhereInput {
  const where = buildEmailOutboxWhere(toOutboxFilters(filters));
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  return where;
}

const OUTBOX_SELECT = {
  id: true,
  templateKey: true,
  toEmail: true,
  toName: true,
  subject: true,
  status: true,
  attempts: true,
  lastError: true,
  scheduledAt: true,
  sentAt: true,
  entityType: true,
  entityId: true,
  createdAt: true,
} satisfies Prisma.EmailOutboxSelect;

function toStatus(value: string): EmailOutboxStatus {
  return (EMAIL_OUTBOX_STATUSES as readonly string[]).includes(value)
    ? (value as EmailOutboxStatus)
    : "QUEUED";
}

export async function listOutbox(
  params: ListParams,
  filters: OutboxFilters,
): Promise<{ rows: OutboxListRow[]; meta: PageMeta; total: number }> {
  const where = outboxWhere(filters);
  const sort = ["createdAt", "scheduledAt", "sentAt", "status", "attempts", "toEmail", "subject", "templateKey"].includes(
    params.sort,
  )
    ? params.sort
    : "createdAt";

  const [rows, total] = await Promise.all([
    db.emailOutbox.findMany({
      where,
      select: OUTBOX_SELECT,
      orderBy: [{ [sort]: params.order }, { id: params.order }],
      skip: params.skip,
      take: params.pageSize,
    }),
    db.emailOutbox.count({ where }),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      templateKey: row.templateKey,
      toEmail: row.toEmail,
      toName: row.toName,
      subject: row.subject,
      status: toStatus(row.status),
      attempts: row.attempts,
      lastError: row.lastError,
      scheduledAt: row.scheduledAt.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
      entityType: row.entityType,
      entityId: row.entityId,
      createdAt: row.createdAt.toISOString(),
    })),
    meta: buildPageMeta(total, params),
    total,
  };
}

/** Counts for the status tabs, computed with the status filter dropped. */
export async function outboxStatusCounts(
  filters: OutboxFilters,
): Promise<Record<EmailOutboxStatus, number> & { all: number }> {
  const grouped = await db.emailOutbox.groupBy({
    by: ["status"],
    where: outboxWhere({ ...filters, status: undefined }),
    _count: { _all: true },
  });

  const counts = Object.fromEntries(EMAIL_OUTBOX_STATUSES.map((status) => [status, 0])) as Record<
    EmailOutboxStatus,
    number
  >;
  let all = 0;
  for (const row of grouped) {
    all += row._count._all;
    if ((EMAIL_OUTBOX_STATUSES as readonly string[]).includes(row.status)) {
      counts[row.status as EmailOutboxStatus] = row._count._all;
    }
  }
  return { ...counts, all };
}

export async function getOutboxDetail(id: string): Promise<OutboxDetailView | null> {
  const row = await getEmailOutboxItem(id);
  if (!row) return null;
  return {
    id: row.id,
    templateKey: row.templateKey,
    toEmail: row.toEmail,
    toName: row.toName,
    subject: row.subject,
    status: toStatus(row.status),
    attempts: row.attempts,
    lastError: row.lastError,
    scheduledAt: row.scheduledAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: row.createdAt.toISOString(),
    htmlBody: row.htmlBody,
    textBody: row.textBody,
    providerMessageId: row.providerMessageId,
    dedupeKey: row.dedupeKey,
  };
}

export async function outboxOverview(): Promise<OutboxStatsView> {
  const stats = await emailOutboxStats();
  return {
    byStatus: stats.byStatus,
    failedLast24h: stats.failedLast24h,
    oldestDueQueuedAt: stats.oldestDueQueuedAt?.toISOString() ?? null,
  };
}

/** Template keys that actually appear in the outbox, for the filter dropdown. */
export async function outboxTemplateKeys(): Promise<string[]> {
  const rows = await db.emailOutbox.groupBy({
    by: ["templateKey"],
    orderBy: { templateKey: "asc" },
  });
  return rows.map((row) => row.templateKey).filter((key): key is string => Boolean(key));
}
