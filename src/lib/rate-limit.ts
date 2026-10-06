import { db } from "@/lib/db";

/**
 * Fixed-window rate limiting on Postgres (blueprint §14.D9).
 *
 * Why the database and not memory: the admin runs as several Next processes
 * (dev + worker, or N serverless instances) and an in-memory counter would let
 * an attacker multiply every limit by the instance count. A Redis would also
 * work but is one more thing to run; Postgres is already there and a single
 * upsert per request is cheap against a table this small.
 *
 * Why ONE raw statement: a read-then-write in application code races under
 * concurrent requests and needs a transaction; `INSERT … ON CONFLICT DO
 * UPDATE` is atomic on its own and works outside any Prisma transaction, so
 * callers can use it from Route Handlers, Server Actions and the worker alike.
 */

export type RateLimitOptions = {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export type RateLimitResult = {
  ok: boolean;
  /** Requests left in the current window (0 when over). */
  remaining: number;
  /** Seconds until the window rolls over; 0 when the request was allowed. */
  retryAfterSec: number;
  limit: number;
};

type BucketRow = { windowStart: Date; count: number };

/**
 * Consume one unit from `key`. Over-limit calls still count, which is the
 * intent: hammering a limited endpoint does not shorten the wait.
 */
export async function rateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): Promise<RateLimitResult> {
  if (limit <= 0) return { ok: false, remaining: 0, retryAfterSec: Math.ceil(windowMs / 1000), limit };

  const now = new Date();
  const expiredBefore = new Date(now.getTime() - windowMs);

  const rows = await db.$queryRaw<BucketRow[]>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count")
    VALUES (${key}, ${now}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitBucket"."windowStart" <= ${expiredBefore} THEN 1
        ELSE "RateLimitBucket"."count" + 1
      END,
      "windowStart" = CASE
        WHEN "RateLimitBucket"."windowStart" <= ${expiredBefore} THEN ${now}
        ELSE "RateLimitBucket"."windowStart"
      END
    RETURNING "windowStart", "count"
  `;

  const row = rows[0];
  const count = Number(row?.count ?? 1);
  const windowStart = row?.windowStart ?? now;
  const resetAt = windowStart.getTime() + windowMs;

  if (count > limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)),
      limit,
    };
  }

  return { ok: true, remaining: limit - count, retryAfterSec: 0, limit };
}

/**
 * Build a bucket key from stable parts: `rateLimitKey("login", "ip", ip)`.
 * Parts are sanitised so a hostile header value cannot produce a key that
 * collides with, or is indistinguishable from, another scope's key.
 */
export function rateLimitKey(...parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part ?? "").replace(/[^A-Za-z0-9._:@\-]/g, "_").slice(0, 120))
    .join(":");
}

/**
 * Drop buckets whose window closed more than `olderThanMs` ago. Run from the
 * jobs worker; the table otherwise grows by one row per distinct key forever.
 */
export async function purgeRateLimitBuckets(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const result = await db.rateLimitBucket.deleteMany({
    where: { windowStart: { lt: cutoff } },
  });
  return result.count;
}

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 15 * 60 * 1_000;

/**
 * Per-account login backoff (D9): 1 s after the first failure, doubling to a
 * 15 minute ceiling. This replaces a hard lockout so an attacker cannot lock
 * a real operator out by spamming their email, while still making a brute
 * force impractically slow.
 */
export function exponentialBackoffDelay(failures: number): number {
  if (!Number.isFinite(failures) || failures <= 0) return 0;
  const delay = BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 30);
  return Math.min(delay, BACKOFF_MAX_MS);
}

/** Convenience: is the account still inside its backoff window? */
export function backoffRemainingMs(failures: number, lastFailureAt: Date | null | undefined): number {
  if (!lastFailureAt) return 0;
  const until = lastFailureAt.getTime() + exponentialBackoffDelay(failures);
  return Math.max(0, until - Date.now());
}
