import { parseListQuery, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getSellerDetail, listSellerLedger, listSellerPayouts } from "@/features/sellers/detail-queries";
import { parseLedgerStatus, parseLedgerType } from "@/features/sellers/schemas";

/**
 * GET /api/admin/sellers/:id/earnings?page&pageSize&q&type&status   (sellers.view)
 *
 * `{ data: { balance, openPayout, ledger, payouts }, meta }` - the B4 balance
 * projection, one page of ledger entries and the latest statements.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params, searchParams }) => {
    const seller = await getSellerDetail(params.id);
    if (!seller) throw notFound("Seller");
    const query = parseListQuery(searchParams, { pageSize: 25 });
    const [ledger, payouts] = await Promise.all([
      listSellerLedger(params.id, query, { type: parseLedgerType(query.filter("type")), status: parseLedgerStatus(query.filter("status")) }),
      listSellerPayouts(params.id, 20),
    ]);
    return Response.json(
      { data: { balance: seller.balance, openPayout: seller.openPayout, ledger: ledger.rows, payouts }, meta: ledger.meta },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
  { permission: "sellers.view" },
);
