/**
 * Roles service (blueprint §3, §11.16, §14.D3, D13).
 *
 * Every rule that decides who may hold what lives here, never in the UI: the
 * matrix editor, the REST handler and the check script all funnel through
 * these four functions, so a role can only ever be created or changed inside
 * the subset rule.
 *
 * No `server-only` / `next/*` imports - this file is also imported by the
 * users service and by tsx check scripts.
 */
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { conflict, forbiddenError, notFound, validationError } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { SUPER_ADMIN_ROLE_SLUG } from "@/lib/permissions";
import { slugify } from "@/lib/validation";

import type { RoleFormValues } from "./schemas";
import {
  editRoleProblem,
  isSuperAdminRole,
  normalizePermissionCodes,
  type PermissionActor,
  type RoleGrant,
} from "./subset";

type Db = Prisma.TransactionClient | typeof db;

export type RoleActor = PermissionActor & AuditActor;
export type ClientMeta = { ip?: string | null };

export type RoleRecord = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
};

const ROLE_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  isSystem: true,
  permissions: { select: { permission: { select: { code: true } } } },
} satisfies Prisma.RoleSelect;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>;

function toRecord(row: RoleRow): RoleRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    permissions: normalizePermissionCodes(row.permissions.map((entry) => entry.permission.code)),
  };
}

/** The grant view of a role, for the D3 rules. Used by the users service too. */
export async function loadRole(tx: Db, roleId: string): Promise<RoleRecord> {
  const row = await tx.role.findUnique({ where: { id: roleId }, select: ROLE_SELECT });
  if (!row) throw notFound("Role");
  return toRecord(row);
}

export async function loadRoleOrNull(tx: Db, roleId: string | null): Promise<RoleRecord | null> {
  if (!roleId) return null;
  const row = await tx.role.findUnique({ where: { id: roleId }, select: ROLE_SELECT });
  return row ? toRecord(row) : null;
}

/** Every role with its grants, for the "which roles may I assign" question. */
export async function listRoleGrants(tx: Db = db): Promise<RoleRecord[]> {
  const rows = await tx.role.findMany({ orderBy: { name: "asc" }, select: ROLE_SELECT });
  return rows.map(toRecord);
}

/** Permission rows for a set of codes, creating none: the registry is seeded. */
async function permissionIdsFor(tx: Db, codes: readonly string[]): Promise<string[]> {
  if (codes.length === 0) return [];
  const rows = await tx.permission.findMany({
    where: { code: { in: [...codes] } },
    select: { id: true, code: true },
  });
  if (rows.length !== codes.length) {
    const found = new Set(rows.map((row) => row.code));
    const missing = codes.filter((code) => !found.has(code));
    throw validationError(
      { permissions: `Unknown permission code(s): ${missing.join(", ")}.` },
      "Some permissions do not exist in this database. Re-run the seed.",
    );
  }
  return rows.map((row) => row.id);
}

async function uniqueSlug(tx: Db, wanted: string, exceptId?: string): Promise<string> {
  const base = slugify(wanted) || "role";
  let candidate = base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const clash = await tx.role.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!clash || clash.id === exceptId) return candidate;
    candidate = `${base}-${suffix}`;
  }
  throw conflict("Could not find a free slug for that role name.");
}

/**
 * Create a role. The actor may only grant codes they hold (D3), and the new
 * role is never a system role no matter what the caller sends.
 */
export async function createRole(
  input: RoleFormValues,
  actor: RoleActor,
  meta: ClientMeta = {},
): Promise<RoleRecord> {
  const permissions = normalizePermissionCodes(input.permissions);
  const problem = editRoleProblem(actor, null, permissions);
  if (problem) throw forbiddenError(problem);

  return db.$transaction(async (tx) => {
    const slug = await uniqueSlug(tx, input.slug || input.name);
    const permissionIds = await permissionIdsFor(tx, permissions);

    const created = await tx.role.create({
      data: {
        slug,
        name: input.name,
        description: input.description,
        isSystem: false,
        permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      },
      select: ROLE_SELECT,
    });

    await writeAudit(tx, {
      actor,
      action: "role.create",
      entityType: "Role",
      entityId: created.id,
      entityLabel: created.name,
      summary: `Created role "${created.name}" with ${permissions.length} permission(s).`,
      diff: diffOf(null, { slug, name: input.name, permissions }),
      ip: meta.ip,
    });

    return toRecord(created);
  });
}

/**
 * Update a role's name/description/permissions. System roles are view-only and
 * the actor's own role is off limits (both enforced by editRoleProblem).
 */
export async function updateRole(
  id: string,
  input: RoleFormValues,
  actor: RoleActor,
  meta: ClientMeta = {},
): Promise<RoleRecord> {
  const permissions = normalizePermissionCodes(input.permissions);

  return db.$transaction(async (tx) => {
    const before = await loadRole(tx, id);
    const problem = editRoleProblem(actor, before, permissions);
    if (problem) throw forbiddenError(problem);

    const slug =
      input.slug && input.slug !== before.slug ? await uniqueSlug(tx, input.slug, id) : before.slug;
    const permissionIds = await permissionIdsFor(tx, permissions);

    // Replace the grant set wholesale: the matrix editor always posts the full
    // list, and a delete-then-create inside the tx is simpler to reason about
    // than computing a minimal delta that nothing else needs.
    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    if (permissionIds.length > 0) {
      await tx.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
        skipDuplicates: true,
      });
    }

    const updated = await tx.role.update({
      where: { id },
      data: { slug, name: input.name, description: input.description },
      select: ROLE_SELECT,
    });
    const after = toRecord(updated);

    const diff = diffOf(
      {
        slug: before.slug,
        name: before.name,
        description: before.description,
        permissions: before.permissions,
      },
      {
        slug: after.slug,
        name: after.name,
        description: after.description,
        permissions: after.permissions,
      },
    );

    // D13: role permission changes are a mandatory audit event, so the row is
    // written inside the transaction even when only the name moved.
    const added = after.permissions.filter((code) => !before.permissions.includes(code));
    const removed = before.permissions.filter((code) => !after.permissions.includes(code));
    await writeAudit(tx, {
      actor,
      action: "role.update",
      entityType: "Role",
      entityId: id,
      entityLabel: after.name,
      summary:
        added.length + removed.length > 0
          ? `Updated role "${after.name}": +${added.length} / -${removed.length} permission(s).`
          : `Updated role "${after.name}".`,
      diff,
      ip: meta.ip,
    });

    return after;
  });
}

/**
 * Delete a role. Blocked for system roles and for any role that still has
 * users (§11.16) - reassigning people is a decision, not a side effect.
 */
export async function deleteRole(
  id: string,
  actor: RoleActor,
  meta: ClientMeta = {},
): Promise<{ id: string; name: string }> {
  return db.$transaction(async (tx) => {
    const role = await loadRole(tx, id);
    if (role.isSystem || isSuperAdminRole(role)) {
      throw conflict(`"${role.name}" is a system role and cannot be deleted.`);
    }
    const problem = editRoleProblem(actor, role, role.permissions);
    if (problem) throw forbiddenError(problem);

    const userCount = await tx.user.count({ where: { roleId: id, deletedAt: null } });
    if (userCount > 0) {
      throw conflict(
        `"${role.name}" is assigned to ${userCount} user(s). Move them to another role first.`,
      );
    }

    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    await tx.role.delete({ where: { id } });

    await writeAudit(tx, {
      actor,
      action: "role.delete",
      entityType: "Role",
      entityId: id,
      entityLabel: role.name,
      summary: `Deleted role "${role.name}".`,
      diff: diffOf({ slug: role.slug, name: role.name, permissions: role.permissions }, null),
      ip: meta.ip,
    });

    return { id, name: role.name };
  });
}

export { SUPER_ADMIN_ROLE_SLUG };
export type { RoleGrant };
