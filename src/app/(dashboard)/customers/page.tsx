import type { Metadata } from "next";
import Link from "next/link";
import { SearchX, Users } from "lucide-react";

import { requireAdmin } from "@/lib/auth/guards";
import {
  getCustomerDetail,
  getCustomerKpis,
  getCustomers,
} from "@/features/customers/queries";
import {
  CUSTOMER_SORT_LABELS,
  parseCustomerSegment,
  parseCustomerSort,
  parseCustomerStatusFilter,
} from "@/features/customers/schemas";
import { CustomerSheet } from "@/features/customers/components/customer-sheet";
import { CustomerTable } from "@/features/customers/components/customer-table";
import { EmptyState } from "@/components/shared/empty-state";
import {
  FilterTabs,
  PaginationBar,
  SearchInput,
} from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { buildPageMeta, one, parseListParams } from "@/lib/list-params";
import { delta, formatNumber, formatPaise, formatPercent } from "@/lib/money";

export const metadata: Metadata = { title: "Customers" };

/**
 * ONE route. There is deliberately no /customers/[id]: the record is small
 * enough to read beside the list, so it opens in a Sheet driven by
 * ?customer=<id>. Every other piece of list state - search, status, segment,
 * sort, page - is in the URL for the same reason.
 */
export default async function CustomersPage({
  searchParams,
}: PageProps<"/customers">) {
  await requireAdmin();
  const params = await searchParams;

  const list = parseListParams(params, {
    defaultSort: "ltv",
    defaultOrder: "desc",
    pageSize: 25,
  });
  const sort = parseCustomerSort(list.sort);
  const status = parseCustomerStatusFilter(one(params, "status"));
  const segment = parseCustomerSegment(one(params, "segment"));
  const selectedId = one(params, "customer");

  const [kpis, result, detail] = await Promise.all([
    getCustomerKpis(),
    getCustomers({
      q: list.q,
      status,
      segment,
      sort,
      order: list.order,
      skip: list.skip,
      take: list.pageSize,
    }),
    selectedId ? getCustomerDetail(selectedId) : null,
  ]);

  const meta = buildPageMeta(result.total, list);
  const isFiltered = Boolean(list.q || status || segment);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        description="A customer record is created by an order, not by a sign-up. The storefront is not wired to this admin yet, so nothing new lands here until its checkout posts to this API."
      />

      <section
        aria-label="Customer metrics"
        className="grid grid-cols-2 gap-3 xl:grid-cols-4"
      >
        <StatCard
          label="Customers"
          value={formatNumber(kpis.total)}
          hint={`${formatNumber(kpis.withOrders)} have placed an order`}
        />
        <StatCard
          label="New in 30 days"
          value={formatNumber(kpis.newLast30)}
          delta={delta(kpis.newLast30, kpis.newPrevious30)}
          href={"/customers?segment=new" as never}
        />
        <StatCard
          label="Repeat customers"
          value={formatNumber(kpis.repeat)}
          hint={
            kpis.total > 0
              ? `${formatPercent((kpis.repeat / kpis.total) * 100)} of all customers`
              : "More than one order"
          }
          href={"/customers?segment=repeat" as never}
        />
        <StatCard
          label="Average lifetime value"
          value={formatPaise(kpis.averageLifetimeValuePaise)}
          hint="Net of refunds, across every customer"
        />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          placeholder="Search name, email or phone…"
          className="w-full sm:w-64"
        />
        <FilterTabs
          paramKey="status"
          allLabel="All"
          options={[
            { value: "ACTIVE", label: "Active" },
            { value: "BLOCKED", label: "Blocked" },
          ]}
        />
        <FilterTabs
          paramKey="segment"
          allLabel="Everyone"
          options={[
            { value: "repeat", label: "Repeat" },
            { value: "new", label: "New" },
          ]}
        />
      </div>

      <Panel
        title="All customers"
        description={`${formatNumber(meta.total)} matching · sorted by ${CUSTOMER_SORT_LABELS[sort]}, ${list.order === "desc" ? "highest first" : "lowest first"}`}
        bodyClassName="p-0"
      >
        {result.rows.length === 0 ? (
          isFiltered ? (
            <EmptyState
              icon={SearchX}
              title="No customers match these filters"
              description="Try a different search term, or clear the filters to see everyone."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/customers">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No customers yet"
              description="Customers appear once an order exists against an email address. The live storefront saves its checkout to the shopper's own browser and never posts it, so records will only arrive here after cutover or from an order entered by hand."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/orders">Go to orders</Link>
                </Button>
              }
            />
          )
        ) : (
          <>
            <CustomerTable
              rows={result.rows}
              params={params}
              sort={sort}
              order={list.order}
              selectedId={selectedId}
            />
            <PaginationBar meta={meta} itemLabel="customers" />
          </>
        )}
      </Panel>

      {/* Remounted per customer so the panel always opens for the id in the URL. */}
      {detail ? <CustomerSheet key={detail.id} customer={detail} /> : null}
    </div>
  );
}
