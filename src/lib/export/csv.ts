import { cellText, safeFilename } from "./format";
import type { ExportColumn, ExportInput } from "./types";

/**
 * Streaming CSV (blueprint G6, D15).
 *
 * Streamed through a ReadableStream so a 200k-row order export never sits in
 * memory as one string and the browser starts receiving bytes immediately.
 *
 * Formula injection (D15): a cell that begins with `=`, `+`, `-`, `@`, tab or
 * CR is executed as a formula by Excel/Sheets/LibreOffice when the file is
 * opened, so `=HYPERLINK(...)` in a customer's "note" field becomes a
 * phishing link on the accountant's screen. Such cells are prefixed with a
 * single quote, which spreadsheets render as literal text. Numeric-typed
 * columns are exempt (a negative amount must stay a number).
 *
 * A UTF-8 BOM is emitted first because Excel on Windows otherwise reads ₹
 * and Devanagari as mojibake. Line endings are CRLF per RFC 4180.
 */

const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);
const BOM = String.fromCharCode(0xfeff);

/** Quote per RFC 4180 and defuse formula triggers. Exported for the unit test. */
export function csvCell(value: unknown, type: ExportColumn["type"] = "string"): string {
  let text = cellText(value, type);
  if (text === "") return "";

  const numeric = type === "number" || type === "money";
  if (!numeric && FORMULA_TRIGGERS.has(text[0])) text = `'${text}`;

  const needsQuotes = /[",\r\n]/.test(text) || text.startsWith("'") || text !== text.trim();
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: readonly string[]): string {
  return `${values.join(",")}\r\n`;
}

async function* iterate(rows: ExportInput["rows"]) {
  for await (const row of rows as AsyncIterable<Record<string, unknown>>) yield row;
}

export function csvResponse(input: ExportInput): Response {
  const encoder = new TextEncoder();
  const columns = input.columns;
  const iterator = iterate(input.rows);
  let rowCount = 0;
  let headerSent = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!headerSent) {
          headerSent = true;
          controller.enqueue(
            encoder.encode(BOM + csvLine(columns.map((column) => csvCell(column.label)))),
          );
          return;
        }

        // Batch a few hundred rows per chunk: one enqueue per row makes the
        // stream machinery the bottleneck, one per export defeats streaming.
        const chunk: string[] = [];
        while (chunk.length < 500) {
          const next = await iterator.next();
          if (next.done) break;
          rowCount += 1;
          chunk.push(csvLine(columns.map((column) => csvCell(next.value[column.key], column.type))));
        }
        if (chunk.length > 0) controller.enqueue(encoder.encode(chunk.join("")));

        if (chunk.length < 500) {
          await input.onComplete?.(rowCount);
          controller.close();
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename(input.filename, "csv")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
