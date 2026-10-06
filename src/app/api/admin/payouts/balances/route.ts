import { apiList, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { listSellerBalances, payoutKpis } from "@/features/finance/payout-queries";
import { BALANCE_SORTS, parseBalanceFilters, parseBalanceSort } from "@/features/finance/ui-schemas";

/**
 * GET /api/admin/payouts/balances?page&pageSize&sort&order&q&seller&owed=0|1  (payouts.view)
 *
 * The `SellerBalance` projection - what the next statement would pick up.
 * `owed` defaults to 1 (only sellers with money in flight); pass `owed=0` to
 * include zero balances. KPIs ride along in `X-Kpis`.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, {
      defaultSort: "available",
      defaultOrder: "desc",
      allowedSorts: BALANCE_SORTS,
    });
    const filters = parseBalanceFilters(query.raw);
    const [result, kpis] = await Promise.all([
      listSellerBalances({ ...query, sort: parseBalanceSort(query.sort) }, filters),
      payoutKpis(),
    ]);

    const response = apiList(result.rows, result.meta);
    response.headers.set("X-Kpis", JSON.stringify({ ...kpis, minPayoutPaise: result.minPayoutPaise }));
    return response;
  },
  { permission: "payouts.view" },
);
