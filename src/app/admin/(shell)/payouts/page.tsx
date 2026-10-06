import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { BookOpen, Landmark, SearchX, Wallet } from "lucide-react";
import { cn } from "cn";

import { can, requirePermission } from "@/lib/auth/guards";
import { PAYOUT_STATUSES, PAYOUT_STATUS_META } from "@/lib/enums";
import { formatNumber, formatPaise } from "@/lib/money";
import { mergeQuery, one, parseListParams, type SearchParams } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { resolveDateRangeParams } from "@/components/shared/date-range";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { StatCard } from "@/components/shared/stat-card";

import { BalancesTable, MarkAvailableButton } from "@/features/finance/components/balances-table";
import { AdjustmentButton, LedgerTable } from "@/features/finance/components/ledger-table";
import {
  LedgerStatusFilter,
  LedgerTypeFilter,
  PayoutExportButton,
  SellerFilter,
} from "@/features/finance/components/payout-filters";
import { StatementsTable } from "@/features/finance/components/statements-table";
import {
  getPayoutFilterRefs,
  listLedgerEntries,
  listPayouts,
  listSellerBalances,
  payoutKpis,
  payoutStatusCounts,
} from "@/features/finance/payout-queries";
import {
  PAYOUT_TABS,
  PAYOUT_TAB_LABELS,
  hasLedgerFilters,
  parseBalanceFilters,
  parseBalanceSort,
  parseLedgerFilters,
  parsePayoutFilters,
  parsePayoutSort,
  parsePayoutTab,
} from "@/features/finance/ui-schemas";

export const metadata: Metadata = { title: "Payouts" };

/**
 * /admin/payouts (blueprint §1 Finance, §10 payout flow, §14.B4-B5).
 *
 * Three tabs on one route because they are three views of the same money:
 * what is owed (balances), what has been promised (statements) and every row
 * that produced those numbers (ledger). `?tab=` keeps them linkable, and each
 * tab reads only the queries it needs.
 */
export default async function PayoutsPage({ searchParams }: PageProps<"/admin/payouts">) {
  const actor = await requirePermission("payouts.view");

  const params = (await searchParams) as SearchParams;
  const tab = parsePayoutTab(one(params, "tab"));
  const canApprove = can(actor, "payouts.approve");
  const canProcess = can(actor, "payouts.process");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payouts"
        description="What the marketplace owes its sellers, the statements that pay it out, and the ledger every figure comes from."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PermissionGate require="payouts.process">
              <MarkAvailableButton />
            </PermissionGate>
          </div>
        }
      />

      <PayoutTabs current={tab} params={params} />

      {tab === "overview" ? (
        <OverviewTab params={params} canApprove={canApprove} canProcess={canProcess} />
      ) : tab === "statements" ? (
        <StatementsTab params={params} />
      ) : (
        <LedgerTab params={params} canAdjust={can(actor, "payouts.adjust")} />
      )}
    </div>
  );
}

function PayoutTabs({ current, params }: { current: string; params: SearchParams }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
  }

  return (
    <nav aria-label="Payout views" className="flex flex-wrap items-center gap-1 border-b">
      {PAYOUT_TABS.map((tab) => (
        <Link
          key={tab}
          href={`/admin/payouts${mergeQuery(query, { tab: tab === "overview" ? null : tab, page: null })}` as Route}
          aria-current={current === tab ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors",
            current === tab
              ? "border-brand text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          {PAYOUT_TAB_LABELS[tab]}
        </Link>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

async function OverviewTab({
  params,
  canApprove,
  canProcess,
}: {
  params: SearchParams;
  canApprove: boolean;
  canProcess: boolean;
}) {
  const list = parseListParams(params, { defaultSort: "available", defaultOrder: "desc", pageSize: 25 });
  const sort = parseBalanceSort(list.sort);
  const filters = parseBalanceFilters(params);

  const [kpis, balances, refs] = await Promise.all([
    payoutKpis(),
    listSellerBalances({ ...list, sort }, filters),
    getPayoutFilterRefs({ sellerId: filters.sellerId }),
  ]);

  return (
    <div className="space-y-4">
      <section aria-label="Payout metrics" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard
          label="On hold"
          value={formatPaise(kpis.pendingPaise)}
          hint="Delivered, still inside the payout hold"
          higherIsBetter={false}
        />
        <StatCard
          label="Available"
          value={formatPaise(kpis.availablePaise)}
          hint="Ready for the next statement"
        />
        <StatCard
          label="Scheduled"
          value={formatPaise(kpis.scheduledPaise)}
          hint={`${formatNumber(kpis.openStatements)} open statement${kpis.openStatements === 1 ? "" : "s"}`}
          href={"/admin/payouts?tab=statements&status=PENDING" as Route}
        />
        <StatCard
          label="Paid this month"
          value={formatPaise(kpis.paidThisMonthPaise)}
          hint={`${formatNumber(kpis.paidThisMonthCount)} statement${kpis.paidThisMonthCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Held sellers"
          value={formatNumber(kpis.heldSellers)}
          hint={`Owed but under the ${formatPaise(kpis.minPayoutPaise)} minimum`}
          higherIsBetter={false}
        />
      </section>

      <div className="surface overflow-hidden">
        <DataTableToolbar
          search={<SearchInput placeholder="Search a seller…" />}
          filters={
            <>
              <SellerFilter seller={refs.seller} />
              <FilterTabs
                paramKey="owed"
                allLabel="Owed only"
                options={[{ value: "0", label: "Include zero balances" }]}
              />
            </>
          }
        />

        {balances.rows.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No seller balances yet"
            description="A balance appears the first time a shipment is delivered - that is when the sale, commission and charge entries are written."
          />
        ) : (
          <>
            <BalancesTable
              rows={balances.rows}
              sort={sort}
              order={list.order}
              minPayoutPaise={balances.minPayoutPaise}
              canApprove={canApprove}
              canProcess={canProcess}
            />
            <PaginationBar meta={balances.meta} itemLabel="sellers" />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

async function StatementsTab({ params }: { params: SearchParams }) {
  const list = parseListParams(params, { defaultSort: "createdAt", defaultOrder: "desc", pageSize: 25 });
  const sort = parsePayoutSort(list.sort);
  const filters = parsePayoutFilters(params);
  const range = params.range || params.from || params.to ? resolveDateRangeParams(params, "30d") : undefined;

  const [result, counts, refs] = await Promise.all([
    listPayouts({ ...list, sort }, filters, range),
    payoutStatusCounts(filters, range),
    getPayoutFilterRefs(filters),
  ]);

  const filtered = Boolean(filters.q || filters.status || filters.sellerId || range);

  return (
    <div className="surface overflow-hidden">
      <DataTableToolbar
        search={<SearchInput placeholder="Search statement number, reference or seller…" />}
        filters={
          <>
            <FilterTabs
              paramKey="status"
              allLabel={`All ${counts.all}`}
              options={PAYOUT_STATUSES.map((status) => ({
                value: status,
                label: PAYOUT_STATUS_META[status].label,
                count: counts[status],
              }))}
            />
            <SellerFilter seller={refs.seller} />
            <DateRangePicker />
          </>
        }
        actions={<PayoutExportButton scope="statements" />}
      />

      {result.rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="No statements match these filters"
            description="Try a wider date range, or clear the filters."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href={"/admin/payouts?tab=statements" as Route}>Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Landmark}
            title="No payout statements yet"
            description="Generate one from a seller's row on the Overview tab once their available balance clears the minimum payout."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href={"/admin/payouts" as Route}>Go to balances</Link>
              </Button>
            }
          />
        )
      ) : (
        <>
          <StatementsTable rows={result.rows} sort={sort} order={list.order} />
          <PaginationBar meta={result.meta} itemLabel="statements" />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

async function LedgerTab({ params, canAdjust }: { params: SearchParams; canAdjust: boolean }) {
  const list = parseListParams(params, { defaultSort: "createdAt", defaultOrder: "desc", pageSize: 50 });
  const filters = parseLedgerFilters(params);
  const range = params.range || params.from || params.to ? resolveDateRangeParams(params, "30d") : undefined;

  const [result, refs] = await Promise.all([
    listLedgerEntries(list, filters, range),
    getPayoutFilterRefs(filters),
  ]);

  return (
    <div className="surface overflow-hidden">
      <DataTableToolbar
        search={<SearchInput placeholder="Search description, order or seller…" />}
        filters={
          <>
            <SellerFilter seller={refs.seller} />
            <LedgerTypeFilter value={filters.type} />
            <LedgerStatusFilter value={filters.status} />
            <DateRangePicker />
          </>
        }
        actions={
          <>
            <PayoutExportButton scope="ledger" />
            {canAdjust ? <AdjustmentButton seller={refs.seller} /> : null}
          </>
        }
      />

      <dl className="grid grid-cols-3 gap-3 border-b px-4 py-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Credits</dt>
          <dd className="text-success font-medium tabular-nums">+{formatPaise(result.totals.creditPaise)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Debits</dt>
          <dd className="text-destructive font-medium tabular-nums">−{formatPaise(result.totals.debitPaise)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Net</dt>
          <dd className="font-semibold tabular-nums">{formatPaise(result.totals.netPaise)}</dd>
        </div>
      </dl>

      {result.rows.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={hasLedgerFilters(filters) ? "No entries match these filters" : "The ledger is empty"}
          description={
            hasLedgerFilters(filters)
              ? "Try a wider date range or clear the type and status filters."
              : "Entries are written when a shipment is delivered, a refund completes or a statement is paid."
          }
          action={
            hasLedgerFilters(filters) ? (
              <Button asChild variant="outline" size="sm">
                <Link href={"/admin/payouts?tab=ledger" as Route}>Clear filters</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <LedgerTable rows={result.rows} />
          <PaginationBar meta={result.meta} itemLabel="entries" />
        </>
      )}
    </div>
  );
}
