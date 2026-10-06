import { rateLimited } from "@/lib/api/errors";
import { requireStorefrontKey } from "@/lib/api/public";
import { hashToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";

/**
 * Every /api/v1/integration handler starts with this (blueprint E7):
 * constant-time key check, then a fixed window of 600 requests per minute
 * per key. The bucket is keyed by a hash of the key rather than the key
 * itself so the plaintext never lands in the RateLimitBucket table.
 *
 * The per-IP limit in withPublicApi still applies on top; the website's
 * server usually calls from one address, so the per-key budget is the
 * meaningful one.
 */
export const INTEGRATION_RATE_LIMIT = { limit: 600, windowMs: 60_000 } as const;

export async function guardIntegration(req: Request): Promise<void> {
  requireStorefrontKey(req);
  const bucket = hashToken(env.STOREFRONT_API_KEY ?? "").slice(0, 24);
  const result = await rateLimit(rateLimitKey("integration", bucket), INTEGRATION_RATE_LIMIT);
  if (!result.ok) throw rateLimited(result.retryAfterSec);
}

/** Route params arrive percent-encoded from some clients; an undecodable value is simply a miss. */
export function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
