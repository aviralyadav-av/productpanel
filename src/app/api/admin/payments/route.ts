import { parseListQuery, withAdminApi } from "@/lib/api/admin";

import { listPayments, paymentKpis } from "@/features/payments/queries";
import { PAYMENT_SORTS, parsePaymentFilters, resolvePaymentSort } from "@/features/payments/schemas";

/**
 * GET /api/admin/payments?page&pageSize&sort&order&q&provider&method&type&status
 *     &order=<orderId>&customer=<id>&range|from&to      (payments.view)
 *     -> { data: PaymentListRow[], meta, kpis }
 *
 * Read-only: OrderPayment rows are written by the checkout, the webhooks, the
 * manual-payment action on an order and the refunds service.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "created", defaultOrder: "desc", allowedSorts: PAYMENT_SORTS });
    const filters = parsePaymentFilters(searchParams);
    const sort = resolvePaymentSort(query.sort);

    const [list, kpis] = await Promise.all([listPayments({ ...query, sort }, filters), paymentKpis()]);
    return Response.json({ data: list.rows, meta: list.meta, kpis }, { headers: { "Cache-Control": "no-store" } });
  },
  { permission: "payments.view" },
);
