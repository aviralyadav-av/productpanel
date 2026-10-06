import "dotenv/config";

import { db } from "@/lib/db";
import { isApiError } from "@/lib/api/errors";
import { PERMISSION_CODES, SUPER_ADMIN_ROLE_SLUG } from "@/lib/permissions";
import { createRole, deleteRole } from "@/features/roles/service";
import type { PermissionActor } from "@/features/roles/subset";
import {
  deactivateUser,
  disableUserTwoFactor,
  inviteUser,
  setUserRole,
  setUserStatus,
  updateUserProfile,
  type UserActor,
} from "@/features/users/service";

/**
 * End-to-end check of the D3 privilege rules against the REAL database:
 *
 *   npx tsx src/features/users/__checks__/users-check.ts
 *
 * It creates a `check_` role and a `check_` user, then proves the rules that
 * matter by trying to break them: a limited actor cannot assign a role that
 * out-ranks them, cannot reach a user who holds one, cannot change their own
 * role, and cannot touch the last super-admin. Finally it deactivates the user
 * (soft delete) and removes every row it created.
 */

const STAMP = Date.now();
const PREFIX = `check_users_${STAMP}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

/** Run a call that must fail, and return the message it failed with. */
async function refuses(label: string, body: () => Promise<unknown>): Promise<string> {
  try {
    await body();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  refused (${label}): ${message}`);
    return message;
  }
  throw new Error(`ASSERT FAILED: ${label} should have been refused`);
}

function actorFrom(row: {
  id: string;
  email: string;
  roleId: string | null;
  permissions: string[];
  isSuperAdmin: boolean;
}): UserActor & PermissionActor {
  return {
    id: row.id,
    email: row.email,
    roleId: row.roleId,
    permissions: new Set(row.permissions),
    isSuperAdmin: row.isSuperAdmin,
  };
}

async function main(): Promise<void> {
  const superAdminUser = await db.user.findFirst({
    where: { deletedAt: null, isActive: true, role: { slug: SUPER_ADMIN_ROLE_SLUG } },
    select: { id: true, email: true, roleId: true },
  });
  assert(superAdminUser, "an active super-admin exists (run the seed first)");

  const superActor = actorFrom({
    id: superAdminUser.id,
    email: superAdminUser.email,
    roleId: superAdminUser.roleId,
    permissions: [...PERMISSION_CODES],
    isSuperAdmin: true,
  });

  // ---- a limited role and a powerful role, both ours to delete afterwards --
  const limitedRole = await createRole(
    {
      name: `${PREFIX} limited`,
      slug: `${PREFIX}-limited`,
      description: "Temporary role created by users-check.",
      permissions: ["users.view", "users.create", "users.edit", "orders.view"],
    },
    superActor,
  );
  const powerfulRole = await createRole(
    {
      name: `${PREFIX} powerful`,
      slug: `${PREFIX}-powerful`,
      description: "Temporary role created by users-check.",
      permissions: ["users.view", "users.create", "users.edit", "orders.view", "roles.manage", "users.delete"],
    },
    superActor,
  );
  console.log(`created roles ${limitedRole.slug} and ${powerfulRole.slug}`);

  // ---- invite a user into the limited role -------------------------------
  const invited = await inviteUser(
    { name: `${PREFIX} person`, email: `${PREFIX}@example.test`, roleId: limitedRole.id, phone: null },
    superActor,
  );
  console.log(`invited ${invited.email} (email queued: ${invited.emailQueued})`);

  const invitedRow = await db.user.findUniqueOrThrow({
    where: { id: invited.id },
    select: { passwordHash: true, forcePasswordChange: true, isActive: true },
  });
  assert(invitedRow.forcePasswordChange, "an invited user must change their password");
  assert(invitedRow.isActive, "an invited user is active");
  assert(invitedRow.passwordHash.length > 20, "an invited user gets an unusable bcrypt hash");

  const token = await db.passwordResetToken.findFirst({
    where: { userId: invited.id },
    select: { id: true, tokenHash: true, expiresAt: true },
  });
  assert(token, "the invite created a password reset token");
  assert(token.tokenHash.length === 64, "the token is stored hashed, never in plaintext");
  assert(token.expiresAt.getTime() > Date.now(), "the invite token is still valid");

  // ---- the invited user, acting as themselves, is bound by D3 -------------
  const limitedActor = actorFrom({
    id: invited.id,
    email: invited.email,
    roleId: limitedRole.id,
    permissions: limitedRole.permissions,
    isSuperAdmin: false,
  });

  // A colleague in the same role (reachable) and a boss in the powerful one
  // (not reachable), so each refusal below isolates one rule.
  const peerUser = await inviteUser(
    { name: `${PREFIX} peer`, email: `${PREFIX}-peer@example.test`, roleId: limitedRole.id, phone: null },
    superActor,
  );
  const powerfulUser = await inviteUser(
    { name: `${PREFIX} boss`, email: `${PREFIX}-boss@example.test`, roleId: powerfulRole.id, phone: null },
    superActor,
  );

  const promotionRefusal = await refuses("assign a role that out-ranks you", () =>
    setUserRole(peerUser.id, powerfulRole.id, limitedActor),
  );
  assert(
    /permission/i.test(promotionRefusal),
    "the refusal names the permissions the actor does not hold",
  );

  await refuses("change your own role", () =>
    setUserRole(invited.id, limitedRole.id, limitedActor),
  );

  await refuses("deactivate yourself", () =>
    setUserStatus(invited.id, false, limitedActor),
  );

  await refuses("edit a user whose role holds more than you", () =>
    updateUserProfile(
      powerfulUser.id,
      { name: "nope", email: `${PREFIX}-boss@example.test`, phone: null },
      limitedActor,
    ),
  );

  await refuses("deactivate a user who out-ranks you", () =>
    setUserStatus(powerfulUser.id, false, limitedActor),
  );

  await refuses("turn off somebody else's 2FA without being a super-admin", () =>
    disableUserTwoFactor(powerfulUser.id, limitedActor),
  );

  // ---- the last active super-admin is untouchable (§11.16) ---------------
  const superAdminCount = await db.user.count({
    where: { isActive: true, deletedAt: null, role: { slug: SUPER_ADMIN_ROLE_SLUG } },
  });
  if (superAdminCount === 1) {
    const message = await refuses("deactivate the last super-admin", () =>
      setUserStatus(superAdminUser.id, false, {
        ...superActor,
        id: `${superAdminUser.id}-not-me`,
        email: "someone.else@example.test",
      }),
    );
    assert(/last active super-admin/i.test(message), "the refusal explains why");
  } else {
    console.log(`  (skipped last-super-admin check: ${superAdminCount} exist)`);
  }

  // ---- a change the actor IS allowed to make ------------------------------
  const renamed = await updateUserProfile(
    invited.id,
    { name: `${PREFIX} renamed`, email: invited.email, phone: null },
    superActor,
  );
  assert(renamed.name === `${PREFIX} renamed`, "a permitted profile edit lands");

  // Changing somebody's email revokes their sessions (D3). Give them one first.
  const session = await db.adminSession.create({
    data: {
      userId: invited.id,
      tokenHash: `${PREFIX}-session-hash`,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      deviceLabel: "users-check",
    },
    select: { id: true },
  });
  const emailChanged = await updateUserProfile(
    invited.id,
    { name: renamed.name ?? "", email: `${PREFIX}-moved@example.test`, phone: null },
    superActor,
  );
  assert(emailChanged.revokedSessions === 1, "changing the email revokes live sessions");
  const revoked = await db.adminSession.findUniqueOrThrow({
    where: { id: session.id },
    select: { revokedAt: true },
  });
  assert(revoked.revokedAt !== null, "the session row is marked revoked, not deleted");

  // ---- soft delete --------------------------------------------------------
  const removed = await deactivateUser(invited.id, superActor, { reason: "users-check cleanup" });
  const afterDelete = await db.user.findUniqueOrThrow({
    where: { id: invited.id },
    select: { email: true, isActive: true, deletedAt: true },
  });
  assert(afterDelete.email === `${invited.id}@deleted.local`, "the email is released on delete");
  assert(afterDelete.deletedAt !== null && !afterDelete.isActive, "the row is soft-deleted, not removed");
  console.log(`soft-deleted ${removed.email}`);

  await refuses("delete an already deactivated user", () =>
    deactivateUser(invited.id, superActor),
  );

  // ---- audit trail --------------------------------------------------------
  const auditRows = await db.auditLog.findMany({
    where: { entityType: "User", entityId: { in: [invited.id, peerUser.id, powerfulUser.id] } },
    select: { action: true },
  });
  const actions = new Set(auditRows.map((row) => row.action));
  for (const expected of ["user.create", "user.update", "user.delete"]) {
    assert(actions.has(expected), `audit row ${expected} was written`);
  }
  console.log(`audit actions: ${[...actions].sort().join(", ")}`);

  // ---- cleanup ------------------------------------------------------------
  // Order matters: sessions and tokens hang off the users, a role cannot be
  // deleted while somebody holds it, and the audit rows are cleared LAST
  // because deleting a role writes one.
  const userIds = [invited.id, peerUser.id, powerfulUser.id];
  const roleIds = [limitedRole.id, powerfulRole.id];

  await db.adminSession.deleteMany({ where: { userId: { in: userIds } } });
  await db.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });

  for (const roleId of roleIds) {
    await deleteRole(roleId, superActor).catch(async (error) => {
      if (!isApiError(error)) throw error;
      await db.rolePermission.deleteMany({ where: { roleId } });
      await db.role.delete({ where: { id: roleId } });
    });
  }

  // The audit rows are deliberately NOT cleaned up: the migration installs a
  // trigger that rejects UPDATE and DELETE on AuditLog (D13), which is exactly
  // the property this check would rather prove than work around. The rows keep
  // their `check_users_<stamp>` labels and their actorId is set to null by the
  // user delete, so they are harmless and identifiable.

  const leftovers = await db.user.count({ where: { email: { contains: PREFIX } } });
  assert(leftovers === 0, "every check user was removed");

  console.log("\nusers-check PASSED");
}

main()
  .catch((error) => {
    console.error("\nusers-check FAILED\n", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
