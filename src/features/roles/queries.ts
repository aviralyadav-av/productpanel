import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  type PermissionGroup,
} from "@/lib/permissions";

import { isSuperAdminOnly, normalizePermissionCodes } from "./subset";
import type { RoleDetail, RoleListFilters, RoleListRow, RoleSort } from "./schemas";

/**
 * Read side of /admin/roles. Roles are a handful of rows, so the list is a
 * single query with `_count` rather than anything clever; the only real work
 * is folding the permission registry into the group shape the matrix editor
 * and GET /api/admin/permissions both render.
 */

const LIST_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  isSystem: true,
  updatedAt: true,
  createdAt: true,
  _count: { select: { permissions: true } },
} satisfies Prisma.RoleSelect;

export function buildRoleWhere(filters: RoleListFilters): Prisma.RoleWhereInput {
  const clauses: Prisma.RoleWhereInput[] = [];
  if (filters.system !== undefined) clauses.push({ isSystem: filters.system });
  if (filters.q) {
    clauses.push({
      OR: [
        { name: { contains: filters.q, mode: "insensitive" } },
        { slug: { contains: filters.q, mode: "insensitive" } },
        { description: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }
  return clauses.length > 0 ? { AND: clauses } : {};
}

function orderBy(sort: RoleSort, order: "asc" | "desc"): Prisma.RoleOrderByWithRelationInput[] {
  switch (sort) {
    case "slug":
      return [{ slug: order }];
    case "users":
      return [{ users: { _count: order } }, { name: "asc" }];
    case "permissions":
      return [{ permissions: { _count: order } }, { name: "asc" }];
    case "updatedAt":
      return [{ updatedAt: order }];
    default:
      // System roles first so the nine seeded ones stay together at the top.
      return [{ isSystem: "desc" }, { name: order }];
  }
}

export async function listRoles(
  params: ListParams & { sort: RoleSort },
  filters: RoleListFilters,
): Promise<{ rows: RoleListRow[]; meta: PageMeta; total: number }> {
  const where = buildRoleWhere(filters);
  const [total, rows] = await Promise.all([
    db.role.count({ where }),
    db.role.findMany({
      where,
      orderBy: orderBy(params.sort, params.order),
      skip: params.skip,
      take: params.pageSize,
      select: LIST_SELECT,
    }),
  ]);

  // Live users only: a soft-deleted admin keeps its roleId (D3 never hard
  // deletes) and would otherwise inflate every "users" count on this screen.
  const counts = await db.user.groupBy({
    by: ["roleId"],
    where: { deletedAt: null, roleId: { in: rows.map((row) => row.id) } },
    _count: { _all: true },
  });
  const byRole = new Map(counts.map((row) => [row.roleId, row._count._all]));

  return {
    rows: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      isSystem: row.isSystem,
      userCount: byRole.get(row.id) ?? 0,
      permissionCount: row._count.permissions,
      updatedAt: row.updatedAt.toISOString(),
    })),
    meta: buildPageMeta(total, params),
    total,
  };
}

export async function getRoleDetail(id: string): Promise<RoleDetail | null> {
  const row = await db.role.findUnique({
    where: { id },
    select: {
      ...LIST_SELECT,
      permissions: { select: { permission: { select: { code: true } } } },
      users: {
        where: { deletedAt: null },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        take: 100,
        select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true },
      },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    userCount: row.users.length,
    permissionCount: row._count.permissions,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    permissions: normalizePermissionCodes(row.permissions.map((entry) => entry.permission.code)),
    users: row.users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    })),
  };
}

export type PermissionOption = {
  code: string;
  label: string;
  description: string;
  superAdminOnly: boolean;
};

export type PermissionGroupView = {
  group: PermissionGroup;
  label: string;
  codes: PermissionOption[];
};

/**
 * The permission registry folded into groups, in registry order. Pure over
 * src/lib/permissions.ts (the Permission table mirrors it), so the matrix
 * never disagrees with what the guards actually check.
 */
export function permissionGroupViews(): PermissionGroupView[] {
  const groups = new Map<PermissionGroup, PermissionOption[]>();
  for (const permission of PERMISSIONS) {
    const list = groups.get(permission.group) ?? [];
    list.push({
      code: permission.code,
      label: permission.label,
      description: permission.description,
      superAdminOnly: isSuperAdminOnly(permission.code),
    });
    groups.set(permission.group, list);
  }
  return [...groups.entries()].map(([group, codes]) => ({
    group,
    label: PERMISSION_GROUPS[group].label,
    codes,
  }));
}
