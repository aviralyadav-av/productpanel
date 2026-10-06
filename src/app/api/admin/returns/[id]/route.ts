import { apiOk, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getReturnDetail, getReturnRefundCap, listReturnActivity } from "@/features/returns/queries";

/**
 * GET /api/admin/returns/:id   (returns.view)
 * -> { return, refundCap, activity } — the whole detail screen in one call.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const detail = await getReturnDetail(params.id);
    if (!detail) throw notFound("Return request");

    const [activity, refundCap] = await Promise.all([
      listReturnActivity(detail.id, detail.refund?.id ?? null),
      getReturnRefundCap(detail.id, detail.order.id),
    ]);
    return apiOk({ return: detail, refundCap, activity });
  },
  { permission: "returns.view" },
);
