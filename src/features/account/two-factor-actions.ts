"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { signOut, unstable_update } from "@/lib/auth";
import { requireAdminOrThrow, LOGIN_PATH, SECURITY_PATH } from "@/lib/auth/guards";
import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import {
  beginEnrolment,
  cancelEnrolment,
  confirmEnrolment,
  disableTwoFactor,
  verifyChallenge,
  type EnrolmentStart,
} from "./two-factor";
import { signOutAction } from "./auth-actions";
import { safeCallbackPath } from "./redirects";
import { requestMeta } from "./request-meta";

/**
 * Two-factor Server Actions (blueprint §14.D2). The enrolment/disable actions
 * run for a fully signed-in actor. `verifyTwoFactorChallenge` is the ONE
 * place in the codebase that passes `allowPendingMfa` - it is the step that
 * turns a pending session into a verified one.
 */

const passwordInput = z.object({ currentPassword: z.string().min(1, "Enter your current password.") });
const codeInput = z.object({ code: z.string().trim().min(6, "Enter the 6-digit code.").max(32) });

export async function beginTwoFactorEnrolment(
  input: z.input<typeof passwordInput>,
): Promise<ActionResult<EnrolmentStart>> {
  return runAction(async () => {
    const actor = await requireAdminOrThrow();
    const parsed = passwordInput.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await beginEnrolment(actor.id, parsed.data.currentPassword, await requestMeta());
    if (!result.ok) return fail(result.message, { currentPassword: result.message });
    return ok(result.start);
  });
}

export async function confirmTwoFactorEnrolment(
  input: z.input<typeof codeInput>,
): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  return runAction(async () => {
    const actor = await requireAdminOrThrow();
    const parsed = codeInput.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await confirmEnrolment(actor.id, parsed.data.code, await requestMeta());
    if (!result.ok) return fail(result.message, { code: result.message });

    revalidatePath("/admin", "layout");
    return ok({ recoveryCodes: result.recoveryCodes }, "Two-factor authentication is on.");
  });
}

export async function cancelTwoFactorEnrolment(): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireAdminOrThrow();
    await cancelEnrolment(actor.id);
    revalidatePath(SECURITY_PATH);
    return ok(undefined);
  });
}

export async function disableTwoFactorAction(
  input: z.input<typeof passwordInput> & z.input<typeof codeInput>,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireAdminOrThrow();
    const parsed = passwordInput.merge(codeInput).safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await disableTwoFactor(actor.id, parsed.data, await requestMeta());
    if (!result.ok) {
      const field = /password/i.test(result.message) ? "currentPassword" : "code";
      return fail(result.message, { [field]: result.message });
    }

    revalidatePath("/admin", "layout");
    return ok(undefined, "Two-factor authentication is off.");
  });
}

// ---------------------------------------------------------------------------
// The post-login challenge
// ---------------------------------------------------------------------------

export type ChallengeState = { error?: string; attemptsLeft?: number };

/**
 * useActionState handler for /admin/two-factor. On success the session row is
 * marked verified and the JWT's `pendingMfa` claim is flipped so proxy.ts
 * (which only sees the cookie) lets the browser through; then redirect.
 * On the fifth failure the service revoked the session, so sign out.
 */
export async function verifyTwoFactorChallenge(
  _prev: ChallengeState,
  formData: FormData,
): Promise<ChallengeState> {
  const actor = await requireAdminOrThrow({ allowPendingMfa: true });
  if (!actor.pendingMfa) redirect(safeCallbackPath(formData.get("callbackUrl")));

  const parsed = codeInput.safeParse({ code: formData.get("code") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter the code." };

  const result = await verifyChallenge(actor.id, actor.sessionId, parsed.data.code, await requestMeta());

  if (!result.ok) {
    if (result.revoked) {
      await signOut({ redirectTo: `${LOGIN_PATH}?reason=2fa_locked` });
    }
    return { error: result.message, attemptsLeft: result.revoked ? 0 : result.attemptsLeft };
  }

  await unstable_update({ pendingMfa: false });
  redirect(safeCallbackPath(formData.get("callbackUrl")));
}

/** Abandon a pending challenge: revoke the half-open session and sign out. */
export async function abandonTwoFactorChallenge(): Promise<void> {
  await signOutAction();
}
