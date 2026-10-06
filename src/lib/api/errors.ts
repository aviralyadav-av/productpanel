import { ZodError } from "zod";

/**
 * The one error vocabulary for both `/api/admin` and `/api/v1` (blueprint
 * §5.1, §14.D10).
 *
 * Services throw `ApiError` (or let Zod/Prisma throw) and never build a
 * Response themselves; the wrappers in admin.ts / public.ts call
 * `toErrorResponse` so every route emits the same envelope:
 * `{ error: { code, message, details? } }`.
 */

export const API_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "CSRF_REJECTED",
  "PASSWORD_CHANGE_REQUIRED",
  "INTERNAL",
  "BAD_REQUEST",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, string>;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: Record<string, string>;
  /** Extra headers for the response, e.g. Retry-After on 429. */
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: Record<string, string>,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

// ---------------------------------------------------------------------------
// Constructors - short names so service code reads like prose
// ---------------------------------------------------------------------------

export function notFound(what = "Resource"): ApiError {
  return new ApiError(404, "NOT_FOUND", `${what} not found.`);
}

export function conflict(message: string, details?: Record<string, string>): ApiError {
  return new ApiError(409, "CONFLICT", message, details);
}

export function badRequest(message: string, details?: Record<string, string>): ApiError {
  return new ApiError(400, "BAD_REQUEST", message, details);
}

export function validationError(
  details: Record<string, string>,
  message = "Please correct the highlighted fields.",
): ApiError {
  return new ApiError(422, "VALIDATION_ERROR", message, details);
}

export function unauthorizedError(message = "Sign in to continue."): ApiError {
  return new ApiError(401, "UNAUTHORIZED", message);
}

export function forbiddenError(message = "You do not have permission to do that."): ApiError {
  return new ApiError(403, "FORBIDDEN", message);
}

export function csrfRejected(): ApiError {
  return new ApiError(403, "CSRF_REJECTED", "Cross-site request rejected.");
}

export function rateLimited(retryAfterSec: number): ApiError {
  return new ApiError(
    429,
    "RATE_LIMITED",
    "Too many requests. Please try again shortly.",
    undefined,
    { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSec))) },
  );
}

export function passwordChangeRequired(): ApiError {
  return new ApiError(
    403,
    "PASSWORD_CHANGE_REQUIRED",
    "You must change your password before continuing.",
  );
}

// ---------------------------------------------------------------------------
// Mapping thrown things onto the envelope
// ---------------------------------------------------------------------------

/** Flatten a Zod error into field → first message, same shape as zodFail(). */
export function zodDetails(error: ZodError): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    if (!details[key]) details[key] = issue.message;
  }
  return details;
}

type PrismaLikeError = { code: string; meta?: { target?: unknown; cause?: unknown } };

/**
 * Prisma's known-request errors are detected by shape rather than instanceof
 * so this file does not have to import the Prisma runtime (the public API
 * bundle and unit tests stay light).
 */
function asPrismaError(error: unknown): PrismaLikeError | null {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    /^P\d{4}$/.test((error as { code: string }).code) &&
    "clientVersion" in error
  ) {
    return error as PrismaLikeError;
  }
  return null;
}

/**
 * Next's `unauthorized()` / `forbidden()` / `notFound()` throw a sentinel
 * whose digest encodes the status. Guards in src/lib/auth use them, so a
 * route that calls `requirePermissionOrThrow` inside a wrapper must have them
 * translated rather than surfaced as a 500.
 */
function nextHttpFallbackStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("digest" in error)) return null;
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest !== "string") return null;
  if (digest === "NEXT_NOT_FOUND") return 404;
  const match = digest.match(/^NEXT_HTTP_ERROR_FALLBACK;(\d{3})$/);
  return match ? Number(match[1]) : null;
}

export function isNextRedirect(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

/**
 * Convert anything thrown by a handler into an `ApiError` so callers only
 * have to render one type. `publicSafe` swaps internal wording for generic
 * text - the storefront must not learn model or column names from us.
 */
export function normalizeError(error: unknown, { publicSafe = false } = {}): ApiError {
  if (isApiError(error)) {
    if (publicSafe && error.status >= 500) {
      return new ApiError(error.status, error.code, "Something went wrong.");
    }
    return error;
  }

  if (error instanceof ZodError) {
    return validationError(zodDetails(error));
  }

  const fallbackStatus = nextHttpFallbackStatus(error);
  if (fallbackStatus === 401) return unauthorizedError();
  if (fallbackStatus === 403) return forbiddenError();
  if (fallbackStatus === 404) return notFound();

  const prisma = asPrismaError(error);
  if (prisma) {
    if (prisma.code === "P2002") {
      const target = Array.isArray(prisma.meta?.target)
        ? (prisma.meta?.target as unknown[]).map(String)
        : [];
      const details: Record<string, string> = {};
      for (const field of target) details[field] = "Already in use.";
      return conflict(
        publicSafe ? "That value is already in use." : "A record with that value already exists.",
        publicSafe || target.length === 0 ? undefined : details,
      );
    }
    if (prisma.code === "P2025") return notFound();
    if (prisma.code === "P2003") {
      return conflict(
        publicSafe
          ? "That change conflicts with existing data."
          : "The record is referenced by other data and cannot be changed this way.",
      );
    }
  }

  console.error("API INTERNAL ERROR", error);
  return new ApiError(500, "INTERNAL", "Something went wrong.");
}

/** Render an error as the JSON envelope. Redirect signals are rethrown. */
export function toErrorResponse(error: unknown, options: { publicSafe?: boolean } = {}): Response {
  if (isNextRedirect(error)) throw error;
  const apiError = normalizeError(error, options);
  return Response.json(apiError.toBody(), {
    status: apiError.status,
    headers: {
      "Cache-Control": "no-store",
      ...(apiError.headers ?? {}),
    },
  });
}
