import { handleOptions, publicCachedJson, withPublicApi } from "@/lib/api/public";
import { getCategoryTreeCached } from "@/features/storefront/cached";

/**
 * GET /api/v1/categories - the full active category tree with rolled-up
 * product counts (blueprint §5.3, §14.A9). Anonymous and identical for every
 * caller, so it is served from the tagged server cache with the public CDN
 * policy. See docs/PUBLIC_API.md.
 */
export const GET = withPublicApi(async () => publicCachedJson(await getCategoryTreeCached()), { cached: true });

export const OPTIONS = handleOptions;
