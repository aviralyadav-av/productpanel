import { env } from "@/lib/env";

/**
 * Best-effort client IP for rate limiting and audit (blueprint §14.D9).
 *
 * `X-Forwarded-For` is appended to by every proxy in the chain, so the LEFT
 * side is whatever the client chose to send and the RIGHT side is what the
 * proxies we control observed. With TRUSTED_PROXY_HOPS=N we take the Nth
 * address from the right - the one written by the outermost proxy we trust.
 * With 0 hops (local dev, or a host that terminates TLS in-process) the header
 * is ignored entirely because a client can forge it and dodge every limit.
 */
export function clientIp(headers: Headers): string {
  const hops = env.TRUSTED_PROXY_HOPS;

  if (hops > 0) {
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const chain = forwarded
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const candidate = chain[chain.length - hops];
      if (candidate && isPlausibleIp(candidate)) return normalizeIp(candidate);
    }

    // Many single-proxy setups (nginx, Caddy) set this instead of, or as well
    // as, X-Forwarded-For. Only trusted when we trust at least one hop.
    const real = headers.get("x-real-ip")?.trim();
    if (real && isPlausibleIp(real)) return normalizeIp(real);
  }

  return "unknown";
}

/** Reject header garbage so it cannot pollute audit rows or bucket keys. */
function isPlausibleIp(value: string): boolean {
  return value.length <= 64 && /^[0-9a-fA-F.:\[\]]+$/.test(value);
}

/** Strip a port and IPv6 brackets ("[::1]:443" → "::1"). */
function normalizeIp(value: string): string {
  const bracketed = value.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1];
  const v4WithPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (v4WithPort) return v4WithPort[1];
  return value;
}
