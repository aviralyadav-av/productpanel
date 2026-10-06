/**
 * Minimal RFC 4180 CSV codec for the attribute import/export round trip.
 *
 * src/lib/export is for REPORTS: it defuses formula injection by prefixing
 * cells with an apostrophe and formats money/dates for humans. Neither is
 * wanted in a file the operator edits in a spreadsheet and uploads back, so
 * this codec writes values verbatim (quoted when needed) and parses quotes,
 * embedded newlines and both line endings. Pure - tested with node:test.
 */

export function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

/** Parse into rows of cells; a trailing empty line is dropped, a UTF-8 BOM is ignored. */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((line) => line.some((value) => value.trim().length > 0));
}

/** Split a multi-value cell ("red|blue") into trimmed, de-duplicated parts. */
export function splitMulti(cell: string): string[] {
  return [...new Set(cell.split("|").map((part) => part.trim()).filter(Boolean))];
}
