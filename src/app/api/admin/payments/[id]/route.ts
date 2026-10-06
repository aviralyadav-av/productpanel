import { apiOk, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";
import { can } from "@/lib/auth/guards";

import { getPaymentDetail } from "@/features/payments/queries";

/**
 * GET /api/admin/payments/:id   (payments.view)
 *
 * `rawPayload` is only included for an actor with payments.manage (D4/D11):
 * a gateway payload can carry card metadata and signatures.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params, actor }) => {
    const payment = await getPaymentDetail(params.id, { includeRaw: can(actor, "payments.manage") });
    if (!payment) throw notFound("Payment");
    return apiOk({ payment });
  },
  { permission: "payments.view" },
);
