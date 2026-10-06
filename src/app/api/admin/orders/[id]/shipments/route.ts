import { notFound } from "@/lib/api/errors";
import { apiCreated, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { getOrderDetail } from "@/features/orders/detail-queries";
import { createShipmentSchema } from "@/features/orders/schemas";
import { createShipment } from "@/features/orders/service";

/**
 * GET  /api/admin/orders/:id/shipments -> { data: { shipments, unshipped } }  (orders.view)
 * POST /api/admin/orders/:id/shipments  body = CreateShipmentInput            (orders.ship)
 *
 * The GET also reports what is still unshipped, because that is the one thing
 * a client needs before it can build a valid POST body.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const order = await getOrderDetail(params.id);
    if (!order) throw notFound("Order");
    return apiOk({
      shipments: order.shipments,
      unshipped: order.items
        .filter((item) => item.unshippedQty > 0)
        .map((item) => ({ orderItemId: item.id, title: item.titleSnapshot, variant: item.variantSnapshot, quantity: item.unshippedQty })),
    });
  },
  { permission: "orders.view" },
);

export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor }) => {
    const input = await parseJsonBody(req, createShipmentSchema);
    const result = await createShipment({ orderId: params.id, actor, values: input });
    return apiCreated(result);
  },
  { permission: "orders.ship" },
);
