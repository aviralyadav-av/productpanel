/**
 * The CSV side of bulk stock updates, with no external dependency and no
 * server imports so the same code can build the template in the browser and
 * parse the upload on the server. Unit-tested in csv.test.ts.
 *
 * Parser: RFC 4180 - fields separated by commas, optionally quoted, a quote
 * inside a quoted field doubled, records ending in CRLF or LF, a trailing
 * newline tolerated, a UTF-8 BOM ignored. Nothing else (no `;` dialects); a
 * spreadsheet's "Save as CSV" produces exactly this.
 */

export const IMPORT_CSV_COLUMNS = ["sku", "mode", "quantity", "reason", "note"] as const;
export type ImportCsvColumn = (typeof IMPORT_CSV_COLUMNS)[number];

/** Optional columns the parser also recognises. */
const OPTIONAL_COLUMNS = ["type"] as const;

export const MAX_IMPORT_ROWS = 2000;

/** One data row as text, with the 1-based line it came from for error messages. */
export type RawImportRow = {
  line: number;
  sku: string;
  mode: string;
  quantity: string;
  reason: string;
  note: string;
  type: string;
};

export type ParsedImportCsv = {
  rows: RawImportRow[];
  /** File-level problems (missing header, too many rows). Row-level ones come from validation. */
  errors: string[];
};

export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      record.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      index += char === "\r" && source[index + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += char;
    index += 1;
  }

  // Last record without a trailing newline.
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  // A blank line is not a record.
  return records.filter((row) => !(row.length === 1 && row[0].trim() === ""));
}

/**
 * Header-driven: columns may come in any order and be capitalised any way;
 * unknown columns are ignored so an operator can keep their own notes beside
 * ours. `sku` and `mode` and `quantity` must be present.
 */
export function parseImportCsv(text: string): ParsedImportCsv {
  const records = parseCsv(text);
  const errors: string[] = [];
  if (records.length === 0) {
    return { rows: [], errors: ["The file is empty."] };
  }

  const header = records[0].map((cell) => cell.trim().toLowerCase());
  const known = new Set<string>([...IMPORT_CSV_COLUMNS, ...OPTIONAL_COLUMNS]);
  const position = new Map<string, number>();
  header.forEach((name, index) => {
    if (known.has(name) && !position.has(name)) position.set(name, index);
  });

  for (const required of ["sku", "mode", "quantity"] as const) {
    if (!position.has(required)) errors.push(`Missing the "${required}" column.`);
  }
  if (errors.length > 0) return { rows: [], errors };

  const dataRecords = records.slice(1);
  if (dataRecords.length > MAX_IMPORT_ROWS) {
    errors.push(`Too many rows: ${dataRecords.length}. Split the file into batches of ${MAX_IMPORT_ROWS}.`);
    return { rows: [], errors };
  }

  const read = (record: string[], name: string) => {
    const column = position.get(name);
    return column === undefined ? "" : (record[column] ?? "").trim();
  };

  const rows = dataRecords.map((record, index) => ({
    // +2: one for the header, one for 1-based numbering.
    line: index + 2,
    sku: read(record, "sku"),
    mode: read(record, "mode"),
    quantity: read(record, "quantity"),
    reason: read(record, "reason"),
    note: read(record, "note"),
    type: read(record, "type"),
  }));

  return { rows, errors };
}

/** Quote a cell for the template only; exports go through src/lib/export. */
function csvQuote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The downloadable template: the header plus example rows to overwrite. */
export function buildImportTemplateCsv(): string {
  const lines = [
    IMPORT_CSV_COLUMNS.join(","),
    ["SKU-0001-01", "add", "12", "Supplier delivery", "PO 4821"].map(csvQuote).join(","),
    ["SKU-0002-01", "remove", "1", "Damaged in storage", ""].map(csvQuote).join(","),
    ["SKU-0003-02", "set", "40", "Stock take", "Counted 8 Sep"].map(csvQuote).join(","),
  ];
  return `${lines.join("\r\n")}\r\n`;
}
