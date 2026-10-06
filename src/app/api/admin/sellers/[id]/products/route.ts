import { apiList, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { listSellerProducts } from "@/features/sellers/detail-queries";

/** GET /api/admin/sellers/:id/products?page&pageSize&q   (sellers.view) */
export const GET = withAdminApi<{ id: string }>(
  async ({ params, searchParams }) => {
    const result = await listSellerProducts(params.id, parseListQuery(searchParams, { pageSize: 20 }));
    return apiList(result.rows, result.meta);
  },
  { permission: "sellers.view" },
);
