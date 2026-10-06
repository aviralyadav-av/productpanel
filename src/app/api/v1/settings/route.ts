import { handleOptions, publicCachedJson, withPublicApi } from "@/lib/api/public";
import { getPublicSettingsCached } from "@/features/storefront/cached";

/**
 * GET /api/v1/settings - the `isPublic` settings only, secrets never
 * (blueprint §14.E2, D11), keyed by setting key, plus `*_url` siblings for
 * the media-id keys.
 */
export const GET = withPublicApi(async () => publicCachedJson(await getPublicSettingsCached()), { cached: true });

export const OPTIONS = handleOptions;
