import { db } from "@/lib/db";
import { rateLimit, rateLimitKey, backoffRemainingMs } from "@/lib/rate-limit";
import { notify } from "@/features/notifications/service";

/**
 * Login abuse controls (blueprint §14.D9).
 *
 * Two layers, evaluated in this order:
 *
 * 1. Per IP, a fixed window: 30 attempts / 15 minutes. This is the cheap
 *    outer wall against credential stuffing from one source and runs BEFORE
 *    the email is even looked at, so a flood never reaches bcrypt.
 * 2. Per email, exponential backoff computed from the run of recent failed
 *    LoginAttempt rows: 1 s after the first failure, doubling to a 15 minute
 *    ceiling, reset by any success. Backoff rather than a hard lockout because
 *    a lockout is a denial-of-service button - anyone who knows an operator's
 *    email could keep them out - while backoff only slows the attacker down.
 *
 * After 10 consecutive failures on one email the super-admins are told, once
 * per run, so a live attack is visible in the notification bell rather than
 * only in the LoginAttempt table.
 */

export const LOGIN_IP_LIMIT = 30;
export const LOGIN_IP_WINDOW_MS = 15 * 60_000;

/** Only failures inside this window count towards the backoff run. */
export const LOGIN_FAILURE_LOOKBACK_MS = 24 * 60 * 60_000;

/** Consecutive failures on one email that trigger a super-admin notification. */
export const LOGIN_ALERT_THRESHOLD = 10;

export type LoginGate =
  | { allowed: true }
  | { allowed: false; reason: "ip_limited" | "backoff"; retryAfterSec: number };

/** Step 1: the per-IP window. `unknown` IPs (no trusted proxy) share a bucket. */
export async function checkLoginIpLimit(ip: string): Promise<LoginGate> {
  const result = await rateLimit(rateLimitKey("login", "ip", ip), {
    limit: LOGIN_IP_LIMIT,
    windowMs: LOGIN_IP_WINDOW_MS,
  });
  if (result.ok) return { allowed: true };
  return { allowed: false, reason: "ip_limited", retryAfterSec: result.retryAfterSec };
}

/**
 * Consecutive failures since the last success, capped to the lookback window.
 * Bounded by `take` so a hammered email never turns into a large scan.
 */
export async function recentConsecutiveFailures(
  email: string,
): Promise<{ failures: number; lastFailureAt: Date | null }> {
  const since = new Date(Date.now() - LOGIN_FAILURE_LOOKBACK_MS);
  const attempts = await db.loginAttempt.findMany({
    where: { email, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { success: true, createdAt: true },
    take: 64,
  });

  let failures = 0;
  let lastFailureAt: Date | null = null;
  for (const attempt of attempts) {
    if (attempt.success) break;
    failures += 1;
    lastFailureAt ??= attempt.createdAt;
  }
  return { failures, lastFailureAt };
}

/** Step 2: the per-email backoff. */
export async function checkLoginBackoff(email: string): Promise<LoginGate> {
  const { failures, lastFailureAt } = await recentConsecutiveFailures(email);
  const remainingMs = backoffRemainingMs(failures, lastFailureAt);
  if (remainingMs <= 0) return { allowed: true };
  return {
    allowed: false,
    reason: "backoff",
    retryAfterSec: Math.max(1, Math.ceil(remainingMs / 1000)),
  };
}

export type RecordAttemptInput = {
  email: string;
  success: boolean;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Persist the attempt and, on the failure that crosses the alert threshold,
 * tell the super-admins. Exactly-at-threshold rather than at-or-above so a
 * sustained attack produces one notification per run, not one per attempt.
 */
export async function recordLoginAttempt(input: RecordAttemptInput): Promise<void> {
  await db.loginAttempt.create({
    data: {
      email: input.email,
      success: input.success,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
    },
  });

  if (input.success) return;

  const { failures } = await recentConsecutiveFailures(input.email);
  if (failures !== LOGIN_ALERT_THRESHOLD) return;

  try {
    await notify({
      type: "SYSTEM",
      severity: "warning",
      title: "Repeated failed admin sign-ins",
      body: `${LOGIN_ALERT_THRESHOLD} consecutive failed sign-in attempts for ${input.email}${
        input.ip && input.ip !== "unknown" ? ` from ${input.ip}` : ""
      }. The account is under exponential backoff.`,
      href: "/admin/audit-log?action=auth.login_failed",
      entityType: "login_attempt",
      // Super-admins only: this code is super-admin-only by definition (D14),
      // and super-admins bypass the permission filter anyway.
      permission: "settings.manage_security",
    });
  } catch (error) {
    console.error("LOGIN ALERT NOTIFY FAILED", error);
  }
}
