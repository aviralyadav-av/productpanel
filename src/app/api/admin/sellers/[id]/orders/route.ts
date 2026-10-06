import { apiList, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { listSellerOrders } from "@/features/sellers/detail-queries";

/** GET /api/admin/sellers/:id/orders?page&pageSize&q   orders grouped with the seller's lines and B3 money   (sellers.view) */
export const GET = withAdminApi<{ id: string }>(
  async ({ params, searchParams }) => {
    const result = await listSellerOrders(params.id, parseListQuery(searchParams, { pageSize: 20 }));
    return apiList(result.groups, result.meta);
  },
  { permission: "sellers.view" },
);
