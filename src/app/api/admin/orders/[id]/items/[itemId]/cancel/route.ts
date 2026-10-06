import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { cancelOrderItemSchema } from "@/features/orders/schemas";
import { cancelOrderItem, settleStockChanges } from "@/features/orders/service";

/**
 * POST /api/admin/orders/:id/items/:itemId/cancel  body { quantity, reason }
 * (orders.cancel)
 *
 * Before the line ships only (C2): units are released or restocked, the money
 * columns split with the line, and cancelling the last active line cancels
 * the order.
 */
export const POST = withAdminApi<{ id: string; itemId: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, cancelOrderItemSchema);
    const result = await cancelOrderItem({
      orderId: params.id,
      orderItemId: params.itemId,
      quantity: input.quantity,
      reason: input.reason,
      actor,
      ip,
    });
    await settleStockChanges(result.stockChanges);
    return apiOk(result);
  },
  { permission: "orders.cancel" },
);
