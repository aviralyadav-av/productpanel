import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { requirePermissionOrThrow } from "@/lib/auth/guards";

import { transitionOrderSchema } from "@/features/orders/schemas";
import { settleStockChanges, transitionOrder } from "@/features/orders/service";

/**
 * PUT /api/admin/orders/:id/status  body { toStatus, reason?, note? }
 *
 * Cancelling is a scarcer right than moving an order along, so the permission
 * is chosen from the target (orders.cancel vs orders.update) - the same rule
 * the Server Action applies. The state machine itself lives in the service.
 */
export const PUT = withAdminApi<{ id: string }>(async ({ req, params, ip }) => {
  const input = await parseJsonBody(req, transitionOrderSchema);
  const cancelling = input.toStatus === "CANCELLED" || input.toStatus === "FAILED";
  const actor = await requirePermissionOrThrow(cancelling ? "orders.cancel" : "orders.update");

  const result = await transitionOrder({
    orderId: params.id,
    toStatus: input.toStatus,
    actor,
    reason: input.reason,
    note: input.note,
    ip,
  });
  await settleStockChanges(result.stockChanges);
  return apiOk({
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    fromStatus: result.fromStatus,
    status: result.toStatus,
    refund: result.refund,
  });
});
