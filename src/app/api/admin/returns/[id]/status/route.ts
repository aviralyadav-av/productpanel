import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { settleStockChanges } from "@/features/orders/shared";

import { returnTransitionSchema } from "@/features/returns/schemas";
import { transitionReturn } from "@/features/returns/service";

/**
 * PUT /api/admin/returns/:id/status   (returns.manage)
 * body { toStatus, note?, isInternal?, resolution?, rejectionReason?,
 *        pickupPartnerId?, pickupScheduledAt?, pickupTrackingNumber?,
 *        qcNote?, qcDisposition?, amountPaise?, refundMethod?, replacement? }
 *
 * One body for every move: the service rejects a target whose required fields
 * are missing, so the REST client and the dialog obey the same rules.
 */
export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const values = await parseJsonBody(req, returnTransitionSchema);
    const result = await transitionReturn({ returnRequestId: params.id, actor, values, ip });
    await settleStockChanges(result.stockChanges);
    return apiOk({
      returnRequestId: result.returnRequestId,
      rmaNumber: result.rmaNumber,
      fromStatus: result.fromStatus,
      status: result.toStatus,
      refund: result.refund,
      replacementShipmentId: result.replacementShipmentId,
    });
  },
  { permission: "returns.manage" },
);
