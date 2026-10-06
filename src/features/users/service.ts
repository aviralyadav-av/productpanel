/**
 * Admin users service (blueprint §1 Users, §11.16/17, §14.D3, D10, D13).
 *
 * This file IS the privilege model. Every rule the blueprint lists - the
 * subset rule, "you cannot change your own role", "super-admin may only be
 * assigned by a super-admin", "the last active super-admin is untouchable",
 * "changing another user's email revokes their sessions", "admins never set
 * passwords", "users are never hard-deleted" - is enforced here and nowhere
 * else, so the UI, the REST handlers and the check script cannot disagree
 * about who may do what. The UI only RENDERS the same answers, through
 * `userPermissions()`.
 *
 * No `server-only` / `next/*` imports: also used by tsx check scripts.
 */
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { conflict, forbiddenError, notFound, validationError } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { hashToken, randomToken } from "@/lib/crypto";
import { revokeAdminSession, revokeUserSessions } from "@/lib/auth/session";
import { SUPER_ADMIN_ROLE_SLUG } from "@/lib/permissions";
import { BCRYPT_ROUNDS } from "@/features/account/password-policy";
import { requestPasswordReset, resetUrlFor } from "@/features/account/password-reset";
import { queueEmail } from "@/features/email/service";
import {
  assignRoleProblem,
  reachProblem,
  type PermissionActor,
  type RoleGrant,
} from "@/features/roles/subset";
import { loadRole, loadRoleOrNull } from "@/features/roles/service";

import type {
  InviteUserValues,
  UserPermissions,
  UserProfileValues,
} from "./schemas";

type Db = Prisma.TransactionClient | typeof db;

export type UserActor = PermissionActor & AuditActor & { sessionId?: string };
export type ClientMeta = { ip?: string | null; reason?: string | null };

/** An invite link is a password-reset token with a longer fuse. */
export const INVITE_TTL_HOURS = 48;

const USER_SELECT = {
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
  role: { select: { id: true, slug: true, name: true } },
} satisfies Prisma.UserSelect;

export type UserRecord = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

// ---------------------------------------------------------------------------
// Loading and the D3 rules
// ---------------------------------------------------------------------------

export async function loadUser(tx: Db, id: string): Promise<UserRecord> {
  const row = await tx.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!row) throw notFound("User");
  return row;
}

/** The grant view of the target's role, which is what every reach rule needs. */
async function targetRole(tx: Db, user: UserRecord): Promise<RoleGrant | null> {
  return loadRoleOrNull(tx, user.roleId);
}

/**
 * Refuse when the actor cannot reach the target (D3). Reach is symmetric with
 * the power to create: if you could not put somebody INTO that role, you may
 * not edit, deactivate, reset or sign out the person already in it.
 */
async function assertReach(
  tx: Db,
  actor: UserActor,
  user: UserRecord,
  verb: string,
): Promise<void> {
  const problem = reachProblem(actor, await targetRole(tx, user), verb);
  if (problem) throw forbiddenError(problem);
}

/**
 * §11.16: the last ACTIVE super-admin cannot be demoted, deactivated or
 * deleted. Counted inside the caller's transaction so two concurrent
 * deactivations cannot both see "there are two of us".
 */
async function assertNotLastSuperAdmin(
  tx: Db,
  user: UserRecord,
  action: string,
): Promise<void> {
  if (user.role?.slug !== SUPER_ADMIN_ROLE_SLUG || !user.isActive || user.deletedAt) return;

  const others = await tx.user.count({
    where: {
      id: { not: user.id },
      isActive: true,
      deletedAt: null,
      role: { slug: SUPER_ADMIN_ROLE_SLUG },
    },
  });
  if (others === 0) {
    throw conflict(
      `${user.email} is the last active super-admin. Promote somebody else before you ${action} this account.`,
    );
  }
}

function labelOf(user: Pick<UserRecord, "name" | "email">): string {
  return user.name || user.email;
}

async function assertEmailFree(tx: Db, email: string, exceptId?: string): Promise<void> {
  const clash = await tx.user.findUnique({ where: { email }, select: { id: true } });
  if (clash && clash.id !== exceptId) {
    throw validationError({ email: "Another admin already uses that email address." });
  }
}

/**
 * What the current actor may do to this user, computed on the SERVER from the
 * same rules the service enforces. The UI disables buttons from this; it never
 * decides for itself.
 */
export function userPermissions(
  actor: PermissionActor & { permissions: ReadonlySet<string> },
  target: { id: string; roleId: string | null; isActive: boolean; deletedAt: Date | string | null },
  targetRoleGrant: RoleGrant | null,
  options: { isLastSuperAdmin: boolean },
): UserPermissions {
  const isSelf = actor.id === target.id;
  const has = (code: string) => actor.isSuperAdmin || actor.permissions.has(code);
  const reach = reachProblem(actor, targetRoleGrant, "manage");
  const deleted = Boolean(target.deletedAt);

  return {
    canEdit: !deleted && !reach && has("users.edit"),
    // D3: never your own role, and never the last super-admin's.
    canChangeRole:
      !deleted && !isSelf && !reach && has("users.edit") && !options.isLastSuperAdmin,
    canChangeStatus:
      !deleted && !isSelf && !reach && has("users.edit") && !options.isLastSuperAdmin,
    canResetPassword: !deleted && !reach && has("users.edit"),
    canRevokeSessions: !deleted && !reach && has("users.edit"),
    canDelete:
      !deleted && !isSelf && !reach && has("users.delete") && !options.isLastSuperAdmin,
    // Break-glass: only a super-admin turns somebody else's second factor off.
    canDisableTwoFactor: !deleted && actor.isSuperAdmin && !isSelf,
    reason: reach ?? (isSelf ? "This is your own account - manage it under Account." : null),
    isSelf,
  };
}

// ---------------------------------------------------------------------------
// Invite
// ---------------------------------------------------------------------------

export type InviteResult = { id: string; email: string; expiresAt: Date; emailQueued: boolean };

/**
 * Create an admin user and email them an invite link.
 *
 * The account is created with an UNUSABLE password: a bcrypt hash of 32 random
 * bytes nobody has seen, plus forcePasswordChange. D3 says admins never set
 * another admin's password, so the only way in is the invite link, and the
 * only way to reset it is a link - there is deliberately no code path here
 * that accepts a password.
 */
export async function inviteUser(
  input: InviteUserValues,
  actor: UserActor,
  meta: ClientMeta = {},
): Promise<InviteResult> {
  const email = input.email.trim().toLowerCase();

  const role = await loadRole(db, input.roleId);
  const problem = assignRoleProblem(actor, role);
  if (problem) throw forbiddenError(problem);

  const unusablePassword = await bcrypt.hash(randomToken(32), BCRYPT_ROUNDS);
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60_000);

  const created = await db.$transaction(async (tx) => {
    await assertEmailFree(tx, email);

    const user = await tx.user.create({
      data: {
        email,
        name: input.name,
        phone: input.phone,
        passwordHash: unusablePassword,
        roleId: role.id,
        isActive: true,
        forcePasswordChange: true,
      },
      select: USER_SELECT,
    });

    await tx.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
    });

    // D13: user create is a mandatory audit event, written in the tx so a
    // failed audit aborts the invite rather than leaving an untracked admin.
    await writeAudit(tx, {
      actor,
      action: "user.create",
      entityType: "User",
      entityId: user.id,
      entityLabel: labelOf(user),
      summary: `Invited ${email} as ${role.name}.`,
      diff: diffOf(null, { email, name: input.name, role: role.slug }),
      ip: meta.ip,
    });

    return user;
  });

  const queued = await queueEmail({
    templateKey: "admin_invite",
    to: { email: created.email, name: created.name },
    vars: {
      name: created.name ?? created.email,
      invite_url: resetUrlFor(token),
      expires_hours: INVITE_TTL_HOURS,
    },
    entity: { type: "user_invite", id: created.id },
    dedupeKey: null,
  });

  return {
    id: created.id,
    email: created.email,
    expiresAt,
    emailQueued: queued.queued,
  };
}

// ---------------------------------------------------------------------------
// Profile, role, status
// ---------------------------------------------------------------------------

export async function updateUserProfile(
  id: string,
  input: UserProfileValues,
  actor: UserActor,
  meta: ClientMeta = {},
): Promise<UserRecord & { revokedSessions: number }> {
  const email = input.email.trim().toLowerCase();

  return db.$transaction(async (tx) => {
    const before = await loadUser(tx, id);
    if (before.deletedAt) throw conflict("This account is deactivated.");
    if (before.id !== actor.id) await assertReach(tx, actor, before, "edit");
    await assertEmailFree(tx, email, id);

    const emailChanged = email !== before.email;

    const after = await tx.user.update({
      where: { id },
      data: { name: input.name, email, phone: input.phone },
      select: USER_SELECT,
    });

    // D3: changing somebody's email changes how they are identified, so every
    // session they hold is cut - including the one that may be an attacker's.
    const revokedSessions =
      emailChanged && before.id !== actor.id ? await revokeUserSessions(id, { tx }) : 0;

    await writeAudit(tx, {
      actor,
      action: "user.update",
      entityType: "User",
      entityId: id,
      entityLabel: labelOf(after),
      summary: emailChanged
        ? `Updated ${before.email} (email changed to ${email}; ${revokedSessions} session(s) revoked).`
        : `Updated ${after.email}.`,
      diff: diffOf(
        { name: before.name, email: before.email, phone: before.phone },
        { name: after.name, email: after.email, phone: after.phone },
      ),
      ip: meta.ip,
    });

    return { ...after, revokedSessions };
  });
}

export async function setUserRole(
  id: string,
  roleId: string,
  actor: UserActor,
  meta: ClientMeta = {},
): Promise<UserRecord> {
  if (id === actor.id) {
    throw forbiddenError("You cannot change your own role. Ask another administrator.");
  }

  return db.$transaction(async (tx) => {
    const before = await loadUser(tx, id);
    if (before.deletedAt) throw conflict("This account is deactivated.");

    const nextRole = await loadRole(tx, roleId);
    await assertReach(tx, actor, before, "change the role of");

    const problem = assignRoleProblem(actor, nextRole);
    if (problem) throw forbiddenError(problem);

    if (nextRole.id !== before.roleId) {
      await assertNotLastSuperAdmin(tx, before, "demote");
    }

    const after = await tx.user.update({
      where: { id },
      data: { roleId: nextRole.id },
      select: USER_SELECT,
    });

    await writeAudit(tx, {
      actor,
      action: "user.role_change",
      entityType: "User",
      entityId: id,
      entityLabel: labelOf(after),
      summary: `Changed ${after.email} from ${before.role?.name ?? "no role"} to ${nextRole.name}.`,
      diff: diffOf(
        { role: before.role?.slug ?? null },
        { role: nextRole.slug },
      ),
      ip: meta.ip,
    });

    return after;
  });
}

export async function setUserStatus(
  id: string,
  isActive: boolean,
  actor: UserActor,
  meta: ClientMeta = {},
): Promise<UserRecord & { revokedSessions: number }> {
  if (id === actor.id) {
    throw forbiddenError("You cannot deactivate your own account.");
  }

  return db.$transaction(async (tx) => {
    const before = await loadUser(tx, id);
    if (before.deletedAt) throw conflict("This account is deactivated and cannot be changed.");
    await assertReach(tx, actor, before, isActive ? "reactivate" : "deactivate");
    if (!isActive) await assertNotLastSuperAdmin(tx, before, "deactivate");

    const after = await tx.user.update({
      where: { id },
      data: { isActive },
      select: USER_SELECT,
    });

    // A deactivated account must lose its live sessions immediately; the
    // guards would refuse the next request anyway, but leaving the rows alive
    // makes the sessions list lie.
    const revokedSessions = isActive ? 0 : await revokeUserSessions(id, { tx });

    await writeAudit(tx, {
      actor,
      action: isActive ? "user.activate" : "user.deactivate",
      entityType: "User",
      entityId: id,
      entityLabel: labelOf(after),
      summary: `${isActive ? "Reactivated" : "Deactivated"} ${after.email}${
        revokedSessions > 0 ? ` (${revokedSessions} session(s) revoked)` : ""
      }.${meta.reason ? ` Reason: ${meta.reason}` : ""}`,
      diff: diffOf({ isActive: before.isActive }, { isActive }),
      ip: meta.ip,
    });

    return { ...after, revokedSessions };
  });
}

export async function setForcePasswordChange(
  id: string,
  forcePasswordChange: boolean,
  actor: UserActor,
  meta: ClientMeta = {},
): Promise<UserRecord> {
  return db.$transaction(async (tx) => {
    const before = await loadUser(tx, id);
    if (before.deletedAt) throw conflict("This account is deactivated.");
    await assertReach(tx, actor, before, "edit");

    const after = await tx.user.update({
      where: { id },
      data: { forcePasswordChange },
      select: USER_SELECT,
    });

    await writeAudit(tx, {
      actor,
      action: "user.update",
      entityType: "User",
      entityId: id,
      entityLabel: labelOf(after),
      summary: `${forcePasswordChange ? "Required" : "Cleared"} a password change for ${after.email}.`,
      diff: diffOf(
        { forcePasswordChange: before.forcePasswordChange },
        { forcePasswordChange },
      ),
      ip: meta.ip,
    });

    return after;
  });
}

/**
 * Break-glass 2FA removal (D2). Only a super-admin, only for somebody else,
 * always audited: this is the path for "the phone with the authenticator was
 * lost", and it is the one action here that weakens another account's
 * security, so it leaves the loudest trail.
 */
export async function disableUserTwoFactor(
  id: string,
  actor: UserActor,
  meta: ClientMeta = {},
): Promise<UserRecord> {
  if (!actor.isSuperAdmin) {
    throw forbiddenError("Only a super-admin can turn off another admin's two-factor login.");
  }
  if (id === actor.id) {
    throw forbiddenError("Turn off your own two-factor login from Account → Security.");
  }

  return db.$transaction(async (tx) => {
    const before = await loadUser(tx, id);
    if (!before.twoFactorEnabled) {
      throw conflict(`${before.email} does not have two-factor login enabled.`);
    }

    const after = await tx.user.update({
      where: { id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecretEnc: null,
        lastTotpStep: null,
        recoveryCodesHash: [],
      },
      select: USER_SELECT,
    });
    const revoked = await revokeUserSessions(id, { tx });

    await writeAudit(tx, {
      actor,
      action: "user.two_factor_disabled",
      entityType: "User",
      entityId: id,
      entityLabel: labelOf(after),
      summary: `Break-glass: disabled two-factor login for ${after.email} and revoked ${revoked} session(s).${
        meta.reason ? ` Reason: ${meta.reason}` : ""
      }`,
      diff: diffOf({ twoFactorEnabled: true }, { twoFactorEnabled: false }),
      ip: meta.ip,
    });

    return after;
  });
}

// ---------------------------------------------------------------------------
// Reset links and sessions
// ---------------------------------------------------------------------------

export type ResetLinkResult = { status: "accepted" | "rate_limited"; email: string };

/**
 * "Send password reset link". Delegates to the account module so the admin
 * button and the public forgot-password form mint identical tokens under
 * identical rate limits - one token type, one TTL, one revocation rule.
 */
export async function sendUserResetLink(
  id: string,
  actor: UserActor,
  meta: ClientMeta = {},
): Promise<ResetLinkResult> {
  const user = await loadUser(db, id);
  if (user.deletedAt) throw conflict("This account is deactivated.");
  if (user.id !== actor.id) await assertReach(db, actor, user, "reset the password of");

  const result = await requestPasswordReset({
    email: user.email,
    ip: meta.ip ?? "admin",
  });

  await writeAudit({
    actor,
    action: "user.password_reset_sent",
    entityType: "User",
    entityId: id,
    entityLabel: labelOf(user),
    summary:
      result.status === "accepted"
        ? `Sent a password reset link to ${user.email}.`
        : `Password reset link for ${user.email} was rate limited.`,
    ip: meta.ip,
  });

  return { status: result.status, email: user.email };
}

export async function revokeUserSession(
  id: string,
  sessionId: string,
  actor: UserActor,
  meta: ClientMeta = {},
): Promise<{ revoked: boolean }> {
  const user = await loadUser(db, id);
  await assertReach(db, actor, user, "sign out");

  const session = await db.adminSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true },
  });
  if (!session || session.userId !== id) throw notFound("Session");

  const revoked = await revokeAdminSession(sessionId);

  await writeAudit({
    actor,
    action: "user.session_revoke",
    entityType: "User",
    entityId: id,
    entityLabel: labelOf(user),
    summary: `Revoked one session of ${user.email}.`,
    diff: { sessionId },
    ip: meta.ip,
  });

  return { revoked };
}

export async function revokeAllUserSessions(
  id: string,
  actor: UserActor,
  meta: ClientMeta = {},
): Promise<{ revoked: number }> {
  const user = await loadUser(db, id);
  await assertReach(db, actor, user, "sign out");

  const revoked = await revokeUserSessions(id);

  await writeAudit({
    actor,
    action: "user.session_revoke",
    entityType: "User",
    entityId: id,
    entityLabel: labelOf(user),
    summary: `Revoked ${revoked} session(s) of ${user.email}.`,
    diff: { revoked },
    ip: meta.ip,
  });

  return { revoked };
}

// ---------------------------------------------------------------------------
// Deactivation (never a hard delete - D3)
// ---------------------------------------------------------------------------

export type DeactivateResult = {
  id: string;
  email: string;
  revokedSessions: number;
};

/**
 * Soft delete: isActive false, deletedAt stamped, email rewritten to
 * `<id>@deleted.local`, every session revoked. The row itself stays because
 * AuditLog.actorId, Order.createdById and a dozen other columns point at it -
 * an admin's history must survive their departure.
 */
export async function deactivateUser(
  id: string,
  actor: UserActor,
  meta: ClientMeta = {},
): Promise<DeactivateResult> {
  if (id === actor.id) throw forbiddenError("You cannot delete your own account.");

  return db.$transaction(async (tx) => {
    const before = await loadUser(tx, id);
    if (before.deletedAt) throw conflict("This account is already deactivated.");
    await assertReach(tx, actor, before, "delete");
    await assertNotLastSuperAdmin(tx, before, "delete");

    const deletedEmail = `${before.id}@deleted.local`;
    await tx.user.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
        email: deletedEmail,
        forcePasswordChange: false,
        twoFactorEnabled: false,
        twoFactorSecretEnc: null,
        recoveryCodesHash: [],
      },
    });
    await tx.passwordResetToken.deleteMany({ where: { userId: id } });
    const revokedSessions = await revokeUserSessions(id, { tx });

    await writeAudit(tx, {
      actor,
      action: "user.delete",
      entityType: "User",
      entityId: id,
      entityLabel: labelOf(before),
      summary: `Deactivated ${before.email} (soft delete; ${revokedSessions} session(s) revoked).${
        meta.reason ? ` Reason: ${meta.reason}` : ""
      }`,
      diff: diffOf(
        { email: before.email, isActive: before.isActive, deletedAt: null },
        { email: deletedEmail, isActive: false, deletedAt: "set" },
      ),
      ip: meta.ip,
    });

    return { id, email: before.email, revokedSessions };
  });
}

export { SUPER_ADMIN_ROLE_SLUG };
