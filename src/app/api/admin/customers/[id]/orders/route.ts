import { apiList, parseListQuery, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getCustomerDetail, getCustomerOrders } from "@/features/customers/queries";

/** GET /api/admin/customers/:id/orders?page&pageSize   newest first   (customers.view) */
export const GET = withAdminApi<{ id: string }>(
  async ({ params, searchParams }) => {
    if (!(await getCustomerDetail(params.id))) throw notFound("Customer");
    const result = await getCustomerOrders(params.id, parseListQuery(searchParams, { pageSize: 25 }));
    return apiList(result.rows, result.meta);
  },
  { permission: "customers.view" },
);
