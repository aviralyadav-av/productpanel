import Link from "next/link";
import type { Route } from "next";
import { Receipt, Wallet } from "lucide-react";

import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import type { PageMeta } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { Panel } from "@/components/shared/panel";
import { PriceText } from "@/components/shared/price-text";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { StatCard } from "@/components/shared/stat-card";

import { LedgerStatusBadge, LedgerTypeBadge, PayoutStatusBadge } from "@/features/sellers/components/badges";
import { LEDGER_ENTRY_STATUSES, LEDGER_ENTRY_TYPES } from "@/features/sellers/schemas";
import type { SellerDetail, SellerLedgerRow, SellerPayoutRow } from "@/features/sellers/types";

/**
 * Earnings tab (B4/B5 display). The balance cards are the SellerBalance
 * projection; the ledger table is the source of truth behind them. Payout
 * generation and approval live in the payouts module - this tab only links.
 */
export function EarningsTab({
  seller,
  ledger,
  meta,
  payouts,
}: {
  seller: SellerDetail;
  ledger: SellerLedgerRow[];
  meta: PageMeta;
  payouts: SellerPayoutRow[];
}) {
  const { balance } = seller;
  return (
    <div className="space-y-4">
      <section aria-label="Balance" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="On hold" value={formatPaise(balance.pendingPaise)} hint="Inside the payout hold period" />
        <StatCard label="Available" value={formatPaise(balance.availablePaise)} hint="Eligible for the next statement" />
        <StatCard label="Scheduled" value={formatPaise(balance.scheduledPaise)} hint={seller.openPayout ? `On ${seller.openPayout.number}` : "Attached to an open statement"} />
        <StatCard label="Paid to date" value={formatPaise(balance.paidPaise)} hint="Sum of PAID statements" />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Ledger"
          description={`${meta.total} entries`}
          className="lg:col-span-2"
          bodyClassName="p-0"
        >
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
            <SearchInput placeholder="Search description or order…" className="w-full sm:w-56" />
            <FilterTabs paramKey="type" allLabel="All types" options={LEDGER_ENTRY_TYPES.filter((type) => type !== "COMMISSION_TAX").map((type) => ({ value: type, label: type.replace("_", " ").toLowerCase() }))} />
            <FilterTabs paramKey="status" allLabel="Any status" options={LEDGER_ENTRY_STATUSES.map((status) => ({ value: status, label: status.toLowerCase() }))} />
          </div>
          {ledger.length === 0 ? (
            <EmptyState icon={Wallet} title="No ledger entries" description="Entries are written when a shipment containing this seller's items is delivered." compact />
          ) : (
            <ResponsiveTable
              table={
                <DataTable>
                  <DataTableHead>
                    <Th>Date</Th>
                    <Th>Type</Th>
                    <Th>Description</Th>
                    <Th>Order</Th>
                    <Th>Status</Th>
                    <Th align="right">Amount</Th>
                  </DataTableHead>
                  <DataTableBody>
                    {ledger.map((row) => (
                      <Tr key={row.id}>
                        <Td numeric className="text-xs">
                          {formatIstDateTime(new Date(row.createdAt))}
                        </Td>
                        <Td>
                          <LedgerTypeBadge type={row.type} />
                        </Td>
                        <Td className="max-w-[18rem] truncate text-xs" >{row.description}</Td>
                        <Td className="text-xs">
                          {row.orderId ? (
                            <Link href={`/admin/orders/${row.orderId}` as Route} className="font-mono hover:underline">
                              {row.orderNumber}
                            </Link>
                          ) : row.payoutId ? (
                            <Link href={`/admin/payouts/${row.payoutId}` as Route} className="font-mono hover:underline">
                              {row.payoutNumber}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </Td>
                        <Td>
                          <LedgerStatusBadge status={row.status} />
                          {row.status === "PENDING" && row.availableAt ? (
                            <span className="text-muted-foreground block text-[11px]">until {formatIstDate(new Date(row.availableAt))}</span>
                          ) : null}
                        </Td>
                        <Td align="right" className="text-xs">
                          <PriceText paise={row.amountPaise} signed />
                        </Td>
                      </Tr>
                    ))}
                  </DataTableBody>
                </DataTable>
              }
              cards={ledger.map((row) => (
                <MobileCard key={row.id} title={row.description} subtitle={formatIstDateTime(new Date(row.createdAt))} meta={<PriceText paise={row.amountPaise} signed />}>
                  <MobileCardField label="Type">
                    <LedgerTypeBadge type={row.type} />
                  </MobileCardField>
                  <MobileCardField label="Status">
                    <LedgerStatusBadge status={row.status} />
                  </MobileCardField>
                </MobileCard>
              ))}
            />
          )}
          <PaginationBar meta={meta} itemLabel="entries" />
        </Panel>

        <Panel
          title="Payout statements"
          action={
            <Button asChild size="xs" variant="outline">
              <Link href={`/admin/payouts?seller=${seller.id}` as Route}>Generate payout</Link>
            </Button>
          }
          bodyClassName="p-0"
        >
          {payouts.length === 0 ? (
            <EmptyState icon={Receipt} title="No statements" description="Generate one from the payouts module once earnings are available." compact />
          ) : (
            <ul className="divide-y">
              {payouts.map((payout) => (
                <li key={payout.id}>
                  <Link href={`/admin/payouts/${payout.id}` as Route} className="hover:bg-accent/40 block px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-medium">{payout.payoutNumber}</span>
                      <PayoutStatusBadge status={payout.status} />
                    </div>
                    <div className="text-muted-foreground mt-0.5 flex items-center justify-between gap-2 text-[11px]">
                      <span>
                        {formatIstDate(new Date(payout.periodFrom))} – {formatIstDate(new Date(payout.periodTo))}
                      </span>
                      <span data-numeric className="text-foreground font-medium">
                        {formatPaise(payout.netPaise)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
