import type { ExportColumn, ExportColumnType, ExportRow } from "@/lib/export";

import { statusMeta } from "./schemas";
import type { ReportColumn, ReportColumnType, ReportRow } from "./types";

/**
 * Report columns → export columns (blueprint D15, E4 `format=csv|xlsx|print`).
 *
 * The export must read like the screen, not like the database: a status cell
 * exports its label ("Partially refunded"), not its code; a rate stored in
 * basis points exports as a percentage number a spreadsheet can average; money
 * stays paise here because src/lib/export converts paise → rupees itself.
 * Quoting against formula injection is entirely src/lib/export's job (D15).
 */

const TYPE_MAP: Record<ReportColumnType, ExportColumnType> = {
  string: "string",
  number: "number",
  money: "money",
  date: "date",
  datetime: "date",
  percent: "number",
  bps: "number",
  status: "string",
  boolean: "boolean",
};

export function toExportColumns(columns: readonly ReportColumn[]): ExportColumn[] {
  return columns.map((column) => ({ key: column.key, label: column.label, type: TYPE_MAP[column.type] }));
}

/**
 * One row rendered for export. Only the declared columns survive, so the href
 * and subtitle helper fields a table cell uses never leak into a file, and a
 * column added to the screen later cannot silently change an export's shape.
 */
export function toExportRow(columns: readonly ReportColumn[], row: ReportRow): ExportRow {
  const out: ExportRow = {};
  for (const column of columns) {
    const value = row[column.key];
    if (column.type === "status" && column.statusKind) {
      out[column.key] = statusMeta(column.statusKind, value).label;
    } else if (column.type === "bps") {
      out[column.key] = typeof value === "number" ? value / 100 : value;
    } else {
      out[column.key] = value ?? null;
    }
  }
  return out;
}
