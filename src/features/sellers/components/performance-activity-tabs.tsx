import { Activity } from "lucide-react";

import { formatNumber, formatPercent } from "@/lib/money";
import { BarChart } from "@/components/charts/bar-chart";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { EmptyState } from "@/components/shared/empty-state";
import { Panel } from "@/components/shared/panel";
import { StatCard } from "@/components/shared/stat-card";
import { StatusTimeline } from "@/components/shared/status-timeline";

import type { SellerActivityRow, SellerPerformance } from "@/features/sellers/types";

/**
 * Performance (12 weekly buckets, top products, service KPIs) and Activity
 * (SellerEvent timeline merged with the seller's audit rows). Server
 * Components; the charts are client components fed with plain rows.
 */

export function PerformanceTab({ performance }: { performance: SellerPerformance }) {
  const { kpis } = performance;
  return (
    <div className="space-y-4">
      <section aria-label="Service KPIs" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard label="Average rating" value={kpis.reviewCount > 0 ? kpis.ratingAvg.toFixed(1) : "—"} hint={`${formatNumber(kpis.reviewCount)} reviews`} />
        <StatCard label="Return rate" value={formatPercent(kpis.returnRatePct)} hint="Return requests ÷ lines sold" higherIsBetter={false} />
        <StatCard label="Cancellation rate" value={formatPercent(kpis.cancellationRatePct)} hint="Cancelled lines ÷ lines sold" higherIsBetter={false} />
        <StatCard label="Avg fulfilment" value={kpis.avgFulfilmentDays === null ? "—" : `${kpis.avgFulfilmentDays.toFixed(1)} d`} hint="Order placed → item delivered" higherIsBetter={false} />
        <StatCard label="Items (12 wk)" value={formatNumber(kpis.itemsInWindow)} hint="Units sold in the window" />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Weekly gross sales" description="Line totals by order week, last 12 weeks" bodyClassName="p-4">
          <TimeSeriesChart series={[{ key: "grossPaise", label: "Gross sales" }]} data={performance.weekly} valueFormat="money" height={220} />
        </Panel>
        <Panel title="Weekly items sold" description="Units by order week, last 12 weeks" bodyClassName="p-4">
          <TimeSeriesChart series={[{ key: "items", label: "Items" }]} data={performance.weekly} valueFormat="number" height={220} />
        </Panel>
      </div>

      <Panel title="Top products" description="By gross sales in the last 12 weeks" bodyClassName="p-4">
        <BarChart data={performance.topProducts} valueFormat="money" horizontal height={Math.max(160, performance.topProducts.length * 34)} showValues />
      </Panel>
    </div>
  );
}

export function ActivityTab({ rows }: { rows: SellerActivityRow[] }) {
  return (
    <Panel title="Activity" description="Status history and every audited change, newest first" bodyClassName="p-4">
      {rows.length === 0 ? (
        <EmptyState icon={Activity} title="No activity" compact />
      ) : (
        <StatusTimeline
          events={rows.map((row) => ({
            id: row.id,
            title: row.kind === "audit" ? <span className="font-mono text-[11px]">{row.title}</span> : row.title,
            description: row.description ?? undefined,
            at: new Date(row.at),
            actor: row.actor,
            tone: row.tone,
            isInternal: row.kind === "audit",
          }))}
        />
      )}
    </Panel>
  );
}
