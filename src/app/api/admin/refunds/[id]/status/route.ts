import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { refundTransitionSchema } from "@/features/refunds/schemas";
import { transitionRefund } from "@/features/refunds/service";

/**
 * PUT /api/admin/refunds/:id/status  body { toStatus, reference?, failureReason?, note? }
 * (refunds.process)
 *
 * PROCESSING on an ORIGINAL gateway refund calls the provider, so this
 * handler can take as long as the gateway does; everything else is a short
 * transaction. Approve and complete are audited (D13).
 */
export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const values = await parseJsonBody(req, refundTransitionSchema);
    const result = await transitionRefund({ refundId: params.id, actor, values, ip });
    return apiOk({
      refundId: result.refundId,
      refundNumber: result.refundNumber,
      fromStatus: result.fromStatus,
      status: result.toStatus,
      providerRefundId: result.providerRefundId,
      gatewayPending: result.gatewayPending,
    });
  },
  { permission: "refunds.process" },
);
