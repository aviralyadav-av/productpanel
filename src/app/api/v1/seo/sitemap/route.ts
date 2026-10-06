import { handleOptions, publicCachedJson, withPublicApi } from "@/lib/api/public";
import { getSitemapCached } from "@/features/storefront/cached";

/**
 * GET /api/v1/seo/sitemap - `{ generatedAt, urls:[{ loc, lastmod, changefreq,
 * priority }] }` where `loc` is a storefront PATH; the website prefixes its
 * origin and emits the XML. Longer cache: a sitemap a few minutes stale is
 * harmless and this is the heaviest read in the API.
 */
export const GET = withPublicApi(
  async () => publicCachedJson(await getSitemapCached(), { maxAge: 300, swr: 3600 }),
  { cached: true },
);

export const OPTIONS = handleOptions;
