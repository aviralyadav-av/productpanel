import { apiOk, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getPayoutDetail } from "@/features/finance/payout-detail-queries";

/**
 * GET /api/admin/payouts/:id   (payouts.view)
 *
 * The whole statement: totals, the signed ledger sum for the B5 cross-check,
 * the masked bank snapshot (D4 - never the full account number) and every
 * attached entry.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const payout = await getPayoutDetail(params.id);
    if (!payout) throw notFound("Payout");
    return apiOk(payout);
  },
  { permission: "payouts.view" },
);
