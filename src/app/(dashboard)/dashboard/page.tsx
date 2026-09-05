import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import {
  FlaskConical,
  LayoutTemplate,
  Package,
  Percent,
  Plus,
  ShoppingCart,
} from "lucide-react";

import { requireAdmin } from "@/lib/auth/guards";
import {
  getAlerts,
  getCatalogSummary,
  getKpis,
  getOrderStatusBreakdown,
  getRevenueSeries,
  getRecentActivity,
  hasDemoData,
} from "@/features/dashboard/queries";
import { AlertsPanel } from "@/features/dashboard/components/alerts-panel";
import { RevenueChart } from "@/features/dashboard/components/revenue-chart";
import {
  RecentCustomersTable,
  RecentOrdersTable,
  StockPanel,
  TopProductsTable,
} from "@/features/dashboard/components/dashboard-tables";
import { RangeTabs } from "@/features/dashboard/components/range-tabs";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatCard } from "@/components/shared/stat-card";
import { StatusPill } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ORDER_STATUS_META, type OrderStatus } from "@/lib/enums";
import { RANGE_PRESETS, formatIstDateTime, type RangePreset } from "@/lib/dates";
import { formatNumber, formatPaise, formatPercent } from "@/lib/money";

export const metadata: Metadata = { title: "Dashboard" };

function resolvePreset(raw: string | string[] | undefined): RangePreset {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value in RANGE_PRESETS ? (value as RangePreset) : "30d";
}

export default async function DashboardPage({
  searchParams,
}: PageProps<"/dashboard">) {
  const actor = await requireAdmin();
  const params = await searchParams;
  const preset = resolvePreset(params.range);

  const [kpis, alerts, catalog, isDemo] = await Promise.all([
    getKpis(preset),
    getAlerts(),
    getCatalogSummary(),
    hasDemoData(),
  ]);

  const firstName = actor.name?.split(" ")[0] ?? "there";

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Good to see you, ${firstName}`}
        description={
          <>
            {kpis.range.label} · all figures are computed from real order and
            inventory rows in this database. Nothing on this page is a
            placeholder.
          </>
        }
        actions={<RangeTabs value={preset} />}
      />

      {isDemo ? <DemoDataNotice /> : null}

      {/* KPIs ------------------------------------------------------------ */}
      <section
        aria-label="Key metrics"
        className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6"
      >
        <StatCard
          label="Revenue"
          value={formatPaise(kpis.current.revenuePaise)}
          delta={kpis.deltas.revenue}
        />
        <StatCard
          label="Orders"
          value={formatNumber(kpis.current.orders)}
          delta={kpis.deltas.orders}
          href="/orders"
        />
        <StatCard
          label="Average order"
          value={formatPaise(kpis.current.aovPaise)}
          delta={kpis.deltas.aov}
        />
        <StatCard
          label="Units sold"
          value={formatNumber(kpis.current.unitsSold)}
          delta={kpis.deltas.units}
        />
        <StatCard
          label="New customers"
          value={formatNumber(kpis.current.newCustomers)}
          delta={kpis.deltas.newCustomers}
          href="/customers"
        />
        <StatCard
          label="Cancellations"
          value={formatPercent(kpis.current.cancellationRate)}
          delta={kpis.deltas.cancellationRate}
          higherIsBetter={false}
        />
      </section>

      {/* Chart + alerts --------------------------------------------------- */}
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel
          title="Revenue and orders"
          description={`${kpis.range.label}, IST days · revenue is net of recorded refunds`}
          className="xl:col-span-2"
          bodyClassName="p-3"
        >
          <Suspense fallback={<Skeleton className="h-56 w-full" />}>
            <RevenueChartSection preset={preset} />
          </Suspense>
        </Panel>

        <Panel
          title="Needs attention"
          description="Computed live from stock, orders, pricing and content"
          bodyClassName="p-0"
        >
          <AlertsPanel alerts={alerts} />
        </Panel>
      </div>

      {/* Operational tables ----------------------------------------------- */}
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel
          title="Recent orders"
          className="xl:col-span-2"
          bodyClassName="p-0"
          viewAllHref="/orders"
        >
          <Suspense fallback={<TableSkeleton rows={7} />}>
            <RecentOrdersTable />
          </Suspense>
        </Panel>

        <Panel
          title="Low and out of stock"
          description="Ordered by urgency"
          bodyClassName="p-0"
          viewAllHref="/inventory"
        >
          <Suspense fallback={<TableSkeleton rows={6} />}>
            <StockPanel />
          </Suspense>
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel
          title="Top sellers"
          description={`By revenue · ${kpis.range.label}`}
          bodyClassName="p-0"
          viewAllHref="/products"
        >
          <Suspense fallback={<TableSkeleton rows={5} />}>
            <TopProductsTable preset={preset} />
          </Suspense>
        </Panel>

        <Panel
          title="Newest customers"
          bodyClassName="p-0"
          viewAllHref="/customers"
        >
          <Suspense fallback={<TableSkeleton rows={5} />}>
            <RecentCustomersTable />
          </Suspense>
        </Panel>

        <Panel title="Order pipeline" bodyClassName="p-0">
          <Suspense fallback={<TableSkeleton rows={5} />}>
            <OrderPipeline />
          </Suspense>
        </Panel>
      </div>

      {/* Quick actions + catalog + activity -------------------------------- */}
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Quick actions" bodyClassName="p-3">
          <div className="grid grid-cols-2 gap-2">
            <QuickAction
              href="/products/new"
              icon={Plus}
              label="New product"
            />
            <QuickAction
              href="/orders?status=PLACED"
              icon={ShoppingCart}
              label="Confirm orders"
            />
            <QuickAction
              href="/content"
              icon={LayoutTemplate}
              label="Edit homepage"
            />
            <QuickAction
              href="/products?tab=sale"
              icon={Percent}
              label="Run a sale"
            />
          </div>
        </Panel>

        <Panel title="Catalog" bodyClassName="p-3" viewAllHref="/products">
          <dl className="grid grid-cols-3 gap-3 text-center">
            <CatalogStat label="Products" value={catalog.products} />
            <CatalogStat label="Published" value={catalog.published} />
            <CatalogStat label="Variants" value={catalog.variants} />
            <CatalogStat label="Categories" value={catalog.categories} />
            <CatalogStat label="Media" value={catalog.media} />
            <CatalogStat label="Sections" value={catalog.contentSections} />
          </dl>
        </Panel>

        <Panel
          title="Recent activity"
          bodyClassName="p-0"
          viewAllHref="/settings?tab=activity"
        >
          <Suspense fallback={<TableSkeleton rows={4} />}>
            <ActivityFeed />
          </Suspense>
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

async function RevenueChartSection({ preset }: { preset: RangePreset }) {
  const series = await getRevenueSeries(preset);
  return <RevenueChart data={series} />;
}

async function OrderPipeline() {
  const breakdown = await getOrderStatusBreakdown();
  const total = breakdown.reduce((sum, row) => sum + row.count, 0);

  if (total === 0) {
    return (
      <p className="text-muted-foreground px-4 py-8 text-center text-xs">
        No orders to break down yet.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {breakdown.map((row) => {
        const meta = ORDER_STATUS_META[row.status as OrderStatus];
        return (
          <li
            key={row.status}
            className="flex items-center gap-3 px-4 py-2"
          >
            <StatusPill
              label={meta?.label ?? row.status}
              tone={meta?.tone ?? "neutral"}
            />
            <div className="bg-muted ml-auto h-1 w-16 overflow-hidden rounded-full">
              <div
                className="bg-chart-1 h-full rounded-full"
                style={{ width: `${(row.count / total) * 100}%` }}
              />
            </div>
            <span data-numeric className="w-8 text-right text-xs font-medium">
              {row.count}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

async function ActivityFeed() {
  const entries = await getRecentActivity(5);

  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground px-4 py-8 text-center text-xs">
        Nothing recorded yet. Every change an admin makes is logged here.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {entries.map((entry) => (
        <li key={entry.id} className="px-4 py-2.5">
          <p className="text-xs leading-snug">{entry.summary}</p>
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            {entry.actorEmail} · {formatIstDateTime(entry.createdAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Button
      asChild
      variant="outline"
      className="h-auto justify-start gap-2 py-2.5"
    >
      <Link href={href as never}>
        <Icon className="size-3.5" />
        <span className="truncate text-xs">{label}</span>
      </Link>
    </Button>
  );
}

function CatalogStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dd data-numeric className="text-lg font-semibold tracking-tight">
        {formatNumber(value)}
      </dd>
      <dt className="text-muted-foreground text-[11px]">{label}</dt>
    </div>
  );
}

function DemoDataNotice() {
  return (
    <div className="border-warning/30 bg-warning-muted/50 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-xs">
      <FlaskConical className="text-warning size-3.5 shrink-0" />
      <span className="font-medium">Sample orders are in this database.</span>
      <span className="text-muted-foreground">
        The storefront never transmits orders, so there was no real history to
        import. Products, media and all content below are real.
      </span>
      <code className="bg-background/60 ml-auto rounded border px-1.5 py-0.5 font-mono text-[11px]">
        npm run db:reset
      </code>
    </div>
  );
}

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-2.5">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-2.5 w-2/5" />
            <Skeleton className="h-2 w-1/4" />
          </div>
          <Skeleton className="h-2.5 w-12" />
        </div>
      ))}
    </div>
  );
}
