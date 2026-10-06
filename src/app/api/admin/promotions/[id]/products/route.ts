import { notFound } from "@/lib/api/errors";
import { apiList, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { listAffectedProducts } from "@/features/promotions/queries";

/** GET /api/admin/promotions/:id/products?page&pageSize&q -> { data: AffectedProductRow[], meta } (promotions.view) */
export const GET = withAdminApi<{ id: string }>(
  async ({ params, searchParams }) => {
    const result = await listAffectedProducts(params.id, parseListQuery(searchParams, { pageSize: 25 }));
    if (!result) throw notFound("Promotion");
    return apiList(result.rows, result.meta);
  },
  { permission: "promotions.view" },
);
