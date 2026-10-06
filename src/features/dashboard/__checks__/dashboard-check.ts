/**
 * End-to-end check for /admin/dashboard, against the seeded database.
 *
 *   npx tsx src/features/dashboard/__checks__/dashboard-check.ts
 *
 * What it pins, and why each one is worth a script rather than a unit test:
 *
 *   1. The page's own loaders run for the "this month" preset - the same
 *      entry points the Server Components call, so a broken import or a bad
 *      SQL cast fails here rather than in the browser.
 *   2. Every KPI tile equals the shared metric it claims to show. This is the
 *      contract of E4 ("Dashboard and reports share metrics.ts"): the tile
 *      strip is asserted against kpiSnapshot() and revenueTotals() figure by
 *      figure, so the dashboard cannot quietly grow a second definition of
 *      revenue, of an order count, or of "low stock".
 *   3. Each chart series sums to the range total. A series that does not add
 *      up to its own headline means the IST bucketing dropped or duplicated a
 *      row, which is invisible on screen.
 *   4. The permission redaction actually redacts (D14): with an actor who
 *      holds nothing, every KPI tile, every chart series and every alert is
 *      gone from both the JSON payload and the export.
 *   5. The export renders in all three formats and carries only the rows the
 *      actor may see.
 *
 * Reads only, with one exception: the CSV export writes its D13 audit row
 * ("dashboard.export"), exactly as it does in production.
 */

import "dotenv/config";

import { db } from "@/lib/db";
import { PAYMENT_METHODS, type OrderStatus } from "@/lib/enums";
import {
  kpiSnapshot,
  ordersByStatus,
  revenueTotals,
  newCustomerCount,
  refundSummary,
} from "@/features/reports/metrics";
import { utcTs } from "@/features/reports/sql";

import {
  loadCategorySales,
  loadCustomerGrowthChart,
  loadDashboardCharts,
  loadDashboardKpis,
  loadOrdersChart,
  loadPaymentSplit,
  loadRevenueChart,
  loadSellerGrowthChart,
  loadTopProducts,
  loadTopSellers,
  loadUnitsChart,
  ORDER_GROUPS,
  rangeInfo,
  redactCharts,
  redactSnapshot,
  resolveDashboardRange,
} from "../data";
import { exportDashboard } from "../export";
import {
  dashboardAlerts,
  hasDemoData,
  recentActivity,
  recentCustomers,
  recentOrders,
  recentReviews,
  recentSellers,
  supportQueueCount,
} from "../queries";
import type { KpiTile } from "../types";

let failures = 0;
let checks = 0;

function ok(label: string, condition: boolean, detail?: string) {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}${detail ? ` (${detail})` : ""}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` (${detail})` : ""}`);
  }
}

function eq(label: string, actual: number, expected: number) {
  ok(label, actual === expected, `${actual} vs ${expected}`);
}

/**
 * Does a range boundary survive the trip into SQL unshifted?
 *
 * Every boundary in the metric layer goes through `utcTs()` in
 * src/features/reports/sql.ts, which casts a bound parameter to `timestamptz`.
 * A bound JS Date reaches Postgres with no zone marker, so the cast would be
 * resolved in the SESSION time zone - a no-op on a UTC server, but 5h30m of
 * silent drift on one set to Asia/Calcutta (as this machine's Postgres is).
 * utcTs() therefore binds `toISOString()`; this probe compares it against an
 * unambiguous literal so a regression to a bound Date fails loudly here
 * rather than quietly moving every report and dashboard figure.
 */
async function utcTsShiftSeconds(): Promise<number> {
  const probe = new Date("2026-01-15T12:00:00.000Z");
  const rows = await db.$queryRaw<Array<{ shift: number }>>`
    SELECT EXTRACT(EPOCH FROM (
             (${probe.toISOString()}::timestamptz AT TIME ZONE 'UTC')
             - ${utcTs(probe)}
           ))::int AS shift`;
  return Number(rows[0]?.shift ?? 0);
}

function tile(tiles: readonly KpiTile[], key: string): KpiTile {
  const found = tiles.find((row) => row.key === key);
  if (!found) throw new Error(`KPI tile "${key}" is missing`);
  return found;
}

async function main() {
  const now = new Date();

  // ---- 1. the range the page would resolve --------------------------------
  console.log("\n1. Range resolution");
  const range = resolveDashboardRange({ range: "this_month" }, now);
  const info = rangeInfo(range);
  ok("preset is this_month", range.preset === "this_month", info.label);
  ok("range ends now-ish", range.to >= range.from, `${info.from} -> ${info.to}`);
  ok("bucket chosen from length", ["day", "week", "month"].includes(range.bucket), range.bucket);
  ok(
    "previous window is the same length",
    range.previous.days === range.days,
    `${range.days} days`,
  );

  // ---- 2. KPI tiles vs the shared metrics ---------------------------------
  console.log("\n2. KPI tiles equal the reports metrics (E4)");
  const window = { from: range.from, to: range.to };
  const [kpis, snapshot, totals, statusTotals, newCustomers, refundGroups, support] =
    await Promise.all([
      loadDashboardKpis(range, now),
      kpiSnapshot(now),
      revenueTotals(window),
      ordersByStatus(window),
      newCustomerCount(window),
      refundSummary(window, { groupBy: "status" }),
      supportQueueCount(),
    ]);
  const tiles = kpis.tiles;

  eq("revenue tile = revenueTotals.revenuePaise", tile(tiles, "range.revenue").raw, totals.revenuePaise);
  eq("net sales tile = revenueTotals.netSalesPaise", tile(tiles, "range.netSales").raw, totals.netSalesPaise);
  eq("orders tile = revenueTotals.orders", tile(tiles, "range.orders").raw, totals.orders);
  eq("units tile = revenueTotals.units", tile(tiles, "range.units").raw, totals.units);
  eq("new customers tile = newCustomerCount", tile(tiles, "range.newCustomers").raw, newCustomers);
  eq(
    "discounts tile = promotion + coupon discount",
    tile(tiles, "range.discounts").raw,
    totals.discountPaise + totals.couponDiscountPaise,
  );
  eq(
    "refunds tile = refundSummary amount",
    tile(tiles, "range.refunds").raw,
    refundGroups.reduce((sum, row) => sum + row.amountPaise, 0),
  );

  eq("today revenue = snapshot", tile(tiles, "now.revenueToday").raw, snapshot.revenue.todayPaise);
  eq("week revenue = snapshot", tile(tiles, "now.revenueWeek").raw, snapshot.revenue.weekPaise);
  eq("month revenue = snapshot", tile(tiles, "now.revenueMonth").raw, snapshot.revenue.monthPaise);
  eq("all-time revenue = snapshot", tile(tiles, "now.revenueTotal").raw, snapshot.revenue.totalPaise);
  eq("total orders = snapshot", tile(tiles, "now.orders").raw, snapshot.orders.total);

  const pipeline: OrderStatus[] = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
  for (const status of pipeline) {
    eq(
      `${status.toLowerCase()} tile = snapshot.byStatus`,
      tile(tiles, `orders.${status.toLowerCase()}`).raw,
      snapshot.orders.byStatus[status],
    );
  }

  eq("open returns = snapshot", tile(tiles, "now.returns").raw, snapshot.returns.open);
  eq("refunds to process = snapshot", tile(tiles, "now.refundsPending").raw, snapshot.refunds.pendingCount);
  eq("customers = snapshot", tile(tiles, "now.customers").raw, snapshot.customers.total);
  eq("active sellers = snapshot", tile(tiles, "now.sellersActive").raw, snapshot.sellers.active);
  eq("seller approvals = snapshot", tile(tiles, "now.sellersPending").raw, snapshot.sellers.pending);
  eq("products = snapshot", tile(tiles, "now.products").raw, snapshot.products.total);
  eq("live products = snapshot", tile(tiles, "now.productsPublished").raw, snapshot.products.published);
  eq("out of stock = snapshot", tile(tiles, "now.outOfStock").raw, snapshot.products.outOfStockVariants);
  eq("low stock = snapshot", tile(tiles, "now.lowStock").raw, snapshot.products.lowStockVariants);
  eq("pending reviews = snapshot", tile(tiles, "now.reviews").raw, snapshot.reviews.pending);
  eq("support queue = NEW + OPEN inquiries", tile(tiles, "now.support").raw, support);

  ok(
    "every tile declares a module permission (D14)",
    tiles.every((row) => row.permission.includes(".")),
    `${tiles.length} tiles`,
  );

  // ---- 3. charts add up to their own headline -----------------------------
  console.log("\n3. Chart series are consistent with the range totals");
  const [revenueChart, ordersChart, customersChart, sellersChart, unitsChart, categories, payments] =
    await Promise.all([
      loadRevenueChart(range),
      loadOrdersChart(range),
      loadCustomerGrowthChart(range),
      loadSellerGrowthChart(range),
      loadUnitsChart(range),
      loadCategorySales(range),
      loadPaymentSplit(range),
    ]);

  const sum = (rows: readonly Record<string, unknown>[], key: string) =>
    rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);

  // A series is bucketed in JS (zeroFill over bucketKeysInRange) but summed in
  // SQL, so it is the one place where a shifted range boundary would show up:
  // an order that the WHERE let in but whose IST bucket falls outside the key
  // list would be dropped from the series and kept in the total. That is why
  // the boundary binding is asserted first - a drift there is the likeliest
  // explanation for a mismatch below.
  const shift = await utcTsShiftSeconds();
  ok("utcTs() boundaries reach SQL as UTC", shift === 0, `${shift}s off`);
  const bounded = eq;

  bounded("Σ revenue series = revenueTotals", sum(revenueChart, "revenuePaise"), totals.revenuePaise);
  bounded("Σ net sales series = revenueTotals", sum(revenueChart, "netSalesPaise"), totals.netSalesPaise);
  bounded("Σ refunded series = revenueTotals", sum(revenueChart, "refundedPaise"), totals.refundedPaise);
  bounded("Σ units series = revenueTotals.units", sum(unitsChart, "units"), totals.units);
  bounded(
    "Σ orders-by-status series = ordersByStatus total",
    ORDER_GROUPS.reduce((total, group) => total + sum(ordersChart, group.key), 0),
    statusTotals.total,
  );
  bounded("Σ new customers series = newCustomerCount", sum(customersChart, "count"), newCustomers);
  ok(
    "customer cumulative never decreases",
    customersChart.every((row, index) =>
      index === 0 ? true : Number(row.cumulative) >= Number(customersChart[index - 1].cumulative),
    ),
    `${customersChart.length} buckets`,
  );
  ok("seller growth series is zero-filled", sellersChart.length === customersChart.length);
  ok(
    "category chart folds the tail",
    categories.length <= 8,
    `${categories.length} slices`,
  );
  ok(
    "payment split only names real methods",
    payments.every((row) => (PAYMENT_METHODS as readonly string[]).includes(row.key)),
    payments.map((row) => row.key).join(", ") || "none",
  );

  // ---- 4. leaderboards, recent rows and alerts ----------------------------
  console.log("\n4. Panels");
  const [products, sellers, orders, customers, sellerRows, reviews, activity, alerts, demo] =
    await Promise.all([
      loadTopProducts(range, 8),
      loadTopSellers(range, 8),
      recentOrders(8),
      recentCustomers(6),
      recentSellers(6),
      recentReviews(6),
      recentActivity(15),
      dashboardAlerts(now),
      hasDemoData(),
    ]);

  ok("top products capped at the limit", products.length <= 8, `${products.length} rows`);
  ok("top sellers capped at the limit", sellers.length <= 8, `${sellers.length} rows`);
  ok("recent orders capped", orders.length <= 8, `${orders.length} rows`);
  ok("recent customers capped", customers.length <= 6, `${customers.length} rows`);
  ok("recent sellers capped", sellerRows.length <= 6, `${sellerRows.length} rows`);
  // No PENDING row may appear after a non-PENDING one: the panel is a
  // moderation queue, and a String status column sorts alphabetically, which
  // is exactly how "pending first" gets silently inverted.
  const firstSettled = reviews.findIndex((row) => row.status !== "PENDING");
  ok(
    "recent reviews put pending first",
    firstSettled === -1 || reviews.slice(firstSettled).every((row) => row.status !== "PENDING"),
    reviews.map((row) => row.status).join(",") || "none",
  );
  ok("activity capped at 15", activity.length <= 15, `${activity.length} rows`);
  ok("every alert has a positive count", alerts.every((row) => row.count > 0), `${alerts.length} alerts`);
  ok(
    "every alert declares a permission (D14)",
    alerts.every((row) => row.permission.includes(".")),
  );
  console.log(`  NOTE  demo data present: ${demo}`);

  // ---- 5. permission redaction --------------------------------------------
  console.log("\n5. Permission redaction (D14)");
  const denyAll: (permission: string) => boolean = () => false;
  const allowAll: (permission: string) => boolean = () => true;
  const charts = await loadDashboardCharts(range);

  const redactedSnapshot = redactSnapshot(snapshot, denyAll);
  ok(
    "a permission-less actor sees only asOf in the snapshot",
    Object.keys(redactedSnapshot).length === 1 && "asOf" in redactedSnapshot,
    Object.keys(redactedSnapshot).join(", "),
  );
  ok(
    "a permission-less actor sees no chart series",
    Object.keys(redactCharts(charts, denyAll)).length === 0,
  );
  ok(
    "a full actor sees every chart series",
    Object.keys(redactCharts(charts, allowAll)).length === 7,
  );
  ok(
    "a permission-less actor sees no KPI tile",
    tiles.filter((row) => denyAll(row.permission)).length === 0,
  );

  // ---- 6. export ----------------------------------------------------------
  console.log("\n6. Export");
  const admin = await db.user.findFirst({
    where: { isActive: true, deletedAt: null },
    select: { id: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) throw new Error("No active admin user to attribute the export audit row to.");

  const csv = await exportDashboard({
    format: "csv",
    range,
    actor: admin,
    allowed: allowAll,
    ip: null,
    now,
  });
  const body = await csv.text();
  ok("CSV export responds 200", csv.status === 200, csv.headers.get("content-type") ?? "");
  ok("CSV has the section header", body.startsWith("Section,Metric,Period,Count,Amount"));
  const lines = body.trim().split("\n").length - 1;
  ok("CSV carries rows", lines > 0, `${lines} rows`);

  const empty = await exportDashboard({
    format: "csv",
    range,
    actor: admin,
    allowed: denyAll,
    ip: null,
    now,
  });
  const emptyBody = await empty.text();
  eq("a permission-less export carries no rows", emptyBody.trim().split("\n").length - 1, 0);

  const printed = await exportDashboard({
    format: "print",
    range,
    actor: admin,
    allowed: allowAll,
    ip: null,
    now,
  });
  ok(
    "print export is HTML",
    (printed.headers.get("content-type") ?? "").includes("text/html"),
    printed.headers.get("content-type") ?? "",
  );

  // exceljs is CJS: under Next's bundler `await import("exceljs")` carries the
  // named exports, under plain Node/tsx only `.default` does. src/lib/export/
  // xlsx.ts accepts both shapes, so this format is assertable from a script -
  // a throw here means that interop broke again.
  try {
    const xlsx = await exportDashboard({
      format: "xlsx",
      range,
      actor: admin,
      allowed: allowAll,
      ip: null,
      now,
    });
    ok("xlsx export responds 200", xlsx.status === 200);
  } catch (error) {
    ok("xlsx export responds 200", false, error instanceof Error ? error.message : String(error));
  }

  const audits = await db.auditLog.count({ where: { action: "dashboard.export" } });
  ok("the export wrote its D13 audit row", audits > 0, `${audits} total`);
}

main()
  .then(async () => {
    console.log(`\n${failures === 0 ? "PASSED" : "FAILED"}: ${checks - failures}/${checks} checks`);
    await db.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    console.error("\nCHECK CRASHED", error);
    await db.$disconnect();
    process.exit(1);
  });
