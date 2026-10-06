import { apiCreated, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { recordManualPaymentSchema } from "@/features/orders/schemas";
import { recordManualPayment } from "@/features/orders/service";

/**
 * POST /api/admin/orders/:id/payments  body { amountPaise, method, reference?, note? }
 * (payments.manage)
 *
 * Only cash / bank / UPI received outside a gateway. Gateway results are
 * settled exclusively by `settlePaymentEvent` from the webhook and verify
 * routes, so there is no way to fake a card payment through the admin.
 */
export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, recordManualPaymentSchema);
    const result = await recordManualPayment({ orderId: params.id, actor, values: input, ip });
    return apiCreated(result);
  },
  { permission: "payments.manage" },
);
