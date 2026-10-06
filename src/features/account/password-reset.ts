import bcrypt from "bcryptjs";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hashToken, randomToken } from "@/lib/crypto";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { recordAuthAudit } from "@/lib/auth/audit";
import { revokeUserSessions } from "@/lib/auth/session";
import { queueEmail } from "@/features/email/service";
import { BCRYPT_ROUNDS, passwordProblem } from "./password-policy";

/**
 * Forgot / reset password for ADMIN users (blueprint §14.D9, D10, D13).
 *
 * Design points that are easy to get wrong, spelled out:
 *  - The request path answers identically whether or not the email exists,
 *    is inactive, or has no role. Only the rate limiter can refuse, and it
 *    refuses the same way. User enumeration through this form is not possible.
 *  - Tokens are 256-bit random, stored only as SHA-256; the plaintext lives in
 *    the email link and nowhere else. 30 minute TTL, single use.
 *  - A new request invalidates older unused tokens for that user, so at most
 *    one live link exists per account.
 *  - Completing a reset revokes EVERY session of the user: if the password
 *    was reset because it leaked, whoever holds it is signed out now.
 *  - Reset links are built from env.APP_ORIGIN, never from request headers,
 *    so a spoofed Host header cannot redirect the link to an attacker.
 *
 * No Next imports: pure service, called from password-reset-actions.ts.
 */

export const RESET_TOKEN_TTL_MINUTES = 30;
export const RESET_EMAIL_LIMIT = { limit: 3, windowMs: 60 * 60_000 };
export const RESET_IP_LIMIT = { limit: 10, windowMs: 60 * 60_000 };
export const RESET_COMPLETE_IP_LIMIT = { limit: 20, windowMs: 60 * 60_000 };

export type RequestResetInput = {
  email: string;
  ip: string;
  userAgent?: string | null;
};

export type RequestResetResult =
  | { status: "accepted" }
  | { status: "rate_limited"; retryAfterSec: number };

export function resetUrlFor(token: string): string {
  return `${env.APP_ORIGIN}/admin/reset-password/${encodeURIComponent(token)}`;
}

/**
 * Step 1. Always "accepted" for a well-formed email unless rate limited. The
 * per-IP wall is checked first (cheap, blocks floods), then per-email.
 */
export async function requestPasswordReset(input: RequestResetInput): Promise<RequestResetResult> {
  const email = input.email.trim().toLowerCase();

  const ipGate = await rateLimit(rateLimitKey("pwreset", "ip", input.ip), RESET_IP_LIMIT);
  if (!ipGate.ok) return { status: "rate_limited", retryAfterSec: ipGate.retryAfterSec };

  const emailGate = await rateLimit(rateLimitKey("pwreset", "email", email), RESET_EMAIL_LIMIT);
  if (!emailGate.ok) return { status: "rate_limited", retryAfterSec: emailGate.retryAfterSec };

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, isActive: true, deletedAt: true, roleId: true },
  });

  await recordAuthAudit({
    userId: user?.id ?? null,
    email,
    action: "auth.password_reset_requested",
    summary: `Password reset requested for ${email}`,
    diff: { known: Boolean(user), eligible: Boolean(user && user.isActive && !user.deletedAt && user.roleId) },
    ip: input.ip,
    userAgent: input.userAgent,
  });

  // Unknown, inactive, deleted or role-less accounts get no email - and the
  // caller cannot tell, because the return value is the same.
  if (!user || !user.isActive || user.deletedAt || !user.roleId) return { status: "accepted" };

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000);

  const row = await db.$transaction(async (tx) => {
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    return tx.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
      select: { id: true },
    });
  });

  await queueEmail({
    templateKey: "admin_password_reset",
    to: { email: user.email, name: user.name },
    vars: {
      name: user.name ?? user.email,
      reset_url: resetUrlFor(token),
      expires_minutes: RESET_TOKEN_TTL_MINUTES,
    },
    entity: { type: "password_reset_token", id: row.id },
    // Every request must produce its own email - never dedupe across requests.
    dedupeKey: null,
  });

  return { status: "accepted" };
}

export type ResetTokenCheck =
  | { ok: true; userId: string; email: string; name: string | null }
  | { ok: false; reason: "invalid" | "expired" | "used" };

/** Look up a plaintext token without consuming it (for the reset page render). */
export async function inspectResetToken(token: string): Promise<ResetTokenCheck> {
  if (!token || token.length < 16 || token.length > 128) return { ok: false, reason: "invalid" };

  const row = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      userId: true,
      usedAt: true,
      expiresAt: true,
      user: { select: { email: true, name: true, isActive: true, deletedAt: true } },
    },
  });

  if (!row || !row.user.isActive || row.user.deletedAt) return { ok: false, reason: "invalid" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  return { ok: true, userId: row.userId, email: row.user.email, name: row.user.name };
}

export type CompleteResetInput = {
  token: string;
  password: string;
  ip: string;
  userAgent?: string | null;
};

export type CompleteResetResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" | "expired" | "used" | "weak_password" | "rate_limited"; message: string };

/**
 * Step 2. Atomic: the token is marked used, siblings deleted, the password
 * replaced, forcePasswordChange cleared and every session revoked in ONE
 * transaction with the audit row inside it (D13 - a failure aborts the reset).
 */
export async function completePasswordReset(input: CompleteResetInput): Promise<CompleteResetResult> {
  const gate = await rateLimit(rateLimitKey("pwreset", "complete", input.ip), RESET_COMPLETE_IP_LIMIT);
  if (!gate.ok) {
    return { ok: false, reason: "rate_limited", message: "Too many attempts. Try again later." };
  }

  const check = await inspectResetToken(input.token);
  if (!check.ok) {
    const message =
      check.reason === "expired"
        ? "This reset link has expired. Request a new one."
        : check.reason === "used"
          ? "This reset link has already been used. Request a new one if you still need it."
          : "This reset link is not valid. Request a new one.";
    return { ok: false, reason: check.reason, message };
  }

  const problem = passwordProblem(input.password, { email: check.email, name: check.name });
  if (problem) return { ok: false, reason: "weak_password", message: problem };

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const tokenHash = hashToken(input.token);
  const now = new Date();

  const consumed = await db.$transaction(async (tx) => {
    // updateMany + count guards the race where two tabs submit the same link.
    const marked = await tx.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (marked.count === 0) return false;

    await tx.passwordResetToken.deleteMany({
      where: { userId: check.userId, tokenHash: { not: tokenHash } },
    });
    await tx.user.update({
      where: { id: check.userId },
      data: { passwordHash, forcePasswordChange: false },
    });
    await revokeUserSessions(check.userId, { tx });
    await recordAuthAudit({
      userId: check.userId,
      email: check.email,
      action: "auth.password_reset",
      summary: `${check.email} completed a password reset; all sessions revoked`,
      ip: input.ip,
      userAgent: input.userAgent,
      tx,
    });
    return true;
  });

  if (!consumed) {
    return {
      ok: false,
      reason: "used",
      message: "This reset link has already been used. Request a new one if you still need it.",
    };
  }

  return { ok: true, email: check.email };
}
