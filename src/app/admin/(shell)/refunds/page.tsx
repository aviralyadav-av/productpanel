import type { Metadata } from "next";

import { can, requirePermission } from "@/lib/auth/guards";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { formatNumber, formatPaise } from "@/lib/money";
import { PaginationBar } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";

import { RefundsTable } from "@/features/refunds/components/refunds-table";
import { RefundsToolbar } from "@/features/refunds/components/refunds-toolbar";
import { getRefundOrderOption, listRefunds, refundKpis, refundStatusCounts } from "@/features/refunds/queries";
import { hasRefundFilters, parseRefundFilters, resolveRefundSort } from "@/features/refunds/schemas";

export const metadata: Metadata = { title: "Refunds" };

/**
 * /admin/refunds (blueprint §1 Refunds, §14.B6).
 *
 * `?order=DB10123` both filters the list and pre-fills the "create refund"
 * dialog, so the link an operator follows from an order lands them exactly
 * where they meant to go.
 */
export default async function RefundsPage({ searchParams }: PageProps<"/admin/refunds">) {
  const actor = await requirePermission("refunds.view");

  const params = (await searchParams) as SearchParams;
  const listParams = parseListParams(params, { defaultSort: "created", defaultOrder: "desc" });
  const filters = parseRefundFilters(params);
  const sort = resolveRefundSort(listParams.sort);

  const [list, counts, kpis, order] = await Promise.all([
    listRefunds({ ...listParams, sort }, filters),
    refundStatusCounts(filters, listParams.q),
    refundKpis(),
    filters.orderId ? getRefundOrderOption(filters.orderId) : Promise.resolve(null),
  ]);

  const hasFilters = hasRefundFilters(filters, listParams.q);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Refunds"
        description="Money going back to customers. A refund only touches the ledger when it completes — until then it just reserves headroom against what the order can still return."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pending approval" value={formatNumber(kpis.pending)} hint="Created, not yet approved" higherIsBetter={false} />
        <StatCard label="In flight" value={formatNumber(kpis.processing)} hint="Approved or with the gateway" higherIsBetter={false} />
        <StatCard label="Completed this month" value={formatPaise(kpis.completedThisMonthPaise)} hint="IST month to date" higherIsBetter={false} />
        <StatCard label="Failed" value={formatNumber(kpis.failed)} hint="Need a retry or a different method" higherIsBetter={false} />
      </div>

      <RefundsToolbar
        statusCounts={counts}
        order={order}
        canProcess={can(actor, "refunds.process")}
        canExport={can(actor, "refunds.view")}
        hasFilters={hasFilters}
        openCreate={Boolean(order)}
      />

      <RefundsTable rows={list.rows} meta={list.meta} sort={sort} order={listParams.order} hasFilters={hasFilters} />

      {list.meta.totalPages > 1 ? <PaginationBar meta={list.meta} itemLabel="refunds" /> : null}
    </div>
  );
}
