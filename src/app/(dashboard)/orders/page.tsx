import type { Metadata } from "next";

import { requireAdmin } from "@/lib/auth/guards";
import {
  ORDER_RANGE_OPTIONS,
  listOrders,
} from "@/features/orders/queries";
import { OrderTable } from "@/features/orders/components/order-table";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatCard } from "@/components/shared/stat-card";
import {
  FilterTabs,
  PaginationBar,
  SearchInput,
} from "@/components/shared/list-controls";
import {
  ORDER_STATUSES,
  ORDER_STATUS_META,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_META,
} from "@/lib/enums";
import { formatNumber, formatPaise } from "@/lib/money";
import type { SearchParams } from "@/lib/list-params";

export const metadata: Metadata = { title: "Orders" };

/** Rebuild the incoming query string so sort links keep every active filter. */
function toQueryString(params: SearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item);
    } else if (value) {
      query.set(key, value);
    }
  }
  return query.toString();
}

export default async function OrdersPage({
  searchParams,
}: PageProps<"/orders">) {
  await requireAdmin();
  const params = await searchParams;

  const { rows, meta, filters, statusCounts, paymentCounts, methodCounts, kpis } =
    await listOrders(params);

  const isFiltered = Boolean(
    filters.q ||
      filters.status ||
      filters.payment ||
      filters.method ||
      filters.range !== "all",
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Orders"
        description={
          <>
            {kpis.rangeLabel} · every figure below is an aggregate over real
            order rows. The storefront still keeps its own orders in the
            shopper&apos;s browser, so only orders that reached this database
            appear here.
          </>
        }
      />

      {/* KPIs follow every filter except status, so the tiles always describe
          the same set of orders the status tabs are counting. */}
      <section
        aria-label="Order metrics"
        className="grid grid-cols-2 gap-3 xl:grid-cols-4"
      >
        <StatCard
          label="Orders"
          value={formatNumber(kpis.orders)}
          hint={isFiltered ? "Matching these filters" : "All time"}
        />
        <StatCard
          label="Revenue"
          value={formatPaise(kpis.revenuePaise)}
          hint="Net of refunds · excludes cancelled and returned"
        />
        <StatCard
          label="Average order"
          value={formatPaise(kpis.aovPaise)}
          hint={`Across ${formatNumber(kpis.revenueOrders)} counted orders`}
        />
        <StatCard
          label="Awaiting confirmation"
          value={formatNumber(kpis.awaitingConfirmation)}
          hint="Placed, not yet confirmed"
          href={"/orders?status=PLACED" as never}
          higherIsBetter={false}
        />
      </section>

      {/* Toolbar. Every control writes to the URL; none of it is React state. */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            className="w-full sm:max-w-xs"
            placeholder="Order number, name, email or phone"
          />
          <FilterTabs
            paramKey="range"
            allLabel="All time"
            className="sm:ml-auto"
            options={ORDER_RANGE_OPTIONS.filter(
              (option) => option.value !== "all",
            ).map((option) => ({ value: option.value, label: option.label }))}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterTabs
            paramKey="status"
            allLabel="All statuses"
            options={ORDER_STATUSES.map((status) => ({
              value: status,
              label: ORDER_STATUS_META[status].label,
              count: statusCounts[status],
            }))}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterTabs
            paramKey="payment"
            allLabel="Any payment"
            options={PAYMENT_STATUSES.map((status) => ({
              value: status,
              label: PAYMENT_STATUS_META[status].label,
              count: paymentCounts[status],
            }))}
          />
          <FilterTabs
            paramKey="method"
            allLabel="Any method"
            options={PAYMENT_METHODS.map((method) => ({
              value: method,
              label: method === "COD" ? "Cash on delivery" : "Online",
              count: methodCounts[method],
            }))}
          />
        </div>
      </div>

      <Panel
        title="All orders"
        description={`${formatNumber(meta.total)} matching · ${
          filters.sort === "totalPaise"
            ? filters.order === "desc"
              ? "largest total first"
              : "smallest total first"
            : filters.order === "desc"
              ? "newest first"
              : "oldest first"
        }`}
        bodyClassName="p-0"
      >
        <OrderTable
          orders={rows}
          sort={filters.sort}
          order={filters.order}
          query={toQueryString(params)}
          isFiltered={isFiltered}
        />
        <PaginationBar meta={meta} itemLabel="orders" />
      </Panel>
    </div>
  );
}
