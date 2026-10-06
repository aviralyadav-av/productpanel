import type { Metadata } from "next";

import { can, requirePermission } from "@/lib/auth/guards";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { formatNumber } from "@/lib/money";
import { PaginationBar } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";

import { ReturnsTable } from "@/features/returns/components/returns-table";
import { ReturnsToolbar } from "@/features/returns/components/returns-toolbar";
import { getSellerRef, listReturns, returnKpis, returnStatusCounts } from "@/features/returns/queries";
import { hasReturnFilters, parseReturnFilters, resolveReturnSort } from "@/features/returns/schemas";

export const metadata: Metadata = { title: "Returns" };

/**
 * /admin/returns (blueprint §1 Returns, §14.C4).
 *
 * URL state: q, state (open|closed), status, reason, resolution, seller,
 * customer, order, range/from/to, sort, order, page. The KPI strip, the tab
 * counts and the page of rows are three parallel queries; the counts honour
 * every filter except the status tab itself, so the numbers describe the view
 * the operator is already in.
 */
export default async function ReturnsPage({ searchParams }: PageProps<"/admin/returns">) {
  const actor = await requirePermission("returns.view");

  const params = (await searchParams) as SearchParams;
  const listParams = parseListParams(params, { defaultSort: "requested", defaultOrder: "desc" });
  const filters = parseReturnFilters(params);
  const sort = resolveReturnSort(listParams.sort);

  const [list, counts, kpis, seller] = await Promise.all([
    listReturns({ ...listParams, sort }, filters),
    returnStatusCounts(filters, listParams.q),
    returnKpis(),
    getSellerRef(filters.sellerId),
  ]);

  const hasFilters = hasReturnFilters(filters, listParams.q);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Returns"
        description="Every RMA from request to refund. An open return holds its order in “return requested” and keeps the seller's earnings out of the next payout, so the list is worth clearing daily."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open RMAs" value={formatNumber(kpis.open)} hint="Anything not yet closed, rejected or cancelled" higherIsBetter={false} />
        <StatCard label="Awaiting QC" value={formatNumber(kpis.awaitingQc)} hint="Goods received, inspection pending" higherIsBetter={false} />
        <StatCard label="Refunds pending" value={formatNumber(kpis.refundsPending)} hint="Created from an RMA, not yet settled" higherIsBetter={false} />
        <StatCard label="Return rate" value={`${kpis.returnRatePct}%`} hint="Units returned ÷ units delivered, last 30 days" higherIsBetter={false} />
      </div>

      <ReturnsToolbar statusCounts={counts} seller={seller} canExport={can(actor, "returns.view")} hasFilters={hasFilters} />

      <ReturnsTable
        rows={list.rows}
        meta={list.meta}
        sort={sort}
        order={listParams.order}
        canManage={can(actor, "returns.manage")}
        hasFilters={hasFilters}
      />

      {list.meta.totalPages > 1 ? <PaginationBar meta={list.meta} itemLabel="returns" /> : null}
    </div>
  );
}
