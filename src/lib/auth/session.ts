import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { hashToken, randomToken } from "@/lib/crypto";
import { readSettingNumber } from "@/features/finance/settings-reader";

/**
 * AdminSession rows (blueprint §14.D2, D10).
 *
 * The JWT cookie carries only the row id. Everything that can end a session -
 * sign-out, "revoke other devices", an admin revoking a colleague, the
 * absolute lifetime, the idle timeout, an outstanding 2FA challenge - is
 * recorded on the row and re-read by getActor() on every request, so none of
 * it has to wait for the cookie to expire.
 *
 * This module is imported by authorize() (Route Handler), the guards (RSC),
 * account actions and, eventually, the users module - so it stays free of
 * `server-only` and `next/*`, the same rule services follow.
 */

export const DEFAULT_SESSION_HOURS = 12;
export const DEFAULT_IDLE_MINUTES = 60;

/** lastSeenAt is written at most this often to keep reads cheap (D10). */
export const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60_000;

type Db = Prisma.TransactionClient | typeof db;

export type SessionPolicy = { sessionHours: number; idleMinutes: number };

/** Session lifetime settings with the seeded defaults as a floor. */
export async function readSessionPolicy(tx?: Db): Promise<SessionPolicy> {
  const [sessionHours, idleMinutes] = await Promise.all([
    readSettingNumber(tx, "security.session_hours"),
    readSettingNumber(tx, "security.idle_minutes"),
  ]);
  return {
    sessionHours: sessionHours > 0 ? sessionHours : DEFAULT_SESSION_HOURS,
    idleMinutes: idleMinutes > 0 ? idleMinutes : DEFAULT_IDLE_MINUTES,
  };
}

/**
 * Best-effort "Chrome on Windows" from the user agent so the sessions page
 * can show something a person recognises. Not used for any decision.
 */
export function describeDevice(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent;

  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua) && /Version\//.test(ua)
            ? "Safari"
            : /curl|node|undici|python/i.test(ua)
              ? "Script"
              : "Browser";

  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;

  return os ? `${browser} on ${os}` : browser;
}

export type CreateSessionInput = {
  userId: string;
  twoFactorEnabled: boolean;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
  tx?: Db;
};

/**
 * One row per sign-in. `mfaVerifiedAt` starts null when the user has 2FA so
 * the session exists but is "pending" until a code is accepted (D2) - the
 * guards and the proxy both key off that null.
 */
export async function createAdminSession(input: CreateSessionInput) {
  const client = input.tx ?? db;
  const now = input.now ?? new Date();
  const policy = await readSessionPolicy(client);

  return client.adminSession.create({
    data: {
      userId: input.userId,
      tokenHash: hashToken(randomToken()),
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
      deviceLabel: describeDevice(input.userAgent),
      mfaVerifiedAt: input.twoFactorEnabled ? null : now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + policy.sessionHours * 60 * 60_000),
    },
    select: { id: true, expiresAt: true, mfaVerifiedAt: true },
  });
}

export type LiveSession = {
  id: string;
  userId: string;
  mfaVerifiedAt: Date | null;
  lastSeenAt: Date;
  expiresAt: Date;
  createdAt: Date;
};

export type SessionCheck =
  | { ok: true; session: LiveSession }
  | { ok: false; reason: "missing" | "revoked" | "expired" | "idle" | "mismatch" };

/**
 * Validate the row behind a JWT. Idle and absolute expiry are stamped as
 * revoked when first noticed so the sessions page and "revoke all" never
 * have to reason about half-dead rows.
 */
export async function checkAdminSession(
  sessionId: string,
  userId: string,
  now = new Date(),
): Promise<SessionCheck> {
  const session = await db.adminSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      mfaVerifiedAt: true,
      lastSeenAt: true,
      expiresAt: true,
      createdAt: true,
      revokedAt: true,
    },
  });

  if (!session) return { ok: false, reason: "missing" };
  if (session.userId !== userId) return { ok: false, reason: "mismatch" };
  if (session.revokedAt) return { ok: false, reason: "revoked" };

  if (session.expiresAt.getTime() <= now.getTime()) {
    await stampRevoked(session.id, now);
    return { ok: false, reason: "expired" };
  }

  const policy = await readSessionPolicy();
  const idleLimitMs = policy.idleMinutes * 60_000;
  if (now.getTime() - session.lastSeenAt.getTime() > idleLimitMs) {
    await stampRevoked(session.id, now);
    return { ok: false, reason: "idle" };
  }

  return { ok: true, session };
}

async function stampRevoked(id: string, now: Date): Promise<void> {
  await db.adminSession.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: now },
  });
}

/**
 * Refresh lastSeenAt, but only once the previous stamp is more than five
 * minutes old: an admin clicking through twenty pages a minute should cost
 * one write, not twenty.
 */
export async function touchAdminSession(session: LiveSession, now = new Date()): Promise<void> {
  if (now.getTime() - session.lastSeenAt.getTime() < LAST_SEEN_WRITE_INTERVAL_MS) return;
  await db.adminSession.updateMany({
    where: { id: session.id, revokedAt: null },
    data: { lastSeenAt: now },
  });
}

/** Mark the 2FA challenge on this session as passed (D2). */
export async function markSessionMfaVerified(sessionId: string, tx?: Db): Promise<void> {
  await (tx ?? db).adminSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { mfaVerifiedAt: new Date() },
  });
}

/** Revoke one session. Returns whether a live row was affected. */
export async function revokeAdminSession(sessionId: string, tx?: Db): Promise<boolean> {
  const result = await (tx ?? db).adminSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

/**
 * Revoke every live session of a user, optionally keeping one (the device the
 * operator is using right now, after a password change). Returns the count.
 */
export async function revokeUserSessions(
  userId: string,
  options: { exceptSessionId?: string | null; tx?: Db } = {},
): Promise<number> {
  const result = await (options.tx ?? db).adminSession.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(options.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export type OwnSessionRow = {
  id: string;
  deviceLabel: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  mfaVerifiedAt: Date | null;
  isCurrent: boolean;
};

/** Live sessions of one user for the account page and GET /api/admin/me/sessions. */
export async function listUserSessions(
  userId: string,
  currentSessionId: string | null,
): Promise<OwnSessionRow[]> {
  const rows = await db.adminSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      deviceLabel: true,
      userAgent: true,
      ip: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
      mfaVerifiedAt: true,
    },
  });
  return rows.map((row) => ({ ...row, isCurrent: row.id === currentSessionId }));
}
