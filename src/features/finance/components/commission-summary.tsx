import Link from "next/link";
import { BarChart3 } from "lucide-react";

import { formatNumber, formatPaise } from "@/lib/money";
import { BarChart } from "@/components/charts/bar-chart";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { StatCard } from "@/components/shared/stat-card";

import type { CommissionSummary } from "../queries";
import { formatBps } from "../ui-identity";

/**
 * Commission earned in a date range, by seller (blueprint §14.B3).
 *
 * Reads the OrderItem commission SNAPSHOTS, not today's rules: what a seller
 * was charged when the order was placed is a fact, and editing a rule must
 * never rewrite history. That is also why the numbers here can differ from
 * what the rules table implies - and why the note under the table says so.
 *
 * A Server Component; only the bar chart crosses into the browser.
 */
export function CommissionSummaryPanel({
  summary,
  rangeLabel,
}: {
  summary: CommissionSummary;
  rangeLabel: string;
}) {
  const chartData = summary.sellers
    .filter((row) => row.commissionPaise > 0)
    .slice(0, 8)
    .map((row) => ({ label: row.sellerName, value: row.commissionPaise }));

  const table = (
    <DataTable>
      <DataTableHead>
        <Th>Seller</Th>
        <Th align="right">Lines</Th>
        <Th align="right">Units</Th>
        <Th align="right">Seller gross</Th>
        <Th align="right">Commission</Th>
        <Th align="right">Charges</Th>
        <Th align="right">Effective</Th>
        <Th align="right">Payable</Th>
      </DataTableHead>
      <DataTableBody>
        {summary.sellers.map((row) => (
          <Tr key={row.sellerId ?? "platform"}>
            <Td>
              {row.href ? (
                <Link href={row.href} className="text-sm hover:underline">
                  {row.sellerName}
                </Link>
              ) : (
                <span className="text-muted-foreground text-sm">{row.sellerName}</span>
              )}
            </Td>
            <Td align="right" numeric className="text-xs">
              {formatNumber(row.lines)}
            </Td>
            <Td align="right" numeric className="text-xs">
              {formatNumber(row.units)}
            </Td>
            <Td align="right" numeric className="text-xs">
              {formatPaise(row.grossPaise)}
            </Td>
            <Td align="right" numeric className="text-xs font-medium">
              {formatPaise(row.commissionPaise)}
            </Td>
            <Td align="right" numeric className="text-xs">
              {formatPaise(row.chargesPaise)}
            </Td>
            <Td align="right" numeric className="text-xs">
              {formatBps(row.effectiveRateBps)}
            </Td>
            <Td align="right" numeric className="text-xs">
              {formatPaise(row.payablePaise)}
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = summary.sellers.map((row) => (
    <MobileCard key={row.sellerId ?? "platform"} title={row.sellerName} subtitle={`${formatNumber(row.lines)} lines`}>
      <MobileCardField label="Commission" numeric>
        {formatPaise(row.commissionPaise)}
      </MobileCardField>
      <MobileCardField label="Charges" numeric>
        {formatPaise(row.chargesPaise)}
      </MobileCardField>
      <MobileCardField label="Payable" numeric>
        {formatPaise(row.payablePaise)}
      </MobileCardField>
      <MobileCardField label="Effective" numeric>
        {formatBps(row.effectiveRateBps)}
      </MobileCardField>
    </MobileCard>
  ));

  return (
    <div className="space-y-4">
      <section aria-label="Commission totals" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Commission earned" value={formatPaise(summary.commissionPaise)} hint={rangeLabel} />
        <StatCard label="Marketplace charges" value={formatPaise(summary.chargesPaise)} hint="Deducted on top" />
        <StatCard
          label="Seller payable"
          value={formatPaise(summary.payablePaise)}
          hint={`${formatNumber(summary.lines)} lines across ${formatNumber(summary.orders)} orders`}
        />
        <StatCard
          label="Effective rate"
          value={formatBps(summary.effectiveRateBps)}
          hint={`On ${formatPaise(summary.grossPaise)} seller gross`}
        />
      </section>

      {summary.sellers.length === 0 ? (
        <div className="surface">
          <EmptyState
            icon={BarChart3}
            title="No commission in this range"
            description="Nothing was sold, or every line in the range belongs to the platform rather than a seller."
          />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="surface p-4">
            <h3 className="mb-2 text-sm font-semibold">Top sellers by commission</h3>
            <BarChart data={chartData} valueFormat="money" horizontal height={Math.max(160, chartData.length * 34)} />
          </div>
          <div className="surface overflow-hidden">
            <ResponsiveTable table={table} cards={cards} />
            <p className="text-muted-foreground border-t px-4 py-2 text-[11px]">
              Figures come from the commission snapshot stored on each order line, so a rule edited today does
              not change what a past order earned. Cancelled lines and cancelled or failed orders are excluded.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
