import { NextResponse } from "next/server";

/**
 * Shared plumbing for the PUBLIC storefront API.
 *
 * These routes are unauthenticated by design - they are what the Vite
 * storefront will fetch after cutover, and proxy.ts exempts /api/v1 from the
 * session check for exactly that reason.
 *
 * Abuse protection is the CDN cache plus platform-level firewall rules, not a
 * per-request counter: every response here is public, identical for all
 * callers, and cacheable, so the origin is only hit once per revalidation
 * window no matter how much traffic arrives.
 */

const CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";

export function publicJson(data: unknown, init?: { status?: number }) {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: {
      "Cache-Control": CACHE_CONTROL,
      // The storefront runs on a different origin. Reads carry no credentials
      // and expose only already-public catalogue data.
      "Access-Control-Allow-Origin": process.env.STOREFRONT_ORIGIN ?? "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Vary": "Origin",
    },
  });
}

export function publicError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export function notFoundJson(what: string) {
  return publicError(`${what} not found`, 404);
}
