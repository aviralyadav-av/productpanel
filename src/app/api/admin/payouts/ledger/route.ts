import { apiList, parseListQuery, withAdminApi } from "@/lib/api/admin";
import { resolveDateRangeParams } from "@/components/shared/date-range";

import { listLedgerEntries } from "@/features/finance/payout-queries";
import { parseLedgerFilters } from "@/features/finance/ui-schemas";

/**
 * GET /api/admin/payouts/ledger?page&pageSize&order&q&seller&type&lstatus&range|from&to  (payouts.view)
 *
 * The append-only seller ledger. `lstatus` rather than `status` because the
 * statements list shares this URL vocabulary and a bookmarked statement filter
 * must not silently become a ledger filter. Totals for the WHOLE filtered set
 * ride along in `X-Ledger-Totals`.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, {
      defaultSort: "createdAt",
      defaultOrder: "desc",
      pageSize: 50,
    });
    const filters = parseLedgerFilters(query.raw);
    const range =
      query.raw.range || query.raw.from || query.raw.to
        ? resolveDateRangeParams(query.raw, "30d")
        : undefined;

    const result = await listLedgerEntries(query, filters, range);
    const response = apiList(result.rows, result.meta);
    response.headers.set("X-Ledger-Totals", JSON.stringify(result.totals));
    return response;
  },
  { permission: "payouts.view" },
);
