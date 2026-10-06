import { apiCreated, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { recordLedgerAdjustment } from "@/features/finance/ledger-service";
import { adjustmentSchema } from "@/features/finance/ui-schemas";

/**
 * POST /api/admin/payouts/adjustments { sellerId, amountPaise, description }  (payouts.adjust)
 *
 * Appends a signed ADJUSTMENT entry as AVAILABLE and recomputes the seller's
 * balance in the same transaction. The ledger is append-only: this never edits
 * a past sale, it adds a row that the next statement will carry.
 */
export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, adjustmentSchema);
    const result = await recordLedgerAdjustment(input, actor, { ip });
    return apiCreated(result);
  },
  { permission: "payouts.adjust" },
);
