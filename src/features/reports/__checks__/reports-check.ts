/**
 * End-to-end check for the reports module, against the seeded demo database.
 *
 *   npx tsx src/features/reports/__checks__/reports-check.ts
 *
 * The unit tests (bucketing.test.ts) pin the JavaScript half of IST bucketing;
 * this script pins the half that only the database can answer:
 *
 *   1. every one of the thirteen reports runs, pages and exports without
 *      throwing, over a 90-day range with the demo data in it;
 *   2. the reports that must have data in a seeded marketplace (sales, orders,
 *      sellers, commissions) actually return rows - an empty report that
 *      "succeeds" is the failure mode a smoke test misses;
 *   3. E4's revenue definition is internally consistent: the single-row range
 *      total equals the sum of the per-day series, which can only be true if
 *      `date_trunc(... AT TIME ZONE 'Asia/Kolkata')` buckets every order
 *      exactly once and the JS zero-fill invents nothing;
 *   4. the SQL bucket keys are exactly the keys bucketKeysInRange() predicts,
 *      so Postgres and src/features/reports/bucketing.ts cannot drift apart;
 *   5. kpiSnapshot() - the dashboard's entry point into this module - returns
 *      a coherent snapshot.
 *
 * It reads only; nothing here writes to the database.
 */

import "dotenv/config";

import { db } from "@/lib/db";
import { addDays, endOfIstDay, startOfIstDay, type DateRange } from "@/lib/dates";
import { REPORT_KEYS, type ReportKey } from "@/lib/enums";
import { exportRows, paginateAll } from "@/lib/export";

import { bucketKeysInRange } from "../bucketing";
import { resolveColumns } from "../define";
import { toExportColumns, toExportRow } from "../export-columns";
import { kpiSnapshot, revenueSeries, revenueTotals } from "../metrics";
import { REPORTS } from "../registry";
import type { ReportRunParams } from "../types";

const RANGE_DAYS = 90;
/** Reports a seeded marketplace must be able to fill; the rest may legitimately be empty. */
const MUST_HAVE_ROWS: readonly ReportKey[] = ["sales", "orders", "sellers", "commissions"];

const failures: string[] = [];

function check(label: string, condition: boolean, detail = ""): void {
  const status = condition ? "PASS" : "FAIL";
  console.log(`  ${status}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

function last90Days(now = new Date()): DateRange {
  return {
    from: startOfIstDay(addDays(now, -(RANGE_DAYS - 1))),
    to: endOfIstDay(now),
    days: RANGE_DAYS,
    label: `Last ${RANGE_DAYS} days`,
  };
}

function runParamsFor(key: ReportKey, range: DateRange): ReportRunParams {
  const definition = REPORTS[key];
  return {
    range,
    filters: {},
    sort: definition.defaultSort,
    order: definition.defaultOrder,
    page: 1,
    pageSize: 25,
    skip: 0,
  };
}

async function checkRevenueDefinition(range: DateRange): Promise<void> {
  console.log("\nE4 revenue definition");

  const [totals, series] = await Promise.all([
    revenueTotals(range),
    revenueSeries(range, { bucket: "day" }),
  ]);

  const summed = series.reduce((sum, bucket) => sum + bucket.revenuePaise, 0);
  check(
    "range revenue equals the sum of per-day revenue",
    summed === totals.revenuePaise,
    `total ${totals.revenuePaise} vs series ${summed}`,
  );

  const summedOrders = series.reduce((sum, bucket) => sum + bucket.orders, 0);
  check(
    "range order count equals the sum of per-day counts",
    summedOrders === totals.orders,
    `total ${totals.orders} vs series ${summedOrders}`,
  );

  check(
    "revenue = gross - refunds",
    totals.revenuePaise === totals.grossPaise - totals.refundedPaise,
    `${totals.grossPaise} - ${totals.refundedPaise}`,
  );

  check(
    "net sales = revenue - shipping - COD fee",
    totals.netSalesPaise === totals.revenuePaise - totals.shippingPaise - totals.codFeePaise,
    `${totals.revenuePaise} - ${totals.shippingPaise} - ${totals.codFeePaise}`,
  );

  const expectedKeys = bucketKeysInRange(range, "day");
  const actualKeys = series.map((bucket) => bucket.key);
  check(
    "SQL day buckets match bucketKeysInRange()",
    expectedKeys.length === actualKeys.length && expectedKeys.every((key, index) => key === actualKeys[index]),
    `${actualKeys.length} buckets`,
  );

  const weekly = await revenueSeries(range, { bucket: "week" });
  const weeklyTotal = weekly.reduce((sum, bucket) => sum + bucket.revenuePaise, 0);
  check(
    "weekly buckets sum to the same revenue as daily",
    weeklyTotal === totals.revenuePaise,
    `weekly ${weeklyTotal}`,
  );

  const monthly = await revenueSeries(range, { bucket: "month" });
  const monthlyTotal = monthly.reduce((sum, bucket) => sum + bucket.revenuePaise, 0);
  check(
    "monthly buckets sum to the same revenue as daily",
    monthlyTotal === totals.revenuePaise,
    `monthly ${monthlyTotal}`,
  );

  check("the demo range has revenue at all", totals.revenuePaise > 0, `${totals.revenuePaise} paise`);
}

async function checkReports(range: DateRange): Promise<void> {
  console.log(`\nReports over ${range.label}`);

  for (const key of REPORT_KEYS) {
    const definition = REPORTS[key];
    const params = runParamsFor(key, range);

    try {
      const result = await definition.run(params);

      const rowCount = result.rows.length;
      const detail = `${rowCount} row(s) on page 1 of ${result.meta.total}, ${result.totals.length} total(s), chart ${result.chart?.kind ?? "none"}`;

      if (MUST_HAVE_ROWS.includes(key)) {
        check(`${key}: returns rows`, rowCount > 0, detail);
      } else {
        check(`${key}: runs`, true, detail);
      }

      check(
        `${key}: page never exceeds pageSize`,
        rowCount <= params.pageSize,
        `${rowCount} <= ${params.pageSize}`,
      );

      // Every declared column must exist on a row, or the table renders a
      // column of dashes and nobody notices until an operator asks.
      if (rowCount > 0) {
        const first = result.rows[0];
        const missing = resolveColumns(definition, params).filter((column) => !(column.key in first)).map((column) => column.key);
        check(`${key}: every column has a field on the row`, missing.length === 0, missing.join(", ") || "all present");
      }

      // The default sort must be one of the sortable columns, or the header
      // shows no active sort while the rows are in fact sorted.
      const sortable = definition.columns.filter((column) => column.sortable !== false).map((column) => column.key);
      check(`${key}: default sort is a sortable column`, sortable.includes(definition.defaultSort), definition.defaultSort);

      // The export path is a different query on most reports; run its first page.
      const exported = await definition.exportPage(params, 0, 10);
      check(`${key}: export page runs`, Array.isArray(exported), `${exported.length} row(s)`);

      const headline = await definition.headline(range);
      check(`${key}: headline runs`, typeof headline.value === "number", `${headline.label} = ${headline.value}`);
    } catch (error) {
      check(`${key}: runs`, false, error instanceof Error ? error.message : String(error));
    }
  }
}

/**
 * The export path end to end: report columns → export columns, rows streamed
 * through paginateAll, CSV written by src/lib/export. This is the one place
 * the whole chain runs outside a request, and it catches the failure the JSON
 * path cannot - a column whose value cannot be rendered into a file.
 */
async function checkExportPipeline(range: DateRange): Promise<void> {
  console.log("\nExport pipeline (CSV)");

  for (const key of ["sales", "orders", "sellers"] as const) {
    const definition = REPORTS[key];
    const params = runParamsFor(key, range);
    let counted = -1;

    try {
      const response = await exportRows({
        format: "csv",
        filename: `${key}-check`,
        title: definition.title,
        columns: toExportColumns(resolveColumns(definition, params)),
        rows: paginateAll((skip, take) => definition.exportPage(params, skip, take), {
          pageSize: 500,
          map: (row) => toExportRow(resolveColumns(definition, params), row),
        }),
        onComplete: (rowCount) => {
          counted = rowCount;
        },
      });

      const body = await response.text();
      const lines = body.trim().split("\n");
      const header = lines[0] ?? "";
      const expectedHeader = resolveColumns(definition, params).length;

      check(
        `${key}: CSV header has one field per column`,
        header.split(",").length === expectedHeader,
        `${header.split(",").length} of ${expectedHeader}`,
      );
      check(`${key}: CSV body has rows`, lines.length > 1, `${lines.length - 1} data line(s)`);
      check(`${key}: onComplete reported the row count`, counted === lines.length - 1, `${counted} counted`);
    } catch (error) {
      check(`${key}: CSV export runs`, false, error instanceof Error ? error.message : String(error));
    }
  }
}

/**
 * The refunds report is the only one whose columns depend on the request: its
 * first column holds a return reason, a refund method or a refund status
 * depending on `groupBy`, and the label must come from the matching *_META
 * table. Getting this wrong is invisible in JSON (the raw code still renders)
 * and only shows up as unreadable codes in an exported file, so it is checked
 * on the export path where it would actually be wrong.
 */
async function checkRefundGrouping(range: DateRange): Promise<void> {
  console.log("\nRefunds report regrouping");
  const definition = REPORTS.refunds;

  for (const groupBy of ["reason", "method", "status"] as const) {
    const params = { ...runParamsFor("refunds", range), filters: { groupBy } };
    const columns = resolveColumns(definition, params);
    const group = columns.find((column) => column.key === "group");
    const rows = await definition.run(params);

    check(
      `refunds by ${groupBy}: the group column follows the grouping`,
      group?.statusKind === (groupBy === "reason" ? "returnReason" : groupBy === "method" ? "refundMethod" : "refund"),
      `statusKind ${group?.statusKind}`,
    );

    if (rows.rows.length === 0) {
      check(`refunds by ${groupBy}: has rows`, false, "no refunds in range");
      continue;
    }

    // Every group code must resolve to a label out of its meta table; the
    // fallback returns the code itself, which is what this catches.
    const exported = (await definition.exportPage(params, 0, 50)).map((row) => toExportRow(columns, row));
    const unresolved = exported.filter((row) => row.group === null || row.group === "" || String(row.group) === String(row.group).toUpperCase());
    check(
      `refunds by ${groupBy}: exports labels, not codes`,
      unresolved.length === 0,
      unresolved.length === 0 ? exported.map((row) => String(row.group)).join(", ") : `unresolved: ${unresolved.map((row) => String(row.group)).join(", ")}`,
    );
  }
}

async function checkKpiSnapshot(): Promise<void> {
  console.log("\nDashboard KPI snapshot");
  const snapshot = await kpiSnapshot();

  check("revenue totals are non-negative", snapshot.revenue.totalPaise >= 0, `${snapshot.revenue.totalPaise} paise`);
  check(
    "today's revenue does not exceed the month's",
    snapshot.revenue.todayPaise <= snapshot.revenue.monthPaise || snapshot.revenue.monthPaise === 0,
    `${snapshot.revenue.todayPaise} <= ${snapshot.revenue.monthPaise}`,
  );
  check(
    "order status counts sum to the order total",
    Object.values(snapshot.orders.byStatus).reduce((sum, count) => sum + count, 0) === snapshot.orders.total,
    `${snapshot.orders.total} orders`,
  );
  check("the demo store has products", snapshot.products.total > 0, `${snapshot.products.total}`);
  check("the demo store has sellers", snapshot.sellers.total > 0, `${snapshot.sellers.total}`);
  check("the demo store has customers", snapshot.customers.total > 0, `${snapshot.customers.total}`);
}

async function main(): Promise<void> {
  const range = last90Days();
  console.log(`Reports check — ${range.from.toISOString()} to ${range.to.toISOString()} (IST days)`);

  await checkRevenueDefinition(range);
  await checkReports(range);
  await checkExportPipeline(range);
  await checkRefundGrouping(range);
  await checkKpiSnapshot();

  console.log(`\n${failures.length === 0 ? "All checks passed." : `${failures.length} check(s) FAILED:`}`);
  for (const failure of failures) console.log(`  - ${failure}`);

  await db.$disconnect();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
