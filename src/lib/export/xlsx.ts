import { ApiError } from "@/lib/api/errors";
import { IST_OFFSET_MS, safeFilename, toDate, toNumber } from "./format";
import type { ExportInput } from "./types";
import { XLSX_MAX_ROWS } from "./types";

/**
 * XLSX via exceljs (blueprint G6).
 *
 * exceljs is imported lazily: it is ~1 MB of code that only the export
 * endpoints need, and a lazy import keeps it out of every other route's
 * module graph. The workbook is built in memory - exceljs's streaming writer
 * needs a Node stream and a temp file - so rows are hard-capped at
 * XLSX_MAX_ROWS; beyond that the caller gets a 422 telling the operator to
 * use CSV, which streams without limit.
 *
 * Cells keep their types: money is a number with a ₹ format so it sums in
 * Excel; dates are real date cells shifted to IST (Excel dates have no zone),
 * so sorting and filtering work.
 */

const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

function defuse(text: string): string {
  return text !== "" && FORMULA_TRIGGERS.has(text[0]) ? `'${text}` : text;
}

function cellValue(value: unknown, type: ExportInput["columns"][number]["type"]): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "money": {
      const paise = toNumber(value);
      return paise === null ? null : paise / 100;
    }
    case "number":
      return toNumber(value);
    case "date": {
      const date = toDate(value);
      return date ? new Date(date.getTime() + IST_OFFSET_MS) : null;
    }
    case "boolean":
      return value === true || value === "true" ? "Yes" : value === false || value === "false" ? "No" : null;
    default:
      return defuse(typeof value === "object" ? JSON.stringify(value) : String(value));
  }
}

export async function xlsxResponse(input: ExportInput): Promise<Response> {
  const buffered: Record<string, unknown>[] = [];
  for await (const row of input.rows as AsyncIterable<Record<string, unknown>>) {
    buffered.push(row);
    if (buffered.length > XLSX_MAX_ROWS) {
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        `This export has more than ${XLSX_MAX_ROWS.toLocaleString("en-IN")} rows. Use the CSV format instead.`,
        { format: "Use CSV for exports above 100,000 rows." },
      );
    }
  }

  // exceljs is CommonJS. Next's bundler synthesises named exports for it, but
  // plain Node (the job worker and every `npx tsx` check script) hands back a
  // namespace whose only key is `default` - reading `.Workbook` off it there
  // throws "not a constructor". Accept whichever shape the loader gave us.
  const excelModule = await import("exceljs");
  const ExcelJS: typeof excelModule.default = excelModule.default ?? excelModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = input.storeName ?? "DIY Baazar";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet((input.title ?? input.filename).replace(/[\\/*?:[\]]/g, " ").slice(0, 31) || "Export");
  sheet.columns = input.columns.map((column) => ({
    header: column.label,
    key: column.key,
    width: Math.min(60, Math.max(12, column.label.length + 4)),
    style:
      column.type === "money"
        ? { numFmt: '"₹"#,##0.00' }
        : column.type === "date"
          ? { numFmt: "dd-mmm-yyyy hh:mm" }
          : undefined,
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const row of buffered) {
    const values: Record<string, unknown> = {};
    for (const column of input.columns) values[column.key] = cellValue(row[column.key], column.type);
    sheet.addRow(values);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  await input.onComplete?.(buffered.length);

  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeFilename(input.filename, "xlsx")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
