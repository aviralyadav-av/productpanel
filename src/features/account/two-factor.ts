import bcrypt from "bcryptjs";
import QRCode from "qrcode";

import { db } from "@/lib/db";
import {
  decrypt,
  encrypt,
  findRecoveryCode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCodes,
  totpUri,
  verifyTotp,
} from "@/lib/crypto";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { recordAuthAudit } from "@/lib/auth/audit";
import { markSessionMfaVerified, revokeAdminSession } from "@/lib/auth/session";
import { readSettingString } from "@/features/finance/settings-reader";

/**
 * TOTP two-factor authentication for admin users (blueprint §14.D2).
 *
 * Lifecycle:
 *   beginEnrolment  → provisional secret stored encrypted, twoFactorEnabled
 *                     stays FALSE; the operator scans the QR.
 *   confirmEnrolment→ one valid code flips twoFactorEnabled and mints ten
 *                     single-use recovery codes, returned in plaintext ONCE.
 *   disable         → current password + a valid code (or recovery code).
 *   verifyChallenge → the /admin/two-factor step after sign-in: marks the
 *                     AdminSession verified; 5 failures revoke the session.
 *
 * Replay protection: `User.lastTotpStep` remembers the last accepted counter
 * and verifyTotp refuses anything at or before it, so a code seen over a
 * shoulder is worthless once used - even inside its 30 s window.
 *
 * The secret is decrypted only here (D4: decrypt is service-only). Route and
 * action layers never see it; they get a QR data-URL and a manual key during
 * enrolment, and booleans afterwards.
 *
 * No Next imports.
 */

export const TOTP_ISSUER_FALLBACK = "DIY Baazar Admin";
export const RECOVERY_CODE_COUNT = 10;
export const CHALLENGE_MAX_FAILURES = 5;
export const CHALLENGE_FAILURE_WINDOW_MS = 15 * 60_000;

type Meta = { ip?: string | null; userAgent?: string | null };

export type EnrolmentStart = {
  /** otpauth:// URI rendered as a PNG data URL for <img src>. */
  qrDataUrl: string;
  /** The base32 secret for manual entry, grouped in fours for readability. */
  manualKey: string;
  issuer: string;
  account: string;
};

async function issuerName(): Promise<string> {
  const name = (await readSettingString(undefined, "store.name")).trim();
  return name ? `${name} Admin` : TOTP_ISSUER_FALLBACK;
}

function groupKey(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

async function verifyPassword(userId: string, password: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) return false;
  return bcrypt.compare(password, user.passwordHash);
}

/**
 * Start (or restart) enrolment. Requires the current password so a hijacked
 * but unlocked session cannot silently enrol an attacker's authenticator.
 * Refused while 2FA is already on - disable first, then re-enrol.
 */
export async function beginEnrolment(
  userId: string,
  currentPassword: string,
  meta: Meta = {},
): Promise<{ ok: true; start: EnrolmentStart } | { ok: false; message: string }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, twoFactorEnabled: true },
  });
  if (!user) return { ok: false, message: "Your account could not be loaded. Sign in again." };
  if (user.twoFactorEnabled) {
    return { ok: false, message: "Two-factor authentication is already enabled. Disable it before enrolling again." };
  }
  if (!(await verifyPassword(userId, currentPassword))) {
    return { ok: false, message: "That is not your current password." };
  }

  const secret = generateTotpSecret();
  const issuer = await issuerName();
  const uri = totpUri({ issuer, account: user.email, secret });

  await db.user.update({
    where: { id: userId },
    data: { twoFactorSecretEnc: encrypt(secret, "2fa"), lastTotpStep: null },
  });

  await recordAuthAudit({
    userId,
    email: user.email,
    action: "auth.2fa_enrolment_started",
    summary: `${user.email} started two-factor enrolment`,
    ...meta,
  });

  return {
    ok: true,
    start: {
      qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 192 }),
      manualKey: groupKey(secret),
      issuer,
      account: user.email,
    },
  };
}

/** Finish enrolment with one valid code. Returns the recovery codes ONCE. */
export async function confirmEnrolment(
  userId: string,
  code: string,
  meta: Meta = {},
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; message: string }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, twoFactorEnabled: true, twoFactorSecretEnc: true, lastTotpStep: true },
  });
  if (!user) return { ok: false, message: "Your account could not be loaded. Sign in again." };
  if (user.twoFactorEnabled) return { ok: false, message: "Two-factor authentication is already enabled." };
  if (!user.twoFactorSecretEnc) {
    return { ok: false, message: "Start enrolment first, then enter the code from your app." };
  }

  const result = verifyTotp({
    secret: decrypt(user.twoFactorSecretEnc, "2fa"),
    code,
    lastCounter: user.lastTotpStep,
  });
  if (!result.ok) return { ok: false, message: "That code is not right. Check the time on your device and try again." };

  const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  const recoveryCodesHash = await hashRecoveryCodes(recoveryCodes);

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true, lastTotpStep: result.counter, recoveryCodesHash },
    });
    await recordAuthAudit({
      userId,
      email: user.email,
      action: "auth.2fa_enabled",
      summary: `${user.email} enabled two-factor authentication`,
      ...meta,
      tx,
    });
  });

  return { ok: true, recoveryCodes };
}

/** Throw away a provisional secret the operator never confirmed. */
export async function cancelEnrolment(userId: string): Promise<void> {
  await db.user.updateMany({
    where: { id: userId, twoFactorEnabled: false },
    data: { twoFactorSecretEnc: null, lastTotpStep: null },
  });
}

/**
 * Check a code against the user's secret, falling back to a recovery code.
 * On success the accepted counter (or the consumed recovery code) is
 * persisted inside the caller's flow so replay is impossible.
 */
async function consumeCode(
  user: { id: string; twoFactorSecretEnc: string | null; lastTotpStep: number | null; recoveryCodesHash: string[] },
  code: string,
): Promise<{ ok: true; via: "totp" | "recovery"; remainingRecovery: number } | { ok: false }> {
  const trimmed = code.trim();

  if (user.twoFactorSecretEnc && /^\d{6}$/.test(trimmed.replace(/\s+/g, ""))) {
    const result = verifyTotp({
      secret: decrypt(user.twoFactorSecretEnc, "2fa"),
      code: trimmed,
      lastCounter: user.lastTotpStep,
    });
    if (result.ok) {
      await db.user.update({ where: { id: user.id }, data: { lastTotpStep: result.counter } });
      return { ok: true, via: "totp", remainingRecovery: user.recoveryCodesHash.length };
    }
    return { ok: false };
  }

  const index = await findRecoveryCode(trimmed, user.recoveryCodesHash);
  if (index === -1) return { ok: false };

  const remaining = user.recoveryCodesHash.filter((_, i) => i !== index);
  await db.user.update({ where: { id: user.id }, data: { recoveryCodesHash: remaining } });
  return { ok: true, via: "recovery", remainingRecovery: remaining.length };
}

/** Turn 2FA off: current password AND a valid code or recovery code. */
export async function disableTwoFactor(
  userId: string,
  input: { currentPassword: string; code: string },
  meta: Meta = {},
): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      twoFactorEnabled: true,
      twoFactorSecretEnc: true,
      lastTotpStep: true,
      recoveryCodesHash: true,
    },
  });
  if (!user) return { ok: false, message: "Your account could not be loaded. Sign in again." };
  if (!user.twoFactorEnabled) return { ok: false, message: "Two-factor authentication is not enabled." };
  if (!(await verifyPassword(userId, input.currentPassword))) {
    return { ok: false, message: "That is not your current password." };
  }

  const check = await consumeCode(user, input.code);
  if (!check.ok) return { ok: false, message: "That code is not right." };

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecretEnc: null,
        lastTotpStep: null,
        recoveryCodesHash: [],
      },
    });
    await recordAuthAudit({
      userId,
      email: user.email,
      action: "auth.2fa_disabled",
      summary: `${user.email} disabled two-factor authentication (verified via ${check.via})`,
      ...meta,
      tx,
    });
  });

  return { ok: true };
}

export type ChallengeResult =
  | { ok: true; via: "totp" | "recovery"; remainingRecovery: number }
  | { ok: false; revoked: false; attemptsLeft: number; message: string }
  | { ok: false; revoked: true; message: string };

/**
 * The post-login challenge. Each failure counts against the SESSION, not the
 * user, so an attacker with a stolen password cannot lock the real operator
 * out of their own verified devices; on the fifth failure the pending session
 * is revoked and the caller signs the browser out.
 */
export async function verifyChallenge(
  userId: string,
  sessionId: string,
  code: string,
  meta: Meta = {},
): Promise<ChallengeResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      twoFactorEnabled: true,
      twoFactorSecretEnc: true,
      lastTotpStep: true,
      recoveryCodesHash: true,
    },
  });
  if (!user || !user.twoFactorEnabled) {
    return { ok: false, revoked: true, message: "This session can no longer be verified. Sign in again." };
  }

  const check = await consumeCode(user, code);

  if (check.ok) {
    await markSessionMfaVerified(sessionId);
    await recordAuthAudit({
      userId,
      email: user.email,
      action: "auth.2fa_verified",
      summary: `${user.email} passed the two-factor challenge via ${check.via}`,
      entityType: "admin_session",
      entityId: sessionId,
      ...meta,
    });
    return check;
  }

  const bucket = await rateLimit(rateLimitKey("2fa", "session", sessionId), {
    limit: CHALLENGE_MAX_FAILURES,
    windowMs: CHALLENGE_FAILURE_WINDOW_MS,
  });
  const failures = CHALLENGE_MAX_FAILURES - bucket.remaining;

  if (!bucket.ok || bucket.remaining === 0) {
    await revokeAdminSession(sessionId);
    await recordAuthAudit({
      userId,
      email: user.email,
      action: "auth.2fa_failed",
      summary: `${user.email} failed the two-factor challenge ${CHALLENGE_MAX_FAILURES} times; session revoked`,
      entityType: "admin_session",
      entityId: sessionId,
      diff: { failures, revoked: true },
      ...meta,
    });
    return {
      ok: false,
      revoked: true,
      message: "Too many incorrect codes. You have been signed out - sign in again to retry.",
    };
  }

  await recordAuthAudit({
    userId,
    email: user.email,
    action: "auth.2fa_failed",
    summary: `${user.email} entered an incorrect two-factor code`,
    entityType: "admin_session",
    entityId: sessionId,
    diff: { failures, revoked: false },
    ...meta,
  });

  return {
    ok: false,
    revoked: false,
    attemptsLeft: bucket.remaining,
    message: `That code is not right. ${bucket.remaining} attempt${bucket.remaining === 1 ? "" : "s"} left.`,
  };
}

/** What the security page shows: booleans only, never the secret. */
export async function twoFactorStatus(userId: string): Promise<{
  enabled: boolean;
  enrolmentPending: boolean;
  recoveryCodesLeft: number;
}> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true, twoFactorSecretEnc: true, recoveryCodesHash: true },
  });
  return {
    enabled: user?.twoFactorEnabled ?? false,
    enrolmentPending: Boolean(user && !user.twoFactorEnabled && user.twoFactorSecretEnc),
    recoveryCodesLeft: user?.recoveryCodesHash.length ?? 0,
  };
}
