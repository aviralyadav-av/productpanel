import type { NextRequest } from "next/server";
import type { z } from "zod";

import { getActor, can, type Actor } from "@/lib/auth/guards";
import { clientIp } from "@/lib/client-ip";
import { env } from "@/lib/env";
import {
  ApiError,
  badRequest,
  csrfRejected,
  forbiddenError,
  rateLimited,
  toErrorResponse,
  unauthorizedError,
  validationError,
  zodDetails,
} from "@/lib/api/errors";
import {
  buildPageMeta,
  many,
  one,
  parseListParams,
  type ListParams,
  type PageMeta,
  type SearchParams,
} from "@/lib/list-params";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";

/**
 * Route Handler plumbing for `/api/admin/**` (blueprint §5.1, §14.D8, D9, D10).
 *
 * A route file should be ~15 lines: parse, call a service, return an envelope.
 * Everything cross-cutting - session, permission, CSRF, rate limit, error
 * mapping - lives here so it cannot be forgotten in one of a hundred routes.
 *
 * Usage:
 *   export const GET = withAdminApi(
 *     async ({ searchParams }) => apiOk(await listProducts(parseListQuery(searchParams))),
 *     { permission: "products.view" },
 *   );
 *   export const PUT = withAdminApi<{ id: string }>(
 *     async ({ req, params, actor }) => { ... },
 *     { permission: "products.edit" },
 *   );
 */

export type RouteParams = Record<string, string | string[] | undefined>;

export type AdminApiContext<P extends RouteParams = RouteParams> = {
  req: NextRequest;
  actor: Actor;
  params: P;
  searchParams: URLSearchParams;
  ip: string;
};

export type AdminApiOptions = {
  /** Permission code (or any-of list). Omit for "any signed-in admin". */
  permission?: string | readonly string[];
  rateLimit?: {
    limit: number;
    windowMs: number;
    /** Bucket per signed-in actor (default) or per client IP. */
    keyBy?: "ip" | "actor";
  };
  /**
   * Let a session that still owes a 2FA code through. Only the two-factor
   * verification endpoint itself should set this (D2).
   */
  allowPendingMfa?: boolean;
};

export type AdminApiHandler<P extends RouteParams = RouteParams> = (
  ctx: AdminApiContext<P>,
) => Promise<Response>;

type NextRouteHandler<P extends RouteParams> = (
  req: NextRequest,
  ctx: { params: Promise<P> },
) => Promise<Response>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * D8: a browser attaches the session cookie to cross-site requests, so a
 * malicious page could POST to us. Same-origin is proven by either signal;
 * a request with neither is refused. Non-browser clients (scripts, curl)
 * must send an Origin header equal to APP_ORIGIN.
 */
export function assertSameOrigin(req: Request): void {
  if (SAFE_METHODS.has(req.method)) return;

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin" || fetchSite === "none") return;

  const origin = req.headers.get("origin");
  if (origin && origin === env.APP_ORIGIN) return;

  throw csrfRejected();
}

/**
 * Only body types our handlers know how to parse. A `text/plain` POST is the
 * classic way to slip past CORS preflight, so it is rejected up front.
 */
export function assertJsonOrMultipart(req: Request): void {
  if (SAFE_METHODS.has(req.method)) return;

  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.startsWith("application/json") || contentType.startsWith("multipart/form-data")) {
    return;
  }

  const contentLength = req.headers.get("content-length");
  const hasBody = (contentLength !== null && contentLength !== "0") || req.headers.has("transfer-encoding");
  if (!contentType && !hasBody) return; // bodiless POST, e.g. "/:id/publish"

  throw badRequest("Send application/json or multipart/form-data.");
}

export function withAdminApi<P extends RouteParams = RouteParams>(
  handler: AdminApiHandler<P>,
  options: AdminApiOptions = {},
): NextRouteHandler<P> {
  return async (req, ctx) => {
    try {
      assertSameOrigin(req);
      assertJsonOrMultipart(req);

      const actor = await getActor();
      if (!actor) throw unauthorizedError();
      if (actor.pendingMfa && !options.allowPendingMfa) {
        throw unauthorizedError("Complete two-factor verification to continue.");
      }
      if (!actor.roleSlug) throw forbiddenError("Your account has no role assigned.");
      if (options.permission && !can(actor, options.permission)) throw forbiddenError();

      const ip = clientIp(req.headers);

      if (options.rateLimit) {
        const url = new URL(req.url);
        const subject = options.rateLimit.keyBy === "ip" ? ip : actor.id;
        const result = await rateLimit(
          rateLimitKey("admin", req.method, url.pathname, subject),
          options.rateLimit,
        );
        if (!result.ok) throw rateLimited(result.retryAfterSec);
      }

      const params = ((await ctx?.params) ?? {}) as P;
      const searchParams = new URL(req.url).searchParams;

      return await handler({ req, actor, params, searchParams, ip });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

// ---------------------------------------------------------------------------
// Envelope helpers (§5.1)
// ---------------------------------------------------------------------------

const NO_STORE = { "Cache-Control": "no-store" } as const;

function withDefaultHeaders(init?: ResponseInit): ResponseInit {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(NO_STORE)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return { ...init, headers };
}

export function apiOk<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ data }, withDefaultHeaders(init));
}

export function apiCreated<T>(data: T): Response {
  return apiOk(data, { status: 201 });
}

export function apiNoContent(): Response {
  return new Response(null, { status: 204, headers: NO_STORE });
}

export function apiList<T>(rows: readonly T[], meta: PageMeta): Response {
  return Response.json({ data: rows, meta }, withDefaultHeaders());
}

/** Build and send an error envelope directly (rare - prefer throwing). */
export function apiError(
  status: number,
  code: ApiError["code"],
  message: string,
  details?: Record<string, string>,
): Response {
  return toErrorResponse(new ApiError(status, code, message, details));
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

/**
 * JSON body → Zod-parsed value. Malformed JSON is a 400 (the client is
 * broken); a well-formed body that fails the schema is a 422 with per-field
 * details the form can show inline.
 */
export async function parseJsonBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw validationError(zodDetails(parsed.error));
  return parsed.data;
}

/** Same for multipart / urlencoded forms; files stay as File instances. */
export async function parseFormBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<z.output<S>> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Request body must be multipart/form-data.");
  }
  const raw: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (key in raw) {
      const existing = raw[key];
      raw[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      raw[key] = value;
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw validationError(zodDetails(parsed.error));
  return parsed.data;
}

export type ListQuery = ListParams & {
  /** First value of a module filter, e.g. filter("status"). */
  filter(key: string): string | undefined;
  /** Every value of a repeated filter, e.g. filterAll("categoryId"). */
  filterAll(key: string): string[];
  raw: SearchParams;
};

/**
 * `?page&pageSize&sort&order&q` plus module filters (§5.1). An unknown sort
 * falls back to the default rather than erroring: a stale bookmark should
 * still show the list, just in default order.
 */
export function parseListQuery(
  searchParams: URLSearchParams,
  options: {
    defaultSort?: string;
    defaultOrder?: "asc" | "desc";
    allowedSorts?: readonly string[];
    pageSize?: number;
  } = {},
): ListQuery {
  const raw: SearchParams = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    raw[key] = values.length > 1 ? values : values[0];
  }

  const params = parseListParams(raw, options);
  if (options.allowedSorts && !options.allowedSorts.includes(params.sort)) {
    params.sort = options.defaultSort ?? options.allowedSorts[0] ?? "createdAt";
  }

  return {
    ...params,
    filter: (key) => one(raw, key),
    filterAll: (key) => many(raw, key),
    raw,
  };
}

export { buildPageMeta };
