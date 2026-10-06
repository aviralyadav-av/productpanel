import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";

import {
  actionPrefixOf,
  type AuditFacets,
  type AuditFilters,
  type AuditRow,
  type AuditSort,
} from "./schemas";

/**
 * Read side of /admin/audit-log.
 *
 * Server-side pagination only, always with a `take` (§11.28): this table grows
 * forever and is the one screen where an unbounded findMany would eventually
 * take the admin down. Filters map onto the four indexes the schema declares
 * (createdAt, actorId, action, entityType+entityId).
 */

const ROW_SELECT = {
  id: true,
  createdAt: true,
  actorId: true,
  actorEmail: true,
  action: true,
  entityType: true,
  entityId: true,
  entityLabel: true,
  summary: true,
  ip: true,
  userAgent: true,
  diff: true,
  actor: { select: { name: true } },
} satisfies Prisma.AuditLogSelect;

type Row = Prisma.AuditLogGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(row: Row): AuditRow {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    actorId: row.actorId,
    actorEmail: row.actorEmail,
    actorName: row.actor?.name ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    summary: row.summary,
    ip: row.ip,
    userAgent: row.userAgent,
    diff: row.diff ?? null,
  };
}

export function buildAuditWhere(filters: AuditFilters): Prisma.AuditLogWhereInput {
  const clauses: Prisma.AuditLogWhereInput[] = [];

  if (filters.actorId) clauses.push({ actorId: filters.actorId });
  if (filters.entityType) clauses.push({ entityType: filters.entityType });
  // Prefix match rather than an enum: modules invent their own action names,
  // and the screen should keep working when a new one appears.
  if (filters.actionPrefix) clauses.push({ action: { startsWith: `${filters.actionPrefix}.` } });
  if (filters.from || filters.to) {
    clauses.push({
      createdAt: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      },
    });
  }
  if (filters.q) {
    clauses.push({
      OR: [
        { summary: { contains: filters.q, mode: "insensitive" } },
        { entityLabel: { contains: filters.q, mode: "insensitive" } },
        { entityId: { equals: filters.q } },
        { actorEmail: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }

  return clauses.length > 0 ? { AND: clauses } : {};
}

function orderBy(
  sort: AuditSort,
  order: "asc" | "desc",
): Prisma.AuditLogOrderByWithRelationInput[] {
  // `id` is always the tiebreaker: the export pages this query 1,000 rows at a
  // time, and two rows sharing a millisecond would otherwise repeat or vanish
  // between pages.
  switch (sort) {
    case "action":
      return [{ action: order }, { createdAt: "desc" }, { id: "desc" }];
    case "actor":
      return [{ actorEmail: order }, { createdAt: "desc" }, { id: "desc" }];
    case "entityType":
      return [{ entityType: order }, { createdAt: "desc" }, { id: "desc" }];
    default:
      return [{ createdAt: order }, { id: order }];
  }
}

export async function listAuditLog(
  params: ListParams & { sort: AuditSort },
  filters: AuditFilters,
): Promise<{ rows: AuditRow[]; meta: PageMeta; total: number }> {
  const where = buildAuditWhere(filters);
  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: orderBy(params.sort, params.order),
      skip: params.skip,
      take: params.pageSize,
      select: ROW_SELECT,
    }),
  ]);

  return { rows: rows.map(toRow), meta: buildPageMeta(total, params), total };
}

/**
 * The filter dropdowns. Counted over the WHOLE log rather than the current
 * filter so a selection never empties the list it was chosen from; the three
 * group-bys are cheap because each column is indexed.
 */
export async function getAuditFacets(): Promise<AuditFacets> {
  const [actors, entities, actions] = await Promise.all([
    db.auditLog.groupBy({
      by: ["actorId", "actorEmail"],
      _count: { _all: true },
      orderBy: { _count: { actorId: "desc" } },
      take: 60,
    }),
    db.auditLog.groupBy({
      by: ["entityType"],
      _count: { _all: true },
      orderBy: { _count: { entityType: "desc" } },
      take: 60,
    }),
    db.auditLog.groupBy({
      by: ["action"],
      _count: { _all: true },
      orderBy: { action: "asc" },
      take: 400,
    }),
  ]);

  const byPrefix = new Map<string, number>();
  for (const row of actions) {
    const prefix = actionPrefixOf(row.action);
    byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + row._count._all);
  }

  // Several rows can share an actorId when the email changed; keep the first
  // (most recent, because the group-by is count-ordered) label per actor.
  const seen = new Set<string>();
  const actorOptions: AuditFacets["actors"] = [];
  for (const row of actors) {
    if (!row.actorId || seen.has(row.actorId)) continue;
    seen.add(row.actorId);
    actorOptions.push({ id: row.actorId, label: row.actorEmail, count: row._count._all });
  }

  return {
    actors: actorOptions,
    entityTypes: entities.map((row) => ({ value: row.entityType, count: row._count._all })),
    actionPrefixes: [...byPrefix.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function getAuditEntry(id: string): Promise<AuditRow | null> {
  const row = await db.auditLog.findUnique({ where: { id }, select: ROW_SELECT });
  return row ? toRow(row) : null;
}

/** One page of rows for the streaming export (§11.28). */
export async function pageAuditForExport(
  filters: AuditFilters,
  sort: AuditSort,
  order: "asc" | "desc",
  skip: number,
  take: number,
): Promise<Array<Record<string, unknown>>> {
  const rows = await db.auditLog.findMany({
    where: buildAuditWhere(filters),
    orderBy: orderBy(sort, order),
    skip,
    take,
    select: ROW_SELECT,
  });

  return rows.map((row) => {
    const view = toRow(row);
    return {
      createdAt: view.createdAt,
      actorEmail: view.actorEmail,
      actorName: view.actorName,
      action: view.action,
      entityType: view.entityType,
      entityId: view.entityId,
      entityLabel: view.entityLabel,
      summary: view.summary,
      ip: view.ip,
      // The diff is already redacted at write time (D4 `redact()`), so it is
      // safe to export - but it is serialised, not spread, so a nested object
      // cannot smuggle a column into the sheet.
      diff: view.diff ? JSON.stringify(view.diff) : "",
    };
  });
}
