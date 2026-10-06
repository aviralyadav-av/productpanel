import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { updateShipmentStatusSchema } from "@/features/orders/schemas";
import { settleStockChanges, updateShipmentStatus } from "@/features/orders/service";

/**
 * PUT /api/admin/orders/:id/shipments/:sid/status
 * body { toStatus, note?, location?, occurredAt? }   (orders.ship)
 *
 * FAILED_DELIVERY is accepted as a target and recorded as an event without
 * changing the shipment status (C2). The order status is re-derived and
 * returned so the caller does not have to fetch the order again.
 */
export const PUT = withAdminApi<{ id: string; sid: string }>(
  async ({ req, params, actor }) => {
    const input = await parseJsonBody(req, updateShipmentStatusSchema);
    const result = await updateShipmentStatus({ orderId: params.id, shipmentId: params.sid, actor, values: input });
    await settleStockChanges(result.stockChanges);
    return apiOk(result);
  },
  { permission: "orders.ship" },
);
