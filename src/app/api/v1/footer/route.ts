import { handleOptions, publicCachedJson, withPublicApi } from "@/lib/api/public";
import { getFooterCached } from "@/features/storefront/cached";

/**
 * GET /api/v1/footer - FooterConfig + the footer-1..3 menus + public
 * `social.*` links in one call (blueprint §14.E1).
 */
export const GET = withPublicApi(async () => publicCachedJson(await getFooterCached()), { cached: true });

export const OPTIONS = handleOptions;
