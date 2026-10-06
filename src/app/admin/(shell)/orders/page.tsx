import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Plus } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { formatNumber, formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { PaginationBar } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";

import { OrdersTable } from "@/features/orders/components/orders-table";
import { OrdersToolbar } from "@/features/orders/components/orders-toolbar";
import { getCustomerRef, getSellerRef, listOrders, orderKpis, orderStatusCounts } from "@/features/orders/queries";
import { hasActiveOrderFilters, parseOrderListFilters, resolveOrderSort } from "@/features/orders/schemas";

export const metadata: Metadata = { title: "Orders" };

/**
 * /admin/orders (blueprint §1 Orders, §8, §14.C8).
 *
 * URL state: q, status, payment, method, source, seller, customer, range/from/to,
 * minTotal, maxTotal, returns, custom, sort, order, page. The KPI strip, the
 * tab counts and the page of rows are three parallel queries; the counts
 * honour every filter except the status tab itself, so the numbers on the
 * tabs describe the view the operator is already in.
 */
export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const actor = await requirePermission("orders.view");

  const params = (await searchParams) as SearchParams;
  const listParams = parseListParams(params, { defaultSort: "placed", defaultOrder: "desc" });
  const filters = parseOrderListFilters(params);
  const sort = resolveOrderSort(listParams.sort);

  const [list, counts, kpis, seller, customer] = await Promise.all([
    listOrders({ ...listParams, sort }, filters),
    orderStatusCounts(filters, listParams.q),
    orderKpis(),
    getSellerRef(filters.sellerId),
    getCustomerRef(filters.customerId),
  ]);

  const canUpdate = can(actor, "orders.update");
  const hasFilters = hasActiveOrderFilters(filters, listParams.q);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Orders"
        description="Every order from the storefront and every one keyed by hand. Status past packed is derived from shipments and returns, so the list always agrees with what the customer is told."
        actions={
          can(actor, "orders.create") ? (
            <Button asChild size="sm">
              <Link href={"/admin/orders/new" as Route}>
                <Plus /> New order
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Orders today" value={formatNumber(kpis.todayOrders)} hint="Placed since midnight IST" />
        <StatCard label="Revenue today" value={formatPaise(kpis.todayRevenuePaise)} hint="Net of refunds, excluding cancelled" />
        <StatCard label="Pending" value={formatNumber(kpis.pending)} href={"/admin/orders?status=PENDING" as Route} hint="Awaiting confirmation or payment" />
        <StatCard label="In fulfilment" value={formatNumber(kpis.processing)} href={"/admin/orders?status=PROCESSING" as Route} hint="Confirmed, processing or packed" />
        <StatCard
          label="Awaiting payment"
          value={formatNumber(kpis.awaitingPayment)}
          href={"/admin/orders?payment=PENDING" as Route}
          hint={`${formatNumber(kpis.shipped)} in transit`}
          higherIsBetter={false}
        />
      </div>

      <OrdersToolbar
        statusCounts={counts}
        seller={seller}
        customer={customer}
        canExport={can(actor, "orders.export")}
        hasFilters={hasFilters}
      />

      <OrdersTable rows={list.rows} meta={list.meta} sort={sort} order={listParams.order} canUpdate={canUpdate} hasFilters={hasFilters} />

      {list.meta.totalPages > 1 ? <PaginationBar meta={list.meta} itemLabel="orders" /> : null}
    </div>
  );
}
