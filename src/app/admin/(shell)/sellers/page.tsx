import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Plus, SearchX, Store } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { SELLER_STATUSES, SELLER_STATUS_META } from "@/lib/enums";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { formatNumber, formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { StatCard } from "@/components/shared/stat-card";

import { SellerExportButton, SellerFilters } from "@/features/sellers/components/seller-filters";
import { SellerTable } from "@/features/sellers/components/seller-table";
import { listSellers, sellerFilterOptions, sellerKpis, sellerStatusCounts } from "@/features/sellers/queries";
import { hasSellerFilters, parseSellerFilters, parseSellerSort } from "@/features/sellers/schemas";

export const metadata: Metadata = { title: "Sellers" };

/**
 * /admin/sellers (blueprint §1 Sellers, brief §6). `?status=PENDING` is the
 * "Seller Approvals" entry in the sidebar: same screen, approvals-oriented
 * header. Every list state - search, status, state/city, pending docs,
 * rating, sort, page - is in the URL.
 */
export default async function SellersPage({ searchParams }: PageProps<"/admin/sellers">) {
  await requirePermission("sellers.view");

  const params = (await searchParams) as SearchParams;
  const list = parseListParams(params, { defaultSort: "registered", defaultOrder: "desc", pageSize: 25 });
  const sort = parseSellerSort(list.sort);
  const filters = parseSellerFilters(params);
  const approvalsView = filters.status === "PENDING" || filters.status === "UNDER_REVIEW";

  const [kpis, counts, result, options] = await Promise.all([
    sellerKpis(),
    sellerStatusCounts(filters),
    listSellers({ ...list, sort }, filters),
    sellerFilterOptions(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={approvalsView ? "Seller approvals" : "Sellers"}
        description={
          approvalsView
            ? "Registrations waiting for review. Move a seller to review, check their KYC documents and bank account, then approve; approval activates automatically once both are in place."
            : "Every marketplace seller: onboarding status, catalogue, sales and what the platform owes them."
        }
        actions={
          <PermissionGate require="sellers.create">
            <Button asChild size="sm">
              <Link href="/admin/sellers/new">
                <Plus />
                New seller
              </Link>
            </Button>
          </PermissionGate>
        }
      />

      <section aria-label="Seller metrics" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard label="Active sellers" value={formatNumber(kpis.active)} href={"/admin/sellers?status=ACTIVE" as Route} />
        <StatCard
          label="Pending approvals"
          value={formatNumber(kpis.pendingApprovals)}
          hint="Pending + under review"
          href={"/admin/sellers?status=PENDING" as Route}
          higherIsBetter={false}
        />
        <StatCard label="Suspended" value={formatNumber(kpis.suspended)} href={"/admin/sellers?status=SUSPENDED" as Route} higherIsBetter={false} />
        <StatCard label="Gross sales" value={formatPaise(kpis.grossSalesPaise)} hint="Delivered seller sales, all time" />
        <StatCard
          label="Pending payable"
          value={formatPaise(kpis.payablePaise)}
          hint={`${formatPaise(kpis.onHoldPaise)} still on hold`}
          href={"/admin/payouts" as Route}
        />
      </section>

      <div className="surface overflow-hidden">
        <DataTableToolbar
          search={<SearchInput placeholder="Search name, email, phone, GSTIN…" />}
          filters={
            <>
              <FilterTabs
                paramKey="status"
                allLabel={`All ${counts.all}`}
                options={SELLER_STATUSES.map((status) => ({ value: status, label: SELLER_STATUS_META[status].label, count: counts[status] }))}
              />
              <SellerFilters options={options} />
            </>
          }
          actions={<SellerExportButton />}
        />

        {result.rows.length === 0 ? (
          hasSellerFilters(filters) ? (
            <EmptyState
              icon={SearchX}
              title="No sellers match these filters"
              description="Try a different search, or clear the filters to see every seller."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/sellers">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Store}
              title="No sellers yet"
              description="Sellers arrive from the storefront registration form or can be created here."
              action={
                <PermissionGate require="sellers.create">
                  <Button asChild size="sm">
                    <Link href="/admin/sellers/new">Create the first seller</Link>
                  </Button>
                </PermissionGate>
              }
            />
          )
        ) : (
          <>
            <SellerTable rows={result.rows} sort={sort} order={list.order} />
            <PaginationBar meta={result.meta} itemLabel="sellers" />
          </>
        )}
      </div>
    </div>
  );
}
