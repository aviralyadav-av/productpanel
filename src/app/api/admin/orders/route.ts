import { apiCreated, parseListQuery, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { listOrders, orderKpis, orderStatusCounts } from "@/features/orders/queries";
import { ORDER_SORTS, manualOrderSchema, parseOrderListFilters, resolveOrderSort } from "@/features/orders/schemas";
import { createManualOrder } from "@/features/orders/service";
import { settleStockChanges } from "@/features/orders/shared";

/**
 * GET  /api/admin/orders?page&pageSize&sort&order&q&status&payment&method&source&seller&customer
 *      &range|from&to&minTotal&maxTotal&returns&custom   (orders.view)
 *      -> { data: OrderListRow[], meta, counts, kpis }
 * POST /api/admin/orders  body = ManualOrderInput        (orders.create) -> 201
 *
 * The list handler is the same three queries the page runs, so an integration
 * that drives the admin over REST sees exactly the screen an operator sees -
 * including the tab counts, which honour every filter except the status tab.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "placed", defaultOrder: "desc", allowedSorts: ORDER_SORTS });
    const filters = parseOrderListFilters(searchParams);
    const sort = resolveOrderSort(query.sort);

    const [list, counts, kpis] = await Promise.all([
      listOrders({ ...query, sort }, filters),
      orderStatusCounts(filters, query.q),
      orderKpis(),
    ]);

    return Response.json({ data: list.rows, meta: list.meta, counts, kpis }, { headers: { "Cache-Control": "no-store" } });
  },
  { permission: "orders.view" },
);

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, manualOrderSchema);
    const result = await createManualOrder(actor, input, { ip });
    await settleStockChanges(result.stockChanges);
    return apiCreated({
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      status: result.status,
      totalPaise: result.totalPaise,
      paymentMethod: result.paymentMethod,
      payment: result.payment,
      paymentError: result.paymentError,
    });
  },
  { permission: "orders.create" },
);
