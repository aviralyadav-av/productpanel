import { apiCreated, parseJsonBody, parseListQuery, withAdminApi } from "@/lib/api/admin";
import { requirePermissionOrThrow } from "@/lib/auth/guards";

import { listRefunds, refundKpis, refundStatusCounts } from "@/features/refunds/queries";
import { REFUND_SORTS, createRefundSchema, parseRefundFilters, resolveRefundSort } from "@/features/refunds/schemas";
import { createRefund } from "@/features/refunds/service";

/**
 * GET  /api/admin/refunds?…            (refunds.view)    -> { data, meta, counts, kpis }
 * POST /api/admin/refunds              (refunds.process) -> 201 { refund }
 *
 * POST body { orderId, amountPaise, method, reason, notes?, returnRequestId? }.
 * The cap is enforced inside the transaction (B6), never here.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "created", defaultOrder: "desc", allowedSorts: REFUND_SORTS });
    const filters = parseRefundFilters(searchParams);
    const sort = resolveRefundSort(query.sort);

    const [list, counts, kpis] = await Promise.all([
      listRefunds({ ...query, sort }, filters),
      refundStatusCounts(filters, query.q),
      refundKpis(),
    ]);
    return Response.json({ data: list.rows, meta: list.meta, counts, kpis }, { headers: { "Cache-Control": "no-store" } });
  },
  { permission: "refunds.view" },
);

export const POST = withAdminApi(async ({ req, ip }) => {
  const actor = await requirePermissionOrThrow("refunds.process");
  const values = await parseJsonBody(req, createRefundSchema);
  const refund = await createRefund({ values, actor, ip });
  return apiCreated(refund);
});
