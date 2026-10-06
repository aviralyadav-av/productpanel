import { notFound } from "@/lib/api/errors";
import { privateJson, publicCachedJson } from "@/lib/api/public";
import { verifyPreviewToken, type PreviewEntity } from "@/lib/preview-token";

/**
 * Response glue shared by the `/api/v1` read routes.
 *
 * `publicCachedJson` (lib/api/public.ts) emits `{ data }`; the list contract
 * in §5.1/§14.A10 needs a top-level `meta` beside it. Rather than duplicate
 * the cache/CORS header policy here, the helper borrows the headers from a
 * throwaway `publicCachedJson` so there is still exactly one place that
 * decides what a cacheable public response looks like.
 */

export type CacheOptions = { maxAge?: number; swr?: number };

/** `{ data, meta }` with the public cache policy. */
export function publicCachedPage<T>(data: T, meta: unknown, options: CacheOptions = {}): Response {
  const template = publicCachedJson(null, options);
  return Response.json({ data, meta }, { status: template.status, headers: template.headers });
}

/** `{ data, meta }` with `no-store` (previews and anything per-caller). */
export function privatePage<T>(data: T, meta: unknown, req: Request): Response {
  const template = privateJson(null, { req });
  return Response.json({ data, meta }, { status: template.status, headers: template.headers });
}

/** `?preview=<token>` as the route sees it, or null. */
export function previewTokenOf(searchParams: URLSearchParams): string | null {
  const token = searchParams.get("preview");
  return token && token.trim() ? token.trim() : null;
}

/**
 * E6: a preview request must name an existing row AND carry a valid token
 * for exactly that row. Both failures are a plain 404 so a probe cannot tell
 * "no such draft" from "wrong token".
 */
export function assertPreviewAllowed(
  token: string,
  entity: PreviewEntity,
  id: string | null,
  what: string,
): void {
  if (!id || !verifyPreviewToken(token, { entity, id }).ok) throw notFound(what);
}
