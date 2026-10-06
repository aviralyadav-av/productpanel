import { cellText, formatIstTimestamp, paiseToDisplayRupees, toNumber } from "./format";
import type { ExportInput } from "./types";

/**
 * Print view: a self-contained HTML table the operator prints or saves as PDF
 * from the browser. No external CSS or scripts - it must render identically
 * from a file on disk months later. Numbers are right-aligned, money shows as
 * ₹ with two decimals, and `@media print` drops the toolbar and repeats the
 * table header on every page.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function printCell(value: unknown, type: ExportInput["columns"][number]["type"]): string {
  if (type === "money") {
    const paise = toNumber(value);
    return paise === null ? "" : paiseToDisplayRupees(paise);
  }
  return cellText(value, type);
}

const STYLES = `
  :root { color-scheme: light; }
  body { font: 12px/1.4 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 24px; background: #fff; }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 16px; }
  header h1 { font-size: 18px; margin: 0; }
  header .meta { font-size: 11px; color: #555; text-align: right; }
  .toolbar { margin: 0 0 12px; }
  .toolbar button { font: inherit; padding: 6px 14px; border: 1px solid #333; background: #fff; border-radius: 4px; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tbody tr:nth-child(even) { background: #fafafa; }
  tfoot td { border: none; padding-top: 12px; color: #555; font-size: 11px; }
  @media print {
    body { margin: 0; }
    .toolbar { display: none; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    @page { margin: 12mm; }
  }
`;

export async function printResponse(input: ExportInput): Promise<Response> {
  const storeName = input.storeName ?? "DIY Baazar";
  const title = input.title ?? input.filename;
  const generatedAt = formatIstTimestamp(new Date());

  const head = input.columns
    .map((column) => {
      const numeric = column.type === "money" || column.type === "number";
      return `<th${numeric ? ' class="num"' : ""}>${escapeHtml(column.label)}</th>`;
    })
    .join("");

  const bodyRows: string[] = [];
  let rowCount = 0;
  for await (const row of input.rows as AsyncIterable<Record<string, unknown>>) {
    rowCount += 1;
    const cells = input.columns
      .map((column) => {
        const numeric = column.type === "money" || column.type === "number";
        return `<td${numeric ? ' class="num"' : ""}>${escapeHtml(printCell(row[column.key], column.type))}</td>`;
      })
      .join("");
    bodyRows.push(`<tr>${cells}</tr>`);
  }
  await input.onComplete?.(rowCount);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`${title} - ${storeName}`)}</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <h1>${escapeHtml(storeName)} &mdash; ${escapeHtml(title)}</h1>
  <div class="meta">Generated ${escapeHtml(generatedAt)} IST<br>${rowCount.toLocaleString("en-IN")} row${rowCount === 1 ? "" : "s"}</div>
</header>
<div class="toolbar"><button type="button" onclick="window.print()">Print</button></div>
<table>
  <thead><tr>${head}</tr></thead>
  <tbody>${bodyRows.join("\n")}</tbody>
  <tfoot><tr><td colspan="${input.columns.length}">Amounts in INR. Times in IST (Asia/Kolkata).</td></tr></tfoot>
</table>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      // Printed reports are viewed, not saved-as by default.
      "Content-Disposition": "inline",
    },
  });
}
