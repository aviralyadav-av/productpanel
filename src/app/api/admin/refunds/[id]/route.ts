import { apiOk, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getRefundDetail, listRefundActivity } from "@/features/refunds/queries";

/** GET /api/admin/refunds/:id   (refunds.view) -> { refund, activity } */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const refund = await getRefundDetail(params.id);
    if (!refund) throw notFound("Refund");
    const activity = await listRefundActivity(refund.id);
    return apiOk({ refund, activity });
  },
  { permission: "refunds.view" },
);
