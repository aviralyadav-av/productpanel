import "server-only";

import { writeAudit } from "@/lib/audit";
import type { AuditActor } from "@/lib/audit";
import { exportRows, type ExportColumn, type ExportFormat, type ExportRow } from "@/lib/export";

import {
  loadDashboardCharts,
  loadDashboardKpis,
  loadTopProducts,
  loadTopSellers,
  ORDER_GROUPS,
  rangeInfo,
  type DashboardRange,
} from "./data";

/**
 * The dashboard export (blueprint §1 "Export CSV/XLSX", D14 formats).
 *
 * A dashboard is many small tables rather than one long list, so it exports
 * as a single tall sheet with a `section` column instead of one sheet per
 * widget: that survives CSV, opens as a pivot table in Excel, and keeps the
 * printable HTML readable. Counts and money live in separate typed columns so
 * a spreadsheet never sums rupees and order counts into the same total.
 *
 * The whole thing fits comfortably in memory (a few hundred rows even for a
 * year at daily buckets), so unlike the list exports it does not stream
 * through paginateAll - it is assembled once and handed over.
 */

const COLUMNS: readonly ExportColumn[] = [
  { key: "section", label: "Section" },
  { key: "metric", label: "Metric" },
  { key: "period", label: "Period" },
  { key: "count", label: "Count", type: "number" },
  { key: "amountPaise", label: "Amount", type: "money" },
];

export type DashboardExportInput = {
  format: ExportFormat;
  range: DashboardRange;
  actor: AuditActor;
  /** Module permissions the actor holds; sections they cannot see are omitted. */
  allowed: (permission: string) => boolean;
  ip?: string | null;
  now?: Date;
};

function row(section: string, metric: string, period: string, count: number, amountPaise: number): ExportRow {
  return { section, metric, period, count, amountPaise };
}

/**
 * Builds every row the actor is allowed to see. The permission gate is the
 * same one the page applies (D14: widgets bound to module permissions and
 * omitted server-side), so an export can never leak a widget the screen hid.
 */
async function buildRows(input: DashboardExportInput): Promise<ExportRow[]> {
  const { range, allowed } = input;
  const info = rangeInfo(range);
  const period = `${info.from} to ${info.to}`;
  const seeOrders = allowed("orders.view");

  const [kpis, charts, products, sellers] = await Promise.all([
    loadDashboardKpis(range, input.now),
    seeOrders ? loadDashboardCharts(range) : null,
    allowed("products.view") ? loadTopProducts(range, 20) : null,
    allowed("sellers.view") ? loadTopSellers(range, 20) : null,
  ]);

  const rows: ExportRow[] = [];

  for (const tile of kpis.tiles) {
    if (!allowed(tile.permission)) continue;
    rows.push(
      row(
        tile.group === "range" ? "KPI (selected range)" : "KPI (current)",
        tile.label,
        tile.group === "range" ? period : info.to,
        tile.format === "money" ? 0 : tile.raw,
        tile.format === "money" ? tile.raw : 0,
      ),
    );
  }

  if (charts) {
    for (const point of charts.revenue) {
      rows.push(row("Revenue", "Revenue", point.key, 0, Number(point.revenuePaise)));
      rows.push(row("Revenue", "Net sales", point.key, 0, Number(point.netSalesPaise)));
      rows.push(row("Revenue", "Refunded", point.key, 0, Number(point.refundedPaise)));
    }
    for (const point of charts.orders) {
      for (const group of ORDER_GROUPS) {
        rows.push(row("Orders by status", group.label, point.key, Number(point[group.key] ?? 0), 0));
      }
    }
    for (const point of charts.units) {
      rows.push(row("Product sales", "Units sold", point.key, Number(point.units), Number(point.itemRevenuePaise)));
    }
    for (const item of charts.categories) {
      rows.push(row("Category sales", item.label, period, 0, item.value));
    }
    for (const item of charts.payments) {
      rows.push(row("Payment methods", item.label, period, 0, item.value));
    }
    if (allowed("customers.view")) {
      for (const point of charts.customers) {
        rows.push(row("Customer growth", "New customers", point.key, Number(point.count), 0));
        rows.push(row("Customer growth", "Total customers", point.key, Number(point.cumulative), 0));
      }
    }
    if (allowed("sellers.view")) {
      for (const point of charts.sellers) {
        rows.push(row("Seller growth", "Registered", point.key, Number(point.count), 0));
        rows.push(row("Seller growth", "Activated", point.key, Number(point.activated), 0));
      }
    }
  }

  for (const product of products ?? []) {
    rows.push(row("Top products", product.title, period, product.units, product.revenuePaise));
  }
  for (const seller of sellers ?? []) {
    rows.push(row("Top sellers", seller.name, period, seller.orders, seller.grossPaise));
  }

  return rows;
}

export async function exportDashboard(input: DashboardExportInput): Promise<Response> {
  const info = rangeInfo(input.range);
  const rows = await buildRows(input);

  return exportRows({
    format: input.format,
    filename: `dashboard-${info.from}-to-${info.to}`,
    title: `Dashboard — ${info.label}`,
    columns: COLUMNS,
    rows,
    onComplete: (rowCount) =>
      writeAudit({
        actor: input.actor,
        action: "dashboard.export",
        entityType: "dashboard",
        entityId: null,
        entityLabel: "Dashboard",
        summary: `Exported the dashboard (${info.from} to ${info.to}) as ${input.format.toUpperCase()}: ${rowCount} row${rowCount === 1 ? "" : "s"}.`,
        diff: { from: info.from, to: info.to, preset: info.preset, bucket: info.bucket, rowCount },
        ip: input.ip ?? null,
      }),
  });
}
