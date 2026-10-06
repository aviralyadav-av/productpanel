import { csvResponse } from "./csv";
import { printResponse } from "./print";
import { EXPORT_PAGE_SIZE, type ExportFormat, type ExportInput, type ExportRow } from "./types";
import { xlsxResponse } from "./xlsx";

export type { ExportColumn, ExportColumnType, ExportFormat, ExportInput, ExportRow, ExportRows } from "./types";
export { EXPORT_PAGE_SIZE, XLSX_MAX_ROWS } from "./types";
export { csvCell, csvLine } from "./csv";
export { cellText, formatIstTimestamp, paiseToDisplayRupees, paiseToPlainRupees, safeFilename } from "./format";

/**
 * Export entry point (blueprint E4 `format=csv|xlsx|print`, D13, D15, G6).
 *
 *   return exportRows({
 *     format, filename: "orders-2026-09",
 *     columns: [{ key: "orderNumber", label: "Order" }, { key: "totalPaise", label: "Total", type: "money" }, ...],
 *     rows: paginateAll((skip, take) => db.order.findMany({ where, skip, take, orderBy })),
 *     onComplete: (count) => writeAudit({ actor, action: "orders.export", summary: `${count} rows`, ... }),
 *   });
 *
 * The caller owns permission checks and the audit row; `onComplete` hands it
 * the row count the audit needs, which is only known once streaming finished.
 */

export const EXPORT_FORMATS: readonly ExportFormat[] = ["csv", "xlsx", "print"];

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === "string" && (EXPORT_FORMATS as readonly string[]).includes(value);
}

/** Parse `?format=` with CSV as the default; unknown values fall back to CSV. */
export function parseExportFormat(value: string | null | undefined): ExportFormat {
  return isExportFormat(value) ? value : "csv";
}

export async function exportRows(input: ExportInput): Promise<Response> {
  const normalized: ExportInput = { ...input, rows: toAsyncIterable(input.rows) };
  switch (normalized.format) {
    case "xlsx":
      return xlsxResponse(normalized);
    case "print":
      return printResponse(normalized);
    default:
      return csvResponse(normalized);
  }
}

async function* toAsyncIterable(rows: ExportInput["rows"]): AsyncIterable<ExportRow> {
  if (Symbol.asyncIterator in rows) {
    for await (const row of rows as AsyncIterable<ExportRow>) yield row;
    return;
  }
  for (const row of rows as Iterable<ExportRow>) yield row;
}

/**
 * Turn a paged Prisma query into a row stream. `fetchPage(skip, take)` is
 * called until it returns fewer rows than `take`, so a 300k-row table is read
 * 5,000 rows at a time and the CSV writer never holds more than one page.
 *
 * Callers MUST pass a deterministic `orderBy` (id as a tiebreaker) or rows can
 * repeat or vanish between pages while the table is being written to.
 *
 * `fetchPage` MUST return exactly what its query returned - a short page is
 * how this loop learns the stream ended. Dropping rows inside the callback
 * (filtering in JS, skipping a row that fails a lookup) therefore truncates
 * the export at the first page that loses even one row, silently. Push the
 * condition into the SQL - or into a pre-computed id list - instead. Reshaping
 * a row is fine, and belongs in `options.map`.
 */
export async function* paginateAll<T extends ExportRow>(
  fetchPage: (skip: number, take: number) => Promise<T[]>,
  options: { pageSize?: number; map?: (row: T) => ExportRow | Promise<ExportRow> } = {},
): AsyncIterable<ExportRow> {
  const take = Math.max(1, Math.min(options.pageSize ?? EXPORT_PAGE_SIZE, EXPORT_PAGE_SIZE));
  let skip = 0;
  for (;;) {
    const page = await fetchPage(skip, take);
    for (const row of page) yield options.map ? await options.map(row) : row;
    if (page.length < take) return;
    skip += take;
  }
}
