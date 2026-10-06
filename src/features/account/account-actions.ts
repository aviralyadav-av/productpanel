"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireAdminOrThrow } from "@/lib/auth/guards";
import { recordAuthAudit } from "@/lib/auth/audit";
import { revokeAdminSession, revokeUserSessions } from "@/lib/auth/session";
import { diffOf, writeAudit } from "@/lib/audit";
import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { optionalTextSchema, phoneSchema } from "@/lib/validation";
import { BCRYPT_ROUNDS, passwordProblem, passwordSchema } from "./password-policy";
import { requestMeta } from "./request-meta";

/**
 * Self-service account actions: profile, password, sessions. Every one acts
 * on the ACTOR'S OWN row only. Changing other users is the users module's job
 * (D3 rules live there).
 */

const ACCOUNT_PATH = "/admin/account";

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80, "Keep it under 80 characters."),
  phone: z.union([z.literal(""), phoneSchema]).optional(),
  image: optionalTextSchema(500).optional(),
});

export type ProfileInput = z.input<typeof profileSchema>;

export async function updateProfile(input: ProfileInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireAdminOrThrow();
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const before = await db.user.findUnique({
      where: { id: actor.id },
      select: { name: true, phone: true, image: true },
    });
    if (!before) return fail("Your account could not be loaded. Sign in again.");

    const after = {
      name: parsed.data.name,
      phone: parsed.data.phone ? parsed.data.phone : null,
      image: parsed.data.image ? parsed.data.image : null,
    };
    const diff = diffOf(before, after);
    if (!diff) return ok(undefined, "Nothing to save - your profile is unchanged.");

    await db.user.update({ where: { id: actor.id }, data: after });
    await writeAudit({
      actor,
      action: "account.update",
      entityType: "user",
      entityId: actor.id,
      entityLabel: actor.email,
      summary: "Updated own profile",
      diff,
    });

    revalidatePath("/admin", "layout");
    return ok(undefined, "Profile saved.");
  });
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: passwordSchema,
  confirmPassword: z.string().min(1, "Repeat the new password."),
});

export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

/**
 * Also the exit from a forced password change (D10): the guard lets a
 * forcePasswordChange actor reach only this action, and success clears the
 * flag. Other sessions are revoked - if the reason for the change was a leak,
 * whoever else is signed in as you is now signed out.
 */
export async function changePassword(input: ChangePasswordInput): Promise<ActionResult<{ revokedOthers: number }>> {
  return runAction(async () => {
    const actor = await requireAdminOrThrow({ allowForcedPasswordChange: true });
    const parsed = changePasswordSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    if (parsed.data.newPassword !== parsed.data.confirmPassword) {
      return fail("The two new passwords do not match.", { confirmPassword: "These do not match." });
    }

    const user = await db.user.findUnique({
      where: { id: actor.id },
      select: { passwordHash: true, email: true, name: true },
    });
    if (!user) return fail("Your account could not be loaded. Sign in again.");

    if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
      return fail("That is not your current password.", { currentPassword: "Incorrect password." });
    }
    if (await bcrypt.compare(parsed.data.newPassword, user.passwordHash)) {
      return fail("The new password is the same as the current one.", {
        newPassword: "Choose a different password.",
      });
    }
    const problem = passwordProblem(parsed.data.newPassword, { email: user.email, name: user.name });
    if (problem) return fail(problem, { newPassword: problem });

    const meta = await requestMeta();
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS);

    const revokedOthers = await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: actor.id },
        data: { passwordHash, forcePasswordChange: false },
      });
      const revoked = await revokeUserSessions(actor.id, { exceptSessionId: actor.sessionId, tx });
      // No diff, deliberately: password material never reaches the logger.
      await recordAuthAudit({
        userId: actor.id,
        email: actor.email,
        action: "auth.password_change",
        summary: `${actor.email} changed their password; ${revoked} other session${revoked === 1 ? "" : "s"} revoked`,
        ...meta,
        tx,
      });
      return revoked;
    });

    revalidatePath("/admin", "layout");
    return ok(
      { revokedOthers },
      revokedOthers > 0
        ? `Password changed. ${revokedOthers} other device${revokedOthers === 1 ? " was" : "s were"} signed out.`
        : "Password changed.",
    );
  });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const sessionIdSchema = z.string().min(1).max(64);

/** Revoke one of the actor's own sessions. Revoking the current one signs out. */
export async function revokeOwnSession(sessionId: string): Promise<ActionResult<{ wasCurrent: boolean }>> {
  return runAction(async () => {
    const actor = await requireAdminOrThrow();
    const parsed = sessionIdSchema.safeParse(sessionId);
    if (!parsed.success) return zodFail(parsed.error);

    // Ownership check: the row must be the actor's, or nothing happens.
    const row = await db.adminSession.findFirst({
      where: { id: parsed.data, userId: actor.id },
      select: { id: true, deviceLabel: true },
    });
    if (!row) return fail("That session was not found.");

    const revoked = await revokeAdminSession(row.id);
    const meta = await requestMeta();
    await recordAuthAudit({
      userId: actor.id,
      email: actor.email,
      action: "auth.session_revoked",
      summary: `${actor.email} revoked a session (${row.deviceLabel ?? "unknown device"})`,
      entityType: "admin_session",
      entityId: row.id,
      ...meta,
    });

    revalidatePath(`${ACCOUNT_PATH}/sessions`);
    return ok(
      { wasCurrent: row.id === actor.sessionId },
      revoked ? "Session revoked." : "That session had already ended.",
    );
  });
}

/** Sign out every other device, keeping this one. */
export async function revokeOtherSessions(): Promise<ActionResult<{ revoked: number }>> {
  return runAction(async () => {
    const actor = await requireAdminOrThrow();
    const revoked = await revokeUserSessions(actor.id, { exceptSessionId: actor.sessionId });
    const meta = await requestMeta();
    await recordAuthAudit({
      userId: actor.id,
      email: actor.email,
      action: "auth.session_revoked",
      summary: `${actor.email} signed out ${revoked} other device${revoked === 1 ? "" : "s"}`,
      entityType: "admin_session",
      entityId: actor.sessionId,
      diff: { revoked },
      ...meta,
    });

    revalidatePath(`${ACCOUNT_PATH}/sessions`);
    return ok(
      { revoked },
      revoked > 0 ? `${revoked} other device${revoked === 1 ? "" : "s"} signed out.` : "No other devices were signed in.",
    );
  });
}
