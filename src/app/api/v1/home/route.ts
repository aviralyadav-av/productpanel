import { handleOptions, publicCachedJson, withPublicApi } from "@/lib/api/public";
import { getHomeCached } from "@/features/storefront/cached";

/**
 * GET /api/v1/home - enabled, in-window homepage sections in order, each with
 * server-resolved `items` (blueprint §14.E1). Section types and item shapes
 * are documented in docs/PUBLIC_API.md.
 */
export const GET = withPublicApi(async () => publicCachedJson(await getHomeCached()), { cached: true });

export const OPTIONS = handleOptions;
