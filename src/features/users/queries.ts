import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/guards";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";
import { SUPER_ADMIN_ROLE_SLUG } from "@/lib/permissions";
import { describeDevice } from "@/lib/auth/session";
import { assignRoleProblem } from "@/features/roles/subset";
import { listRoleGrants, loadRoleOrNull } from "@/features/roles/service";

import type {
  RoleOption,
  UserActivityRow,
  UserDetail,
  UserListFilters,
  UserListRow,
  UserPermissions,
  UserSessionRow,
  UserSort,
} from "./schemas";
import { userPermissions } from "./service";

/**
 * Read side of /admin/users.
 *
 * Two things are worth stating. First, the default list HIDES soft-deleted
 * accounts: they exist only so audit rows keep a foreign key, and showing
 * `<id>@deleted.local` in the everyday list would be noise. Second, the role
 * options are computed per ACTOR - the D3 subset rule decides which roles are
 * offered, so the dropdown cannot suggest a promotion the service would then
 * refuse.
 */

const LIST_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  image: true,
  roleId: true,
  isActive: true,
  deletedAt: true,
  twoFactorEnabled: true,
  forcePasswordChange: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof LIST_SELECT }>;

function toRow(row: UserRow, sessionCount: number): UserListRow {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    image: row.image,
    roleId: row.roleId,
    roleName: row.role?.name ?? null,
    roleSlug: row.role?.slug ?? null,
    isActive: row.isActive,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    twoFactorEnabled: row.twoFactorEnabled,
    forcePasswordChange: row.forcePasswordChange,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    sessionCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export function buildUserWhere(filters: UserListFilters): Prisma.UserWhereInput {
  const clauses: Prisma.UserWhereInput[] = [];

  switch (filters.status) {
    case "deleted":
      clauses.push({ deletedAt: { not: null } });
      break;
    case "inactive":
      clauses.push({ deletedAt: null, isActive: false });
      break;
    case "active":
      clauses.push({ deletedAt: null, isActive: true });
      break;
    default:
      clauses.push({ deletedAt: null });
  }

  if (filters.roleId) clauses.push({ roleId: filters.roleId });
  if (filters.twoFactor !== undefined) clauses.push({ twoFactorEnabled: filters.twoFactor });
  if (filters.q) {
    clauses.push({
      OR: [
        { name: { contains: filters.q, mode: "insensitive" } },
        { email: { contains: filters.q, mode: "insensitive" } },
        { phone: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }

  return { AND: clauses };
}

function orderBy(sort: UserSort, order: "asc" | "desc"): Prisma.UserOrderByWithRelationInput[] {
  switch (sort) {
    case "email":
      return [{ email: order }];
    case "role":
      return [{ role: { name: order } }, { name: "asc" }];
    case "lastLoginAt":
      // Nulls last in both directions: "never signed in" is not a date.
      return [{ lastLoginAt: { sort: order, nulls: "last" } }];
    case "createdAt":
      return [{ createdAt: order }];
    default:
      return [{ name: order }, { email: order }];
  }
}

export async function listUsers(
  params: ListParams & { sort: UserSort },
  filters: UserListFilters,
): Promise<{ rows: UserListRow[]; meta: PageMeta; total: number }> {
  const where = buildUserWhere(filters);
  const [total, rows] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: orderBy(params.sort, params.order),
      skip: params.skip,
      take: params.pageSize,
      select: LIST_SELECT,
    }),
  ]);

  const sessions = await db.adminSession.groupBy({
    by: ["userId"],
    where: {
      userId: { in: rows.map((row) => row.id) },
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    _count: { _all: true },
  });
  const byUser = new Map(sessions.map((row) => [row.userId, row._count._all]));

  return {
    rows: rows.map((row) => toRow(row, byUser.get(row.id) ?? 0)),
    meta: buildPageMeta(total, params),
    total,
  };
}

export async function userStatusCounts(
  filters: UserListFilters,
): Promise<{ all: number; active: number; inactive: number; deleted: number }> {
  const base: UserListFilters = { ...filters, status: undefined };
  const [active, inactive, deleted] = await Promise.all([
    db.user.count({ where: buildUserWhere({ ...base, status: "active" }) }),
    db.user.count({ where: buildUserWhere({ ...base, status: "inactive" }) }),
    db.user.count({ where: buildUserWhere({ ...base, status: "deleted" }) }),
  ]);
  return { all: active + inactive, active, inactive, deleted };
}

/** Roles for the invite / role-change selects, annotated with the D3 answer. */
export async function listRoleOptions(actor: Actor): Promise<RoleOption[]> {
  const [grants, counts] = await Promise.all([
    listRoleGrants(),
    db.role.findMany({ select: { id: true, isSystem: true } }),
  ]);
  const systemById = new Map(counts.map((row) => [row.id, row.isSystem]));

  return grants.map((role) => {
    const grant = {
      id: role.id,
      slug: role.slug,
      name: role.name,
      isSystem: systemById.get(role.id) ?? false,
      permissions: role.permissions,
    };
    const problem = assignRoleProblem(actor, grant);
    return {
      id: role.id,
      name: role.name,
      slug: role.slug,
      isSystem: grant.isSystem,
      permissionCount: role.permissions.length,
      assignable: problem === null,
      reason: problem,
    };
  });
}

export async function listUserSessionRows(
  userId: string,
  currentSessionId: string | null,
): Promise<UserSessionRow[]> {
  const rows = await db.adminSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    take: 50,
    select: {
      id: true,
      deviceLabel: true,
      userAgent: true,
      ip: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
      mfaVerifiedAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    deviceLabel: row.deviceLabel ?? describeDevice(row.userAgent),
    userAgent: row.userAgent,
    ip: row.ip,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    mfaVerifiedAt: row.mfaVerifiedAt?.toISOString() ?? null,
    isCurrent: row.id === currentSessionId,
  }));
}

/**
 * Everything this user did, and everything done TO them: the audit log is
 * queried both by actorId and by (entityType User, entityId), so a role change
 * somebody else made shows up on the profile it happened to.
 */
export async function listUserActivity(userId: string, take = 50): Promise<UserActivityRow[]> {
  const rows = await db.auditLog.findMany({
    where: {
      OR: [{ actorId: userId }, { entityType: "User", entityId: userId }],
    },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      summary: true,
      actorEmail: true,
      ip: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    summary: row.summary,
    actorEmail: row.actorEmail,
    ip: row.ip,
    createdAt: row.createdAt.toISOString(),
  }));
}

export type UserDetailResult = {
  user: UserDetail;
  permissions: UserPermissions;
  roles: RoleOption[];
};

export async function getUserDetail(
  id: string,
  actor: Actor,
): Promise<UserDetailResult | null> {
  const row = await db.user.findUnique({ where: { id }, select: LIST_SELECT });
  if (!row) return null;

  const [sessions, activity, roles, targetRole, superAdminCount] = await Promise.all([
    listUserSessionRows(id, actor.id === id ? actor.sessionId : null),
    listUserActivity(id),
    listRoleOptions(actor),
    loadRoleOrNull(db, row.roleId),
    db.user.count({
      where: { isActive: true, deletedAt: null, role: { slug: SUPER_ADMIN_ROLE_SLUG } },
    }),
  ]);

  const isLastSuperAdmin =
    row.role?.slug === SUPER_ADMIN_ROLE_SLUG && row.isActive && !row.deletedAt && superAdminCount <= 1;

  return {
    user: {
      ...toRow(row, sessions.length),
      sessions,
      activity,
      updatedAt: row.updatedAt.toISOString(),
    },
    permissions: userPermissions(actor, row, targetRole, { isLastSuperAdmin }),
    roles,
  };
}
