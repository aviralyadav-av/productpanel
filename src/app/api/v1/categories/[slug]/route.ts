import { notFound } from "@/lib/api/errors";
import { handleOptions, publicCachedJson, withPublicApi } from "@/lib/api/public";
import { getCategoryPageCached } from "@/features/storefront/cached";

/**
 * GET /api/v1/categories/:slug - category header: the category with SEO,
 * breadcrumb, children with counts and the filter attributes it offers
 * (blueprint §14.A10 "lightweight header endpoint"). Facet VALUES and counts
 * come from /api/v1/products?category=<slug>&include=facets.
 */
export const GET = withPublicApi<{ slug: string }>(
  async ({ params }) => {
    const page = await getCategoryPageCached(params.slug);
    if (!page) throw notFound("Category");
    return publicCachedJson(page);
  },
  { cached: true },
);

export const OPTIONS = handleOptions;
