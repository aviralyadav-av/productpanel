"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";

import {
  deactivateUserSchema,
  inviteUserSchema,
  setForcePasswordChangeSchema,
  setUserRoleSchema,
  setUserStatusSchema,
  userIdSchema,
  userProfileSchema,
  type DeactivateUserInput,
  type InviteUserInput,
  type SetForcePasswordChangeInput,
  type SetUserRoleInput,
  type SetUserStatusInput,
  type UserProfileInput,
} from "./schemas";
import {
  deactivateUser,
  disableUserTwoFactor,
  inviteUser,
  revokeAllUserSessions,
  revokeUserSession,
  sendUserResetLink,
  setForcePasswordChange,
  setUserRole,
  setUserStatus,
  updateUserProfile,
} from "./service";

/**
 * Server Actions behind /admin/users. Thin by design: permission -> zod ->
 * service -> revalidate. Every D3 rule is decided inside the service, so a
 * button the UI forgot to disable still cannot do the thing.
 */
const LIST_PATH = "/admin/users";

function detailPath(id: string): string {
  return `${LIST_PATH}/${id}`;
}

function badId(): ActionResult<never> {
  return fail("Invalid user id.");
}

export async function inviteUserAction(
  input: InviteUserInput,
): Promise<ActionResult<{ id: string; email: string; emailQueued: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("users.create");
    const parsed = inviteUserSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await inviteUser(parsed.data, actor);
    revalidatePath(LIST_PATH);
    return ok(
      { id: result.id, email: result.email, emailQueued: result.emailQueued },
      result.emailQueued
        ? `Invited ${result.email}. The link expires in 48 hours.`
        : `Created ${result.email}, but the invite email could not be queued - check the admin_invite template.`,
    );
  });
}

export async function updateUserAction(
  id: string,
  input: UserProfileInput,
): Promise<ActionResult<{ id: string; revokedSessions: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("users.edit");
    const userId = userIdSchema.safeParse(id);
    if (!userId.success) return badId();
    const parsed = userProfileSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const user = await updateUserProfile(userId.data, parsed.data, actor);
    revalidatePath(LIST_PATH);
    revalidatePath(detailPath(userId.data));
    return ok(
      { id: user.id, revokedSessions: user.revokedSessions },
      user.revokedSessions > 0
        ? `Saved. The email changed, so ${user.revokedSessions} session(s) were signed out.`
        : "Saved.",
    );
  });
}

export async function setUserRoleAction(
  id: string,
  input: SetUserRoleInput,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("users.edit");
    const userId = userIdSchema.safeParse(id);
    if (!userId.success) return badId();
    const parsed = setUserRoleSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const user = await setUserRole(userId.data, parsed.data.roleId, actor);
    revalidatePath(LIST_PATH);
    revalidatePath(detailPath(userId.data));
    return ok({ id: user.id }, `${user.email} is now ${user.role?.name ?? "role-less"}.`);
  });
}

export async function setUserStatusAction(
  id: string,
  input: SetUserStatusInput,
): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("users.edit");
    const userId = userIdSchema.safeParse(id);
    if (!userId.success) return badId();
    const parsed = setUserStatusSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const user = await setUserStatus(userId.data, parsed.data.isActive, actor, {
      reason: parsed.data.reason,
    });
    revalidatePath(LIST_PATH);
    revalidatePath(detailPath(userId.data));
    return ok(
      { id: user.id, isActive: user.isActive },
      user.isActive ? `${user.email} reactivated.` : `${user.email} deactivated.`,
    );
  });
}

export async function setForcePasswordChangeAction(
  id: string,
  input: SetForcePasswordChangeInput,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("users.edit");
    const userId = userIdSchema.safeParse(id);
    if (!userId.success) return badId();
    const parsed = setForcePasswordChangeSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const user = await setForcePasswordChange(
      userId.data,
      parsed.data.forcePasswordChange,
      actor,
    );
    revalidatePath(detailPath(userId.data));
    return ok(
      { id: user.id },
      parsed.data.forcePasswordChange
        ? "They must choose a new password at the next sign-in."
        : "The forced password change was cleared.",
    );
  });
}

export async function sendUserResetLinkAction(
  id: string,
): Promise<ActionResult<{ email: string; status: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("users.edit");
    const userId = userIdSchema.safeParse(id);
    if (!userId.success) return badId();

    const result = await sendUserResetLink(userId.data, actor);
    revalidatePath(detailPath(userId.data));
    return ok(
      result,
      result.status === "accepted"
        ? `A reset link is on its way to ${result.email}. It expires in 30 minutes.`
        : "Too many reset links were requested for this address recently. Try again later.",
    );
  });
}

export async function disableUserTwoFactorAction(
  id: string,
  reason?: string,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("users.edit");
    const userId = userIdSchema.safeParse(id);
    if (!userId.success) return badId();

    const user = await disableUserTwoFactor(userId.data, actor, { reason: reason ?? null });
    revalidatePath(detailPath(userId.data));
    return ok(
      { id: user.id },
      `Two-factor login is off for ${user.email} and their sessions were signed out.`,
    );
  });
}

export async function revokeUserSessionAction(
  id: string,
  sessionId: string,
): Promise<ActionResult<{ revoked: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("users.edit");
    const userId = userIdSchema.safeParse(id);
    if (!userId.success) return badId();

    const result = await revokeUserSession(userId.data, sessionId, actor);
    revalidatePath(detailPath(userId.data));
    return ok(result, "Session signed out.");
  });
}

export async function revokeAllUserSessionsAction(
  id: string,
): Promise<ActionResult<{ revoked: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("users.edit");
    const userId = userIdSchema.safeParse(id);
    if (!userId.success) return badId();

    const result = await revokeAllUserSessions(userId.data, actor);
    revalidatePath(detailPath(userId.data));
    return ok(result, `${result.revoked} session(s) signed out.`);
  });
}

export async function deactivateUserAction(
  id: string,
  input: DeactivateUserInput = {},
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("users.delete");
    const userId = userIdSchema.safeParse(id);
    if (!userId.success) return badId();
    const parsed = deactivateUserSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await deactivateUser(userId.data, actor, { reason: parsed.data.reason });
    revalidatePath(LIST_PATH);
    revalidatePath(detailPath(userId.data));
    return ok(
      { id: result.id },
      `${result.email} was deactivated. The account is kept so its history stays attributable.`,
    );
  });
}
