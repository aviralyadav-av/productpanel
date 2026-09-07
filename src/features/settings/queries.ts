import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  buildPageMeta,
  one,
  parseListParams,
  type SearchParams,
} from "@/lib/list-params";
import {
  HIDDEN_SETTING_GROUPS,
  SETTING_GROUPS,
  SETTING_GROUP_META,
  settingGroupLabel,
} from "./schemas";

/**
 * The lockout rule lives in src/lib/auth/index.ts, which does not export its
 * constants. They are mirrored here only so the account tab can state the rule
 * accurately - if they change there, change them here too.
 */
export const LOGIN_LOCKOUT_ATTEMPTS = 8;
export const LOGIN_LOCKOUT_WINDOW_MINUTES = 15;

// ---------------------------------------------------------------------------
// Store settings
// ---------------------------------------------------------------------------

export type SettingRow = {
  key: string;
  value: string;
  type: string;
  group: string;
  label: string;
  helpText: string | null;
  updatedAt: Date;
};

export type SettingGroupView = {
  group: string;
  label: string;
  description: string;
  settings: SettingRow[];
};

export async function getSettingGroups(): Promise<SettingGroupView[]> {
  const rows = await db.setting.findMany({
    orderBy: [{ group: "asc" }, { key: "asc" }],
  });

  const byGroup = new Map<string, SettingRow[]>();
  for (const row of rows) {
    if (HIDDEN_SETTING_GROUPS.has(row.group)) continue;
    const bucket = byGroup.get(row.group);
    if (bucket) bucket.push(row);
    else byGroup.set(row.group, [row]);
  }

  // Known groups render in registry order; a group the seeder adds later still
  // renders, at the end, rather than disappearing without a trace.
  const known = SETTING_GROUPS.filter((group) => byGroup.has(group));
  const unknown = [...byGroup.keys()].filter(
    (group) => !(SETTING_GROUPS as readonly string[]).includes(group),
  );

  return [...known, ...unknown].map((group) => ({
    group,
    label: settingGroupLabel(group),
    description: SETTING_GROUP_META[group]?.description ?? "",
    settings: byGroup.get(group) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export type AccountUser = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export type LoginAttemptRow = {
  id: string;
  ip: string | null;
  success: boolean;
  createdAt: Date;
};

export type AdminAccountRow = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: Date | null;
};

export type AccountOverview = {
  user: AccountUser;
  attempts: LoginAttemptRow[];
  recentFailures: number;
  otherAdmins: AdminAccountRow[];
};

export async function getAccountOverview(
  actorId: string,
): Promise<AccountOverview | null> {
  const user = await db.user.findUnique({
    where: { id: actorId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  if (!user) return null;

  const windowStart = new Date(
    Date.now() - LOGIN_LOCKOUT_WINDOW_MINUTES * 60_000,
  );

  const [attempts, recentFailures, otherAdmins] = await Promise.all([
    // Attempts are keyed by email, not user id - a failed login for an address
    // that does not exist has no user to attach to.
    db.loginAttempt.findMany({
      where: { email: user.email },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { id: true, ip: true, success: true, createdAt: true },
    }),
    db.loginAttempt.count({
      where: {
        email: user.email,
        success: false,
        createdAt: { gte: windowStart },
      },
    }),
    db.user.findMany({
      where: { role: "ADMIN", id: { not: actorId } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
      },
    }),
  ]);

  return { user, attempts, recentFailures, otherAdmins };
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export type AuditRow = {
  id: string;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  diff: Prisma.JsonValue;
  ip: string | null;
  createdAt: Date;
};

export const ACTIVITY_PAGE_SIZE = 50;

export async function getActivityLog(params: SearchParams) {
  const list = parseListParams(params, { pageSize: ACTIVITY_PAGE_SIZE });
  const action = one(params, "action");
  const entity = one(params, "entity");

  const where: Prisma.AuditLogWhereInput = {
    ...(action ? { action } : {}),
    ...(entity ? { entityType: entity } : {}),
    ...(list.q
      ? { summary: { contains: list.q, mode: "insensitive" as const } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: list.skip,
      take: list.pageSize,
      select: {
        id: true,
        actorEmail: true,
        action: true,
        entityType: true,
        entityId: true,
        summary: true,
        diff: true,
        ip: true,
        createdAt: true,
      },
    }),
    db.auditLog.count({ where }),
  ]);

  return {
    rows: rows as AuditRow[],
    meta: buildPageMeta(total, list),
    filters: { action, entity, q: list.q },
    isFiltered: Boolean(action || entity || list.q),
  };
}

/**
 * Facet counts are unfiltered totals for the whole log, so the chips do not
 * flicker between values as filters change - they are a map of what the log
 * contains, not of the current result set.
 */
export async function getActivityFacets() {
  const [actions, entities] = await Promise.all([
    db.auditLog.groupBy({ by: ["action"], _count: { _all: true } }),
    db.auditLog.groupBy({ by: ["entityType"], _count: { _all: true } }),
  ]);

  const byCountThenName = <T extends { count: number; value: string }>(
    a: T,
    b: T,
  ) => b.count - a.count || a.value.localeCompare(b.value);

  return {
    actions: actions
      .map((row) => ({
        value: row.action,
        label: row.action,
        count: row._count._all,
      }))
      .sort(byCountThenName),
    entities: entities
      .map((row) => ({
        value: row.entityType,
        label: row.entityType,
        count: row._count._all,
      }))
      .sort(byCountThenName),
  };
}
