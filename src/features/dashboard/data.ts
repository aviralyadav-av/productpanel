import "server-only";

import {
  DATE_RANGE_PRESET_LABELS,
  resolveDateRangeParams,
  toIstDayParam,
  type DateRangePreset,
  type ResolvedDateRange,
} from "@/components/shared/date-range";
import { previousRange, type DateRange } from "@/lib/dates";
import { PAYMENT_METHODS, PAYMENT_METHOD_META, type OrderStatus } from "@/lib/enums";
import type { SearchParams } from "@/lib/list-params";
import {
  customerGrowthSeries,
  defaultBucketFor,
  kpiSnapshot,
  newCustomerCount,
  orderCountSeries,
  productSalesSeries,
  refundSummary,
  revenueSeries,
  revenueTotals,
  salesByCategory,
  sellerGrowthSeries,
  topProducts,
  topSellers,
  type Bucket,
  type KpiSnapshot,
  type MetricRange,
  type RevenueBucket,
} from "@/features/reports/metrics";

import { buildKpiTiles } from "./kpis";
import { supportQueueCount } from "./queries";
import type {
  DashboardCharts,
  DashboardRangeInfo,
  KpiTile,
  NamedValue,
  SeriesPoint,
  TopProductRow,
  TopSellerRow,
} from "./types";

/**
 * The dashboard's data loaders.
 *
 * Rule for this file (blueprint E4, and the reason the dashboard exists as a
 * thin module): it never writes a metric query of its own. Every figure comes
 * from `@/features/reports/metrics`, so a number on the dashboard and the same
 * number on the matching report cannot drift - same IST bucketing, same
 * revenue definition, same exclusion of CANCELLED / FAILED orders. Only the
 * things a report does not answer (recent rows, alerts, the demo banner) live
 * in ./queries.ts.
 *
 * Each loader is independently awaitable so the page can wrap it in its own
 * Suspense boundary and one slow or failing widget cannot take the page down.
 */

/** The default window when the URL says nothing. */
export const DEFAULT_DASHBOARD_PRESET: Exclude<DateRangePreset, "custom"> = "30d";

export type DashboardRange = ResolvedDateRange & {
  bucket: Bucket;
  previous: DateRange;
  /** `from=YYYY-MM-DD&to=YYYY-MM-DD`, for deep links into filtered lists. */
  query: string;
};

/**
 * Reads `?range=|from=&to=` with the shared resolver, so the DateRangePicker
 * and this page can never disagree about what "last month" means, and picks
 * the bucket from the range length (a year of daily points is unreadable).
 */
export function resolveDashboardRange(
  searchParams: SearchParams | URLSearchParams,
  now = new Date(),
): DashboardRange {
  const range = resolveDateRangeParams(searchParams, DEFAULT_DASHBOARD_PRESET, now);
  return {
    ...range,
    bucket: defaultBucketFor(range.days),
    previous: previousRange(range),
    query: `from=${toIstDayParam(range.from)}&to=${toIstDayParam(range.to)}`,
  };
}

export function rangeInfo(range: DashboardRange): DashboardRangeInfo {
  return {
    from: toIstDayParam(range.from),
    to: toIstDayParam(range.to),
    label: range.preset === "custom" ? range.label : DATE_RANGE_PRESET_LABELS[range.preset],
    preset: range.preset,
    days: range.days,
    bucket: range.bucket,
    previousLabel: range.previous.label,
  };
}

// ---------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------

export type DashboardKpis = {
  tiles: KpiTile[];
  snapshot: KpiSnapshot;
  current: RevenueBucket;
  previous: RevenueBucket;
};

function sumRefunds(groups: readonly { count: number; amountPaise: number }[]) {
  return groups.reduce(
    (acc, row) => ({ count: acc.count + row.count, amountPaise: acc.amountPaise + row.amountPaise }),
    { count: 0, amountPaise: 0 },
  );
}

/**
 * Every tile in one round trip. The point-in-time counters come from
 * kpiSnapshot() (one call, ~17 parallel aggregates inside it); the
 * range-scoped ones are revenueTotals() over the selected window and the one
 * immediately before it, which is what makes the deltas comparable.
 */
export async function loadDashboardKpis(range: DashboardRange, now = new Date()): Promise<DashboardKpis> {
  const window: MetricRange = { from: range.from, to: range.to };
  const prior: MetricRange = { from: range.previous.from, to: range.previous.to };

  const [snapshot, current, previous, newCustomers, previousNewCustomers, refunds, previousRefunds, support] =
    await Promise.all([
      kpiSnapshot(now),
      revenueTotals(window),
      revenueTotals(prior),
      newCustomerCount(window),
      newCustomerCount(prior),
      refundSummary(window, { groupBy: "status" }),
      refundSummary(prior, { groupBy: "status" }),
      supportQueueCount(),
    ]);

  const tiles = buildKpiTiles({
    snapshot,
    current,
    previous,
    newCustomers,
    previousNewCustomers,
    refunds: sumRefunds(refunds),
    previousRefunds: sumRefunds(previousRefunds),
    supportOpen: support,
    rangeQuery: range.query,
    rangeLabel: range.preset === "custom" ? range.label : DATE_RANGE_PRESET_LABELS[range.preset],
  });

  return { tiles, snapshot, current, previous };
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

/**
 * Twelve order statuses cannot be five chart colours, and a legend with
 * twelve entries is not read. The pipeline is folded into the five states an
 * operator actually thinks in; the mapping is exhaustive so no order is lost
 * from the totals.
 */
export const ORDER_GROUPS = [
  { key: "pending", label: "Pending", statuses: ["PENDING"] },
  { key: "processing", label: "Processing", statuses: ["CONFIRMED", "PROCESSING", "PACKED"] },
  { key: "shipped", label: "Shipped", statuses: ["SHIPPED", "OUT_FOR_DELIVERY"] },
  { key: "delivered", label: "Delivered", statuses: ["DELIVERED", "RETURN_REQUESTED", "RETURNED", "REFUNDED"] },
  { key: "lost", label: "Cancelled or failed", statuses: ["CANCELLED", "FAILED"] },
] as const satisfies readonly { key: string; label: string; statuses: readonly OrderStatus[] }[];

/** Keep the chart readable: the biggest slices, then one honest "Other". */
function foldTail(rows: NamedValue[], keep: number): NamedValue[] {
  if (rows.length <= keep) return rows;
  const head = rows.slice(0, keep);
  const tail = rows.slice(keep);
  const rest = tail.reduce((sum, row) => sum + row.value, 0);
  if (rest <= 0) return head;
  return [...head, { key: "__other", label: `Other (${tail.length})`, value: rest }];
}

/**
 * One loader per chart rather than one loader for all seven.
 *
 * The page gives every chart its own Suspense boundary so a slow or failing
 * widget cannot take the others down (task requirement 6); a single bundled
 * loader would defeat that - all seven would await the slowest, and one
 * rejection would blank the whole row. Each loader here issues exactly the
 * queries its own chart needs.
 */
export async function loadRevenueChart(range: DashboardRange): Promise<SeriesPoint[]> {
  const rows = await revenueSeries(windowOf(range), { bucket: range.bucket });
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    revenuePaise: row.revenuePaise,
    netSalesPaise: row.netSalesPaise,
    refundedPaise: row.refundedPaise,
  }));
}

export async function loadOrdersChart(range: DashboardRange): Promise<SeriesPoint[]> {
  const rows = await orderCountSeries(windowOf(range), { bucket: range.bucket });
  return rows.map((row) => {
    const point: SeriesPoint = { key: row.key, label: row.label };
    for (const group of ORDER_GROUPS) {
      point[group.key] = group.statuses.reduce((sum, status) => sum + row.byStatus[status], 0);
    }
    return point;
  });
}

export async function loadCustomerGrowthChart(range: DashboardRange): Promise<SeriesPoint[]> {
  const rows = await customerGrowthSeries(windowOf(range), { bucket: range.bucket });
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    count: row.count,
    cumulative: row.cumulative,
  }));
}

export async function loadSellerGrowthChart(range: DashboardRange): Promise<SeriesPoint[]> {
  const rows = await sellerGrowthSeries(windowOf(range), { bucket: range.bucket });
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    count: row.count,
    activated: row.activated,
  }));
}

export async function loadUnitsChart(range: DashboardRange): Promise<SeriesPoint[]> {
  const rows = await productSalesSeries(windowOf(range), { bucket: range.bucket });
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    units: row.units,
    itemRevenuePaise: row.itemRevenuePaise,
  }));
}

/** Root categories only: a leaf-level donut of 60 categories reads as noise. */
export async function loadCategorySales(range: DashboardRange): Promise<NamedValue[]> {
  const rows = await salesByCategory(windowOf(range), { level: "root" });
  const named: NamedValue[] = rows
    .map((row) => ({ key: row.path ?? "__none", label: row.name, value: row.itemRevenuePaise }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
  return foldTail(named, 7);
}

/**
 * Payment split. COD and prepaid revenue answer a real operational question
 * (how much cash is riding on delivery), so this is revenue per method rather
 * than a count of orders.
 */
export async function loadPaymentSplit(range: DashboardRange): Promise<NamedValue[]> {
  const window = windowOf(range);
  const totals = await Promise.all(
    PAYMENT_METHODS.map(async (method) => ({
      method,
      totals: await revenueTotals(window, { paymentMethod: method }),
    })),
  );
  return totals
    .map(({ method, totals: row }) => ({
      key: method,
      label: PAYMENT_METHOD_META[method].label,
      value: row.revenuePaise,
    }))
    .filter((row) => row.value > 0);
}

function windowOf(range: DashboardRange): MetricRange {
  return { from: range.from, to: range.to };
}

/**
 * Every chart at once. The page does NOT use this (see above); the export and
 * the JSON API do, because they produce one document and would otherwise have
 * to sequence seven awaits by hand.
 */
export async function loadDashboardCharts(range: DashboardRange): Promise<DashboardCharts> {
  const [revenue, orders, customers, sellers, units, categories, payments] = await Promise.all([
    loadRevenueChart(range),
    loadOrdersChart(range),
    loadCustomerGrowthChart(range),
    loadSellerGrowthChart(range),
    loadUnitsChart(range),
    loadCategorySales(range),
    loadPaymentSplit(range),
  ]);

  return { revenue, orders, customers, sellers, units, categories, payments };
}

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

export async function loadTopProducts(range: DashboardRange, limit = 8): Promise<TopProductRow[]> {
  const { rows } = await topProducts(
    { from: range.from, to: range.to },
    { limit, by: "units", byProduct: true },
  );
  return rows.map((row) => ({
    productId: row.productId,
    title: row.title,
    units: row.units,
    revenuePaise: row.itemRevenuePaise,
    sellerName: row.sellerName,
  }));
}

export async function loadTopSellers(range: DashboardRange, limit = 8): Promise<TopSellerRow[]> {
  const { rows } = await topSellers({ from: range.from, to: range.to }, { limit, by: "gross" });
  return rows.map((row) => ({
    sellerId: row.sellerId,
    name: row.name,
    orders: row.orders,
    grossPaise: row.sellerGrossPaise,
    payablePaise: row.sellerPayablePaise,
  }));
}

// ---------------------------------------------------------------------------
// Permission redaction (D14) for the JSON API
// ---------------------------------------------------------------------------

/**
 * The KPI snapshot with the sections the actor may not see removed.
 *
 * The screen omits a widget server-side; the API has to do the same, or
 * `GET /api/admin/dashboard` becomes a hole through which an operator with
 * only `dashboard.view` + `orders.view` reads customer and seller totals the
 * page refuses to render (D14).
 */
export function redactSnapshot(
  snapshot: KpiSnapshot,
  allowed: (permission: string) => boolean,
): Partial<KpiSnapshot> & Pick<KpiSnapshot, "asOf"> {
  return {
    asOf: snapshot.asOf,
    ...(allowed("orders.view") ? { revenue: snapshot.revenue, orders: snapshot.orders } : {}),
    ...(allowed("returns.view") ? { returns: snapshot.returns } : {}),
    ...(allowed("refunds.view") ? { refunds: snapshot.refunds } : {}),
    ...(allowed("customers.view") ? { customers: snapshot.customers } : {}),
    ...(allowed("sellers.view") ? { sellers: snapshot.sellers } : {}),
    ...(allowed("products.view") ? { products: snapshot.products } : {}),
    ...(allowed("reviews.view") ? { reviews: snapshot.reviews } : {}),
    ...(allowed("inquiries.view") ? { inquiries: snapshot.inquiries } : {}),
  };
}

/** The chart bundle with series the actor may not see removed. */
export function redactCharts(
  charts: DashboardCharts,
  allowed: (permission: string) => boolean,
): Partial<DashboardCharts> {
  const seeOrders = allowed("orders.view");
  const seeProducts = allowed("products.view");
  return {
    ...(seeOrders ? { revenue: charts.revenue, orders: charts.orders, payments: charts.payments } : {}),
    ...(seeProducts ? { units: charts.units, categories: charts.categories } : {}),
    ...(allowed("customers.view") ? { customers: charts.customers } : {}),
    ...(allowed("sellers.view") ? { sellers: charts.sellers } : {}),
  };
}
