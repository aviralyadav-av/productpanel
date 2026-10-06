import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { settleStockChanges } from "@/features/orders/shared";

import { bulkReturnsSchema } from "@/features/returns/schemas";
import { bulkReturns } from "@/features/returns/service";

/**
 * POST /api/admin/returns/bulk  body { ids, op: REVIEW|APPROVE|REJECT|CLOSE, reason? }
 * (returns.manage) — ≤500 ids, one transaction, one audit row (§11.33, D13).
 * Rows that cannot make the move come back in `skipped` rather than failing
 * the batch.
 */
export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const values = await parseJsonBody(req, bulkReturnsSchema);
    const result = await bulkReturns({ values, actor, ip });
    await settleStockChanges(result.stockChanges);
    return apiOk({ op: result.op, requested: result.requested, affected: result.affected, skipped: result.skipped });
  },
  { permission: "returns.manage" },
);
