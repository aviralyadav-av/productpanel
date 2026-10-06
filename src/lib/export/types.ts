/**
 * Tabular export contract (blueprint E4, D15, G6).
 *
 * A caller describes columns once and streams rows; the format decides how a
 * value is rendered. `type` matters: money is paise in the database and must
 * come out as rupees, dates must come out in IST, and every string must be
 * defused against spreadsheet formula injection.
 */

export type ExportFormat = "csv" | "xlsx" | "print";

export type ExportColumnType = "string" | "number" | "money" | "date" | "boolean";

export type ExportColumn = {
  /** Property name on each row object. */
  key: string;
  label: string;
  /** Default "string". */
  type?: ExportColumnType;
};

export type ExportRow = Record<string, unknown>;

export type ExportRows = AsyncIterable<ExportRow> | Iterable<ExportRow>;

export type ExportInput = {
  format: ExportFormat;
  /** Without extension; sanitised for Content-Disposition. */
  filename: string;
  columns: readonly ExportColumn[];
  rows: ExportRows;
  /** Printed in the header of the print view and the xlsx sheet name. */
  storeName?: string;
  /** Human title for the print view, e.g. "Orders - Sep 2026". */
  title?: string;
  /** Called once with the row count after the last row was written (D13 audit). */
  onComplete?: (rowCount: number) => void | Promise<void>;
};

/** exceljs builds the workbook in memory; beyond this the caller gets a 422 (G6). */
export const XLSX_MAX_ROWS = 100_000;

/** Prisma page size for paginateAll(); large enough to be fast, small enough to bound memory. */
export const EXPORT_PAGE_SIZE = 5_000;
