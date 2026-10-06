import "server-only";

import {
  loadCategorySales,
  loadCustomerGrowthChart,
  loadDashboardKpis,
  loadOrdersChart,
  loadPaymentSplit,
  loadRevenueChart,
  loadSellerGrowthChart,
  loadTopProducts,
  loadTopSellers,
  loadUnitsChart,
  ORDER_GROUPS,
  type DashboardRange,
} from "../data";
import {
  dashboardAlerts,
  recentActivity,
  recentCustomers,
  recentOrders,
  recentReviews,
  recentSellers,
} from "../queries";
import { AlertsPanel } from "./alerts-panel";
import {
  CategorySalesChart,
  CustomerGrowthChart,
  OrdersTrendChart,
  PaymentSplitChart,
  RevenueTrendChart,
  SellerGrowthChart,
  UnitsChart,
} from "./dashboard-charts";
import {
  ActivityPanel,
  RecentCustomersPanel,
  RecentOrdersPanel,
  RecentReviewsPanel,
  RecentSellersPanel,
  TopProductsPanel,
  TopSellersPanel,
} from "./dashboard-lists";
import { KpiGrid } from "./kpi-grid";
import { SafePanel } from "./safe-panel";

/**
 * One async Server Component per widget: fetch, then hand plain rows to a
 * presentational component.
 *
 * The page mounts each of these inside its own <Suspense>, so the shell, the
 * header and the fast widgets paint immediately and a slow aggregate only
 * holds up its own panel. SafePanel adds the other half of that isolation -
 * a rejected query becomes an ErrorState inside the panel instead of a
 * 500 for the whole route.
 *
 * `allowed` is the actor's permission predicate. It is applied HERE, on the
 * server, because D14 requires widgets the actor cannot see to be omitted
 * rather than hidden; the page decides whether to mount a panel at all, and
 * these functions only re-apply it where one widget mixes two modules.
 */

type PanelProps = { range: DashboardRange; now?: Date };

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export function KpiSection({
  range,
  allowed,
  now,
}: PanelProps & { allowed: (permission: string) => boolean }) {
  return (
    <SafePanel label="Key metrics" load={() => loadDashboardKpis(range, now)}>
      {(kpis) => (
        <div className="space-y-4">
          <KpiGrid
            title="Selected period"
            description={`${range.label} · compared with the ${range.previous.days} days before it`}
            tiles={kpis.tiles.filter((tile) => tile.group === "range")}
            allowed={allowed}
          />
          <KpiGrid
            title="Right now"
            description="Point-in-time counters and work queues; these ignore the date range"
            tiles={kpis.tiles.filter((tile) => tile.group === "now")}
            allowed={allowed}
          />
        </div>
      )}
    </SafePanel>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

export function RevenueChartPanel({ range }: PanelProps) {
  return (
    <SafePanel label="Revenue chart" load={() => loadRevenueChart(range)}>
      {(data) => (
        <div className="p-3">
          <RevenueTrendChart data={data} />
        </div>
      )}
    </SafePanel>
  );
}

export function OrdersChartPanel({ range }: PanelProps) {
  return (
    <SafePanel label="Orders chart" load={() => loadOrdersChart(range)}>
      {(data) => (
        <div className="p-3">
          <OrdersTrendChart
            data={data}
            series={ORDER_GROUPS.map((group) => ({ key: group.key, label: group.label }))}
          />
        </div>
      )}
    </SafePanel>
  );
}

export function CustomerGrowthPanel({ range }: PanelProps) {
  return (
    <SafePanel label="Customer growth chart" load={() => loadCustomerGrowthChart(range)}>
      {(data) => (
        <div className="p-3">
          <CustomerGrowthChart data={data} />
        </div>
      )}
    </SafePanel>
  );
}

export function SellerGrowthPanel({ range }: PanelProps) {
  return (
    <SafePanel label="Seller growth chart" load={() => loadSellerGrowthChart(range)}>
      {(data) => (
        <div className="p-3">
          <SellerGrowthChart data={data} />
        </div>
      )}
    </SafePanel>
  );
}

export function UnitsChartPanel({ range }: PanelProps) {
  return (
    <SafePanel label="Product sales chart" load={() => loadUnitsChart(range)}>
      {(data) => (
        <div className="p-3">
          <UnitsChart data={data} />
        </div>
      )}
    </SafePanel>
  );
}

export function CategorySalesPanel({ range }: PanelProps) {
  return (
    <SafePanel label="Category sales chart" load={() => loadCategorySales(range)}>
      {(data) => (
        <div className="p-3">
          <CategorySalesChart data={data} />
        </div>
      )}
    </SafePanel>
  );
}

export function PaymentSplitPanel({ range }: PanelProps) {
  return (
    <SafePanel label="Payment split chart" load={() => loadPaymentSplit(range)}>
      {(data) => (
        <div className="p-3">
          <PaymentSplitChart data={data} />
        </div>
      )}
    </SafePanel>
  );
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export function TopProductsListPanel({ range }: PanelProps) {
  return (
    <SafePanel label="Top products" load={() => loadTopProducts(range, 8)}>
      {(rows) => <TopProductsPanel rows={rows} />}
    </SafePanel>
  );
}

export function TopSellersListPanel({ range }: PanelProps) {
  return (
    <SafePanel label="Top sellers" load={() => loadTopSellers(range, 8)}>
      {(rows) => <TopSellersPanel rows={rows} />}
    </SafePanel>
  );
}

export function RecentOrdersListPanel() {
  return (
    <SafePanel label="Recent orders" load={() => recentOrders(8)}>
      {(rows) => <RecentOrdersPanel rows={rows} />}
    </SafePanel>
  );
}

export function RecentCustomersListPanel() {
  return (
    <SafePanel label="Recent customers" load={() => recentCustomers(6)}>
      {(rows) => <RecentCustomersPanel rows={rows} />}
    </SafePanel>
  );
}

export function RecentSellersListPanel() {
  return (
    <SafePanel label="Recent seller registrations" load={() => recentSellers(6)}>
      {(rows) => <RecentSellersPanel rows={rows} />}
    </SafePanel>
  );
}

export function RecentReviewsListPanel() {
  return (
    <SafePanel label="Recent reviews" load={() => recentReviews(6)}>
      {(rows) => <RecentReviewsPanel rows={rows} />}
    </SafePanel>
  );
}

export function ActivityListPanel() {
  return (
    <SafePanel label="Recent activity" load={() => recentActivity(15)}>
      {(rows) => <ActivityPanel rows={rows} />}
    </SafePanel>
  );
}

/**
 * Alerts mix six modules, so the permission filter runs per row rather than
 * per panel: an operator who can see inventory but not payouts gets the stock
 * alerts and is not told about money they cannot move (D14).
 */
export function AlertsListPanel({ allowed }: { allowed: (permission: string) => boolean }) {
  return (
    <SafePanel label="Alerts" load={() => dashboardAlerts()}>
      {(alerts) => <AlertsPanel alerts={alerts.filter((alert) => allowed(alert.permission))} />}
    </SafePanel>
  );
}
