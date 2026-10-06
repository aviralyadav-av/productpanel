import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { bulkOrdersSchema } from "@/features/orders/schemas";
import { bulkTransitionOrders, settleStockChanges } from "@/features/orders/service";

/**
 * POST /api/admin/orders/bulk   body { ids: string[], op: CONFIRM|PROCESSING|PACKED }
 * (orders.update)
 *
 * One transaction, a summary result: orders that cannot make the move come
 * back in `skipped` with the reason rather than failing the whole batch, and
 * the id count is audited (D13).
 */
export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, bulkOrdersSchema);
    const result = await bulkTransitionOrders(input, actor, { ip });
    await settleStockChanges(result.stockChanges);
    return apiOk({ op: result.op, requested: result.requested, affected: result.affected, skipped: result.skipped });
  },
  { permission: "orders.update" },
);
