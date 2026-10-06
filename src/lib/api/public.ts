import type { NextRequest } from "next/server";

import { clientIp } from "@/lib/client-ip";
import { constantTimeEqual } from "@/lib/crypto";
import { env, normalizeOrigin } from "@/lib/env";
import {
  ApiError,
  rateLimited,
  toErrorResponse,
  unauthorizedError,
} from "@/lib/api/errors";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";
import type { RouteParams } from "@/lib/api/admin";

/**
 * Response helpers for `/api/v1/**`, the API the customer website consumes
 * (blueprint §5.1, §14.D7, D9, E7).
 *
 * Two response classes and nothing in between:
 *  - `publicCachedJson`: anonymous, identical for everyone, CDN-cacheable,
 *    CORS `*`. Categories, products, home, pages…
 *  - `privateJson`: anything carrying a token, an email, or the result of a
 *    POST. `no-store`, `Vary: Authorization`, CORS only for allowlisted
 *    storefront origins.
 * Every error is private. `withPublicApi` enforces the default so a handler
 * that forgets still ships `no-store`.
 */

export const PUBLIC_ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
export const PUBLIC_ALLOWED_HEADERS = "Content-Type, Authorization, X-Storefront-Key";

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

/**
 * Echo the request Origin when it is in STOREFRONT_ORIGINS. Anything else
 * gets no CORS headers at all, which the browser treats as a denial. A
 * missing Origin (server-to-server, curl) needs no CORS headers either.
 */
export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  const normalized = normalizeOrigin(origin);
  if (!normalized || !env.STOREFRONT_ORIGINS.includes(normalized)) return {};
  return {
    "Access-Control-Allow-Origin": normalized,
    "Access-Control-Allow-Methods": PUBLIC_ALLOWED_METHODS,
    "Access-Control-Allow-Headers": PUBLIC_ALLOWED_HEADERS,
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/** Add allowlisted CORS to a response that does not already carry CORS. */
export function applyCors(req: Request, response: Response): Response {
  if (response.headers.has("Access-Control-Allow-Origin")) return response;
  const cors = corsHeadersFor(req);
  if (Object.keys(cors).length === 0) return response;

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) {
    if (key === "Vary") {
      const existing = headers.get("Vary");
      headers.set("Vary", existing ? mergeVary(existing, value) : value);
    } else {
      headers.set(key, value);
    }
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function mergeVary(existing: string, extra: string): string {
  const parts = new Set(
    [...existing.split(","), ...extra.split(",")].map((part) => part.trim()).filter(Boolean),
  );
  return [...parts].join(", ");
}

/** Preflight. Export as `OPTIONS` from every /api/v1 route file. */
export function handleOptions(req: Request): Response {
  const cors = corsHeadersFor(req);
  return new Response(null, {
    status: 204,
    headers: { ...cors, "Cache-Control": "no-store", Allow: PUBLIC_ALLOWED_METHODS },
  });
}

// ---------------------------------------------------------------------------
// Response classes (D7)
// ---------------------------------------------------------------------------

/**
 * Anonymous, cacheable JSON. `*` is safe here precisely because the body is
 * the same for every caller - there is nothing origin-specific to protect.
 * `s-maxage` drives the CDN; browsers get the shorter `max-age`.
 */
export function publicCachedJson<T>(
  data: T,
  { maxAge = 30, swr = 300, status = 200 }: { maxAge?: number; swr?: number; status?: number } = {},
): Response {
  return Response.json(
    { data },
    {
      status,
      headers: {
        "Cache-Control": `public, max-age=${Math.min(maxAge, 60)}, s-maxage=${maxAge}, stale-while-revalidate=${swr}`,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": PUBLIC_ALLOWED_HEADERS,
        Vary: "Origin, Accept-Encoding",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

/** Per-caller JSON: no caching anywhere, CORS only for allowlisted origins. */
export function privateJson<T>(data: T, init: ResponseInit & { req?: Request } = {}): Response {
  const { req, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Vary", mergeVary(headers.get("Vary") ?? "", "Authorization, Origin"));
  headers.set("X-Content-Type-Options", "nosniff");
  if (req) {
    for (const [key, value] of Object.entries(corsHeadersFor(req))) {
      if (key !== "Vary") headers.set(key, value);
    }
  }
  return Response.json({ data }, { ...rest, headers });
}

export function publicCreated<T>(data: T, req?: Request): Response {
  return privateJson(data, { status: 201, req });
}

export function publicNoContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

/** `{ error: { code, message } }`, never cached. */
export function publicError(
  status: number,
  code: ApiError["code"],
  message: string,
  details?: Record<string, string>,
): Response {
  return toErrorResponse(new ApiError(status, code, message, details), { publicSafe: true });
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

export type PublicApiContext<P extends RouteParams = RouteParams> = {
  req: NextRequest;
  params: P;
  searchParams: URLSearchParams;
  ip: string;
};

export type PublicApiOptions = {
  /** Per-IP fixed window; the bucket is scoped to method + path. */
  rateLimit?: { limit: number; windowMs: number };
  /**
   * true: a response without Cache-Control gets the public cache policy.
   * false (default): it gets `no-store`. Errors are always `no-store`.
   */
  cached?: boolean;
};

export type PublicApiHandler<P extends RouteParams = RouteParams> = (
  ctx: PublicApiContext<P>,
) => Promise<Response>;

/**
 * Wrap a /api/v1 handler: preflight, per-IP rate limit, public-safe error
 * envelope, allowlisted CORS and a cache-policy default on every response.
 */
export function withPublicApi<P extends RouteParams = RouteParams>(
  handler: PublicApiHandler<P>,
  options: PublicApiOptions = {},
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response> {
  return async (req, ctx) => {
    if (req.method === "OPTIONS") return handleOptions(req);

    const ip = clientIp(req.headers);
    let response: Response;
    try {
      if (options.rateLimit) {
        const url = new URL(req.url);
        const result = await rateLimit(
          rateLimitKey("public", req.method, url.pathname, ip),
          options.rateLimit,
        );
        if (!result.ok) throw rateLimited(result.retryAfterSec);
      }

      const params = ((await ctx?.params) ?? {}) as P;
      response = await handler({ req, params, searchParams: new URL(req.url).searchParams, ip });
    } catch (error) {
      response = toErrorResponse(error, { publicSafe: true });
    }

    if (!response.headers.has("Cache-Control")) {
      response = withHeader(
        response,
        "Cache-Control",
        options.cached && req.method === "GET" && response.ok
          ? "public, max-age=30, s-maxage=30, stale-while-revalidate=300"
          : "no-store",
      );
    }
    return applyCors(req, response);
  };
}

function withHeader(response: Response, key: string, value: string): Response {
  const headers = new Headers(response.headers);
  headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ---------------------------------------------------------------------------
// Storefront integration key (E7)
// ---------------------------------------------------------------------------

/**
 * `X-Storefront-Key` must equal STOREFRONT_API_KEY. Compared in constant time
 * so response timing leaks nothing about how many leading bytes matched. An
 * unset key is a deployment error, reported as 503 rather than as a 401 that
 * would send the website's developers hunting for a typo on their side.
 */
export function requireStorefrontKey(req: Request): void {
  const expected = env.STOREFRONT_API_KEY;
  if (!expected || expected.length < 16) {
    throw new ApiError(503, "INTERNAL", "Storefront integration is not configured.");
  }
  const provided = req.headers.get("x-storefront-key") ?? "";
  if (!provided || !constantTimeEqual(provided, expected)) {
    throw unauthorizedError("Invalid storefront key.");
  }
}

/** Bearer token from `Authorization`, or null. Callers resolve the session. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}
