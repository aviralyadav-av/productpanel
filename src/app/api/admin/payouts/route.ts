import { apiCreated, apiList, apiOk, parseJsonBody, parseListQuery, withAdminApi } from "@/lib/api/admin";
import { resolveDateRangeParams } from "@/components/shared/date-range";

import { listPayouts, payoutKpis, payoutStatusCounts } from "@/features/finance/payout-queries";
import { generateStatement } from "@/features/finance/payout-service";
import {
  PAYOUT_SORTS,
  generatePayoutSchema,
  parsePayoutFilters,
  parsePayoutSort,
} from "@/features/finance/ui-schemas";

/**
 * GET  /api/admin/payouts?page&pageSize&sort&order&q&status&seller&range|from&to  (payouts.view)
 *      `{ data: PayoutListRow[], meta }` with `X-Status-Counts` and `X-Kpis`.
 * POST /api/admin/payouts { sellerId, periodTo?, method?, bankAccountId?, notes? }  (payouts.approve)
 *      Generates a statement. 200 `{ held: true, ... }` when the net is at or
 *      below `marketplace.min_payout_paise` (nothing is written and the
 *      earnings carry forward); 201 with the statement otherwise; 409 when the
 *      seller already has an open statement.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, {
      defaultSort: "createdAt",
      defaultOrder: "desc",
      allowedSorts: PAYOUT_SORTS,
    });
    const filters = parsePayoutFilters(query.raw);
    const range =
      query.raw.range || query.raw.from || query.raw.to
        ? resolveDateRangeParams(query.raw, "30d")
        : undefined;

    const [result, counts, kpis] = await Promise.all([
      listPayouts({ ...query, sort: parsePayoutSort(query.sort) }, filters, range),
      payoutStatusCounts(filters, range),
      payoutKpis(),
    ]);

    const response = apiList(result.rows, result.meta);
    response.headers.set("X-Status-Counts", JSON.stringify(counts));
    response.headers.set("X-Kpis", JSON.stringify(kpis));
    return response;
  },
  { permission: "payouts.view" },
);

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, generatePayoutSchema);
    const result = await generateStatement(input, actor, { ip });
    // "Held" is a real, successful outcome, not a failure - but no resource was
    // created, so it must not answer 201.
    return result.held ? apiOk(result) : apiCreated(result);
  },
  { permission: "payouts.approve" },
);
