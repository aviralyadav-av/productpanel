import { parseListQuery, withAdminApi } from "@/lib/api/admin";
import { parseExportFormat } from "@/lib/export";

import { exportOrders } from "@/features/orders/export";
import { ORDER_SORTS, parseOrderListFilters } from "@/features/orders/schemas";

/**
 * GET /api/admin/orders/export?format=csv|xlsx&<the list filters>   (orders.export)
 *
 * Streams the rows the list would show, page by page (§11.28), and audits the
 * filter and the row count - an order export carries customer names, emails
 * and addresses, so "who downloaded what" must stay answerable (D13).
 */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip }) => {
    const query = parseListQuery(searchParams, { defaultSort: "placed", defaultOrder: "desc", allowedSorts: ORDER_SORTS });
    return exportOrders({
      format: parseExportFormat(searchParams.get("format")),
      filters: parseOrderListFilters(searchParams),
      q: query.q,
      actor,
      ip,
    });
  },
  { permission: "orders.export", rateLimit: { limit: 10, windowMs: 60_000 } },
);
