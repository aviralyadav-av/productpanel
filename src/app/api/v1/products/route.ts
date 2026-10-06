import { handleOptions, withPublicApi } from "@/lib/api/public";
import { listProductsCached } from "@/features/storefront/cached";
import { parseProductListQuery } from "@/features/storefront/queries/products";
import { publicCachedPage } from "@/features/storefront/respond";

/**
 * GET /api/v1/products - the storefront listing (blueprint §14.A10, the fixed
 * contract). Query params: category, q, attr[<code>]=v1,v2 |
 * attr[<code>]=min..max, minPrice, maxPrice (rupees), seller, featured,
 * newArrival, bestseller, trending, customizable, sort, page, pageSize (≤48),
 * include=category,facets. Response `{ data: PublicProduct[], meta }`.
 *
 * The parsed query is normalised before it reaches the cache so that
 * `?attr[color]=red,blue` and `?attr[color]=blue,red` share one entry.
 */
export const GET = withPublicApi(
  async ({ searchParams }) => {
    const result = await listProductsCached(parseProductListQuery(searchParams));
    return publicCachedPage(result.data, result.meta);
  },
  { cached: true },
);

export const OPTIONS = handleOptions;
