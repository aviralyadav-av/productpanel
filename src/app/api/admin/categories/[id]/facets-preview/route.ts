import { apiOk, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getCategoryFacetPreview } from "@/features/categories/queries";

/**
 * GET /api/admin/categories/:id/facets-preview   (categories.view)
 *
 * The facet payload the storefront will receive for this category subtree,
 * from the same `buildFacets` the public API uses (A2). Money stays in paise
 * here; the public serializer is what converts to rupees.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const payload = await getCategoryFacetPreview(params.id);
    if (!payload) throw notFound("Category");
    return apiOk(payload);
  },
  { permission: "categories.view" },
);
