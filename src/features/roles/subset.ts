/**
 * Privilege-escalation rules (blueprint §14.D3), as pure functions.
 *
 * These are the only place the "subset rule" is written down: an actor may
 * grant, assign or edit only what they already hold. Keeping them pure (no
 * db, no Prisma, no Next) means the users service, the roles service, the REST
 * handlers and a node:test can all agree on the same sentences - and that the
 * rules are testable without a database, which is the difference between a
 * security rule that is checked and one that is hoped for.
 *
 * Everything returns a human sentence or null rather than a boolean, because
 * "you cannot do that" is useless to an operator who does not know why.
 */
import {
  PERMISSION_CODES,
  SUPER_ADMIN_ONLY_PERMISSIONS,
  SUPER_ADMIN_ROLE_SLUG,
  isPermissionCode,
} from "@/lib/permissions";

/** The subset of an Actor these rules need. A full Actor satisfies it. */
export type PermissionActor = {
  id: string;
  email: string;
  isSuperAdmin: boolean;
  permissions: ReadonlySet<string>;
  roleId: string | null;
};

/** A role as far as the rules care: what it grants and whether it is THE role. */
export type RoleGrant = {
  id: string;
  slug: string;
  name: string;
  isSystem: boolean;
  permissions: readonly string[];
};

/** Every code the actor could hand to somebody else. */
export function grantableCodes(actor: PermissionActor): string[] {
  if (actor.isSuperAdmin) return [...PERMISSION_CODES];
  return PERMISSION_CODES.filter((code) => actor.permissions.has(code));
}

export function canGrant(actor: PermissionActor, code: string): boolean {
  if (actor.isSuperAdmin) return true;
  if (SUPER_ADMIN_ONLY_PERMISSIONS.includes(code)) return false;
  return actor.permissions.has(code);
}

/** Codes in `wanted` the actor may not hand out, in registry order. */
export function ungrantableCodes(
  actor: PermissionActor,
  wanted: readonly string[],
): string[] {
  const set = new Set(wanted);
  return PERMISSION_CODES.filter((code) => set.has(code) && !canGrant(actor, code));
}

/**
 * Drop unknown and duplicated codes and return them in registry order, so a
 * stored grant list is always comparable and diffs stay readable.
 */
export function normalizePermissionCodes(codes: readonly string[]): string[] {
  const set = new Set(codes.filter(isPermissionCode));
  return PERMISSION_CODES.filter((code) => set.has(code));
}

export function isSuperAdminRole(role: Pick<RoleGrant, "slug">): boolean {
  return role.slug === SUPER_ADMIN_ROLE_SLUG;
}

/**
 * May the actor put a user INTO this role? (D3: only roles whose permission
 * set is a subset of the actor's; super-admin only by a super-admin.)
 */
export function assignRoleProblem(actor: PermissionActor, role: RoleGrant): string | null {
  if (isSuperAdminRole(role)) {
    return actor.isSuperAdmin
      ? null
      : "Only a super-admin can assign the super-admin role.";
  }
  if (actor.isSuperAdmin) return null;

  const missing = ungrantableCodes(actor, role.permissions);
  if (missing.length > 0) {
    return `You cannot assign "${role.name}": it grants ${missing.length} permission(s) you do not hold (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", …" : ""}).`;
  }
  return null;
}

export function canAssignRole(actor: PermissionActor, role: RoleGrant): boolean {
  return assignRoleProblem(actor, role) === null;
}

/**
 * May the actor act ON a user who currently holds this role? D3 makes reach
 * over a colleague symmetric with the power to create them: if you could not
 * put somebody into that role, you may not edit, deactivate, reset or
 * sign out the person already in it.
 */
export function reachProblem(
  actor: PermissionActor,
  targetRole: RoleGrant | null,
  verb = "manage",
): string | null {
  if (actor.isSuperAdmin) return null;
  if (!targetRole) return null; // role-less user: nothing to out-rank
  if (isSuperAdminRole(targetRole)) {
    return `Only a super-admin can ${verb} a super-admin.`;
  }
  const missing = ungrantableCodes(actor, targetRole.permissions);
  if (missing.length > 0) {
    return `You cannot ${verb} a user with the "${targetRole.name}" role: it holds permissions you do not (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", …" : ""}).`;
  }
  return null;
}

/**
 * May the actor save this permission list onto this role? (D3: cannot grant
 * what they lack, cannot edit their own role, system roles are read-only.)
 * `nextCodes` must already be normalised.
 */
export function editRoleProblem(
  actor: PermissionActor,
  role: RoleGrant | null,
  nextCodes: readonly string[],
): string | null {
  if (role && role.isSystem) {
    return `"${role.name}" is a system role. Its permissions are fixed; copy it into a new role to change them.`;
  }
  // Editing the role you are standing on would let you widen your own reach
  // (or lock yourself out) in one click, so it is refused for everyone.
  if (role && actor.roleId && role.id === actor.roleId) {
    return "You cannot edit the role you are assigned to. Ask another administrator.";
  }
  if (actor.isSuperAdmin) return null;

  const added = ungrantableCodes(
    actor,
    nextCodes.filter((code) => !role?.permissions.includes(code)),
  );
  if (added.length > 0) {
    return `You cannot grant permissions you do not hold: ${added.slice(0, 5).join(", ")}${added.length > 5 ? ", …" : ""}.`;
  }
  // Removing a permission the actor lacks is still a change to a role that
  // out-ranks them, so the whole role must be within reach before any save.
  const beyond = ungrantableCodes(actor, role?.permissions ?? []);
  if (beyond.length > 0) {
    return `"${role?.name}" grants permissions you do not hold, so you cannot edit it.`;
  }
  return null;
}

/** True when the code may only ever be held by a super-admin (D14). */
export function isSuperAdminOnly(code: string): boolean {
  return SUPER_ADMIN_ONLY_PERMISSIONS.includes(code);
}
