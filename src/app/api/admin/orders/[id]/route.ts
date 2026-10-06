import { notFound } from "@/lib/api/errors";
import { apiOk, withAdminApi } from "@/lib/api/admin";

import { getOrderDetail } from "@/features/orders/detail-queries";

/**
 * GET /api/admin/orders/:id -> { data: OrderDetail }   (orders.view)
 *
 * The same payload the detail page renders: lines with their customisation
 * snapshot, payments, shipments and events, the seller split and the money.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const order = await getOrderDetail(params.id);
    if (!order) throw notFound("Order");
    return apiOk(order);
  },
  { permission: "orders.view" },
);
