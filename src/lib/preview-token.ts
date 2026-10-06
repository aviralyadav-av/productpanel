import { hmacSign, hmacVerify } from "@/lib/crypto";

/**
 * Preview tokens (blueprint §14.E6).
 *
 * The admin mints one when an operator clicks "Preview" on a draft; the
 * storefront appends it as `?preview=<token>` and the public GET bypasses the
 * status filter for THAT ONE entity only. The token is an HMAC over
 * `${entity}:${id}:${exp}`, so it cannot be moved to another product or
 * extended, and it carries no server state - nothing to store or revoke
 * beyond the ≤ 1 hour expiry.
 */

export const PREVIEW_ENTITIES = ["product", "page", "blog"] as const;
export type PreviewEntity = (typeof PREVIEW_ENTITIES)[number];

export const PREVIEW_MAX_TTL_SECONDS = 3600;
export const PREVIEW_DEFAULT_TTL_SECONDS = 900;

function message(entity: PreviewEntity, id: string, exp: number): string {
  return `${entity}:${id}:${exp}`;
}

/** Returns `<exp>.<sig>`; `exp` is a unix timestamp in seconds. */
export function createPreviewToken({
  entity,
  id,
  ttlSeconds = PREVIEW_DEFAULT_TTL_SECONDS,
  now = Date.now(),
}: {
  entity: PreviewEntity;
  id: string;
  ttlSeconds?: number;
  now?: number;
}): { token: string; expiresAt: Date } {
  const ttl = Math.min(Math.max(1, Math.floor(ttlSeconds)), PREVIEW_MAX_TTL_SECONDS);
  const exp = Math.floor(now / 1000) + ttl;
  const sig = hmacSign("preview", message(entity, id, exp));
  return { token: `${exp}.${sig}`, expiresAt: new Date(exp * 1000) };
}

export type PreviewVerification =
  | { ok: true; expiresAt: Date }
  | { ok: false; reason: "malformed" | "expired" | "invalid" };

/**
 * Verify a token for a specific entity. The caller already knows which row
 * the request is for (it has the slug), so it passes entity + id and gets a
 * yes/no - there is deliberately no "what does this token unlock" API.
 */
export function verifyPreviewToken(
  token: string | null | undefined,
  { entity, id, now = Date.now() }: { entity: PreviewEntity; id: string; now?: number },
): PreviewVerification {
  if (!token || token.length > 256) return { ok: false, reason: "malformed" };
  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };

  const expPart = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d{1,12}$/.test(expPart) || !/^[A-Za-z0-9_-]{20,}$/.test(sig)) {
    return { ok: false, reason: "malformed" };
  }

  const exp = Number(expPart);
  // Signature first: an expired-but-forged token must not learn that its
  // timestamp parsed, so both failures cost the same.
  if (!hmacVerify("preview", message(entity, id, exp), sig)) {
    return { ok: false, reason: "invalid" };
  }
  if (exp * 1000 <= now) return { ok: false, reason: "expired" };
  return { ok: true, expiresAt: new Date(exp * 1000) };
}
