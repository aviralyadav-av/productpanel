import { pincodeSchema } from "@/lib/validation";

import { canonicalStateName } from "@/features/shipping/india";

/**
 * Pincode serviceability CSV: the template the admin downloads, the parser
 * the import route runs, and the row validation between them. No server or
 * React imports so the same code builds the template in the browser and is
 * unit-tested with plain node:test (csv.test.ts).
 *
 * Parser: RFC 4180 - comma-separated fields, optional double quotes, a quote
 * inside a quoted field doubled, CRLF or LF record ends, a trailing newline
 * tolerated, a UTF-8 BOM ignored. No `;` dialects: every spreadsheet's "Save
 * as CSV" produces exactly this, and a courier's export does too.
 *
 * Cell semantics are "empty means unchanged": an operator re-importing a
 * courier file with only pincode + serviceable columns must not wipe the city
 * and zone they typed by hand last month. Creates fill the blanks with the
 * column defaults instead.
 */

export const PINCODE_CSV_COLUMNS = [
  "pincode",
  "city",
  "state",
  "zone",
  "serviceable",
  "cod",
  "estimatedDays",
] as const;
export type PincodeCsvColumn = (typeof PINCODE_CSV_COLUMNS)[number];

/** Hard cap per upload (task brief). Beyond this the file is refused, not truncated. */
export const MAX_PINCODE_IMPORT_ROWS = 50_000;

/** Import batches: createMany + updates per transaction. */
export const PINCODE_IMPORT_BATCH_SIZE = 1_000;

/** Header spellings couriers actually use, mapped onto our column names. */
const HEADER_ALIASES: Record<string, PincodeCsvColumn> = {
  pincode: "pincode",
  pin: "pincode",
  pin_code: "pincode",
  postalcode: "pincode",
  postal_code: "pincode",
  zip: "pincode",
  city: "city",
  district: "city",
  town: "city",
  state: "state",
  statename: "state",
  state_name: "state",
  zone: "zone",
  zonename: "zone",
  zone_name: "zone",
  zoneid: "zone",
  zone_id: "zone",
  serviceable: "serviceable",
  isserviceable: "serviceable",
  is_serviceable: "serviceable",
  service: "serviceable",
  cod: "cod",
  codavailable: "cod",
  cod_available: "cod",
  estimateddays: "estimatedDays",
  estimated_days: "estimatedDays",
  estimateddelivery: "estimatedDays",
  days: "estimatedDays",
  tat: "estimatedDays",
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

  // Blank lines (a lone "" record) are noise, not rows.
  return records.filter((row) => row.some((cell) => cell.trim() !== ""));
}

/** Quote a cell when it needs it; also defuse spreadsheet formula injection. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: ReadonlyArray<string | number | boolean | null | undefined>): string {
  return cells.map(csvCell).join(",");
}

/** The downloadable template: header plus two illustrative rows. */
export function pincodeCsvTemplate(): string {
  return [
    csvLine(PINCODE_CSV_COLUMNS),
    csvLine(["110001", "New Delhi", "Delhi", "", "yes", "yes", "3"]),
    csvLine(["744101", "Port Blair", "Andaman and Nicobar Islands", "", "yes", "no", "9"]),
  ].join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Parsing into raw rows
// ---------------------------------------------------------------------------

/** One data row as text, with the 1-based line for error messages. */
export type RawPincodeRow = {
  line: number;
} & Record<PincodeCsvColumn, string>;

export type ParsedPincodeCsv = {
  rows: RawPincodeRow[];
  /** Columns the header actually carried (after alias mapping). */
  columns: PincodeCsvColumn[];
  /** File-level problems: missing header, unknown layout, too many rows. */
  errors: string[];
};

function normalizeHeader(cell: string): string {
  return cell
    .trim()
    .toLowerCase()
    .replace(/^﻿/, "")
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function parsePincodeCsv(text: string): ParsedPincodeCsv {
  const records = parseCsv(text);
  if (records.length === 0) {
    return { rows: [], columns: [], errors: ["The file is empty."] };
  }

  const header = records[0].map(normalizeHeader);
  const mapping: Array<PincodeCsvColumn | null> = header.map(
    (cell) => HEADER_ALIASES[cell] ?? HEADER_ALIASES[cell.replace(/_/g, "")] ?? null,
  );
  const columns = mapping.filter((column): column is PincodeCsvColumn => column !== null);

  if (!columns.includes("pincode")) {
    return {
      rows: [],
      columns,
      errors: [
        `The header must include a "pincode" column. Found: ${records[0].map((cell) => cell.trim() || "(blank)").join(", ")}.`,
      ],
    };
  }

  const dataRecords = records.slice(1);
  const errors: string[] = [];
  if (dataRecords.length > MAX_PINCODE_IMPORT_ROWS) {
    errors.push(
      `The file has ${dataRecords.length.toLocaleString("en-IN")} rows; the limit is ${MAX_PINCODE_IMPORT_ROWS.toLocaleString("en-IN")} per import. Split it and import in parts.`,
    );
    return { rows: [], columns, errors };
  }

  const rows: RawPincodeRow[] = dataRecords.map((record, index) => {
    const row: RawPincodeRow = {
      line: index + 2,
      pincode: "",
      city: "",
      state: "",
      zone: "",
      serviceable: "",
      cod: "",
      estimatedDays: "",
    };
    mapping.forEach((column, position) => {
      if (column) row[column] = (record[position] ?? "").trim();
    });
    return row;
  });

  return { rows, columns, errors };
}

// ---------------------------------------------------------------------------
// Validation into normalised rows
// ---------------------------------------------------------------------------

/**
 * A validated row. `undefined` means "the column was blank - leave the stored
 * value alone (update) or use the default (create)"; `null` is an explicit
 * clear ("-" or "none" in the zone column, "-" in estimatedDays).
 */
export type NormalizedPincodeRow = {
  line: number;
  pincode: string;
  city?: string;
  state?: string;
  zoneId?: string | null;
  isServiceable?: boolean;
  codAvailable?: boolean;
  estimatedDays?: number | null;
};

export type PincodeRowError = { line: number; pincode: string; message: string };

export type ZoneLookup = { id: string; name: string };

export type PincodeValidationReport = {
  rows: NormalizedPincodeRow[];
  errors: PincodeRowError[];
  /** Repeated pincodes inside one file are merged; a later row's filled cells win. */
  duplicates: number;
};

const TRUE_WORDS = new Set(["yes", "y", "true", "1", "available", "serviceable", "on"]);
const FALSE_WORDS = new Set(["no", "n", "false", "0", "unavailable", "not serviceable", "non-serviceable", "off"]);
const CLEAR_WORDS = new Set(["-", "none", "null", "clear"]);

/** yes/no cell → boolean; "" → undefined; anything else → null (invalid). */
export function parseBooleanCell(value: string): boolean | undefined | null {
  const text = value.trim().toLowerCase();
  if (text === "") return undefined;
  if (TRUE_WORDS.has(text)) return true;
  if (FALSE_WORDS.has(text)) return false;
  return null;
}

export function validatePincodeRows(
  rows: readonly RawPincodeRow[],
  zones: readonly ZoneLookup[],
): PincodeValidationReport {
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const zoneByName = new Map(zones.map((zone) => [zone.name.trim().toLowerCase(), zone]));

  const byPincode = new Map<string, NormalizedPincodeRow>();
  const errors: PincodeRowError[] = [];
  let duplicates = 0;

  for (const raw of rows) {
    const problems: string[] = [];

    const pincodeResult = pincodeSchema.safeParse(raw.pincode);
    if (!pincodeResult.success) {
      errors.push({ line: raw.line, pincode: raw.pincode, message: "Pincode must be six digits (first digit 1-9)." });
      continue;
    }
    const pincode = pincodeResult.data;
    const row: NormalizedPincodeRow = { line: raw.line, pincode };

    if (raw.city) {
      if (raw.city.length > 120) problems.push("City is longer than 120 characters.");
      else row.city = raw.city;
    }
    if (raw.state) {
      if (raw.state.length > 120) problems.push("State is longer than 120 characters.");
      else row.state = canonicalStateName(raw.state) ?? raw.state;
    }

    if (raw.zone) {
      const zoneText = raw.zone.trim();
      if (CLEAR_WORDS.has(zoneText.toLowerCase())) {
        row.zoneId = null;
      } else {
        const zone = zoneById.get(zoneText) ?? zoneByName.get(zoneText.toLowerCase());
        if (!zone) problems.push(`Unknown zone "${zoneText}". Use a zone name exactly as shown on the Zones tab.`);
        else row.zoneId = zone.id;
      }
    }

    const serviceable = parseBooleanCell(raw.serviceable);
    if (serviceable === null) problems.push(`Serviceable must be yes or no, not "${raw.serviceable}".`);
    else if (serviceable !== undefined) row.isServiceable = serviceable;

    const cod = parseBooleanCell(raw.cod);
    if (cod === null) problems.push(`COD must be yes or no, not "${raw.cod}".`);
    else if (cod !== undefined) row.codAvailable = cod;

    if (raw.estimatedDays) {
      if (CLEAR_WORDS.has(raw.estimatedDays.toLowerCase())) {
        row.estimatedDays = null;
      } else {
        const days = Number(raw.estimatedDays);
        if (!Number.isInteger(days) || days < 0 || days > 60) {
          problems.push(`Estimated days must be a whole number from 0 to 60, not "${raw.estimatedDays}".`);
        } else {
          row.estimatedDays = days;
        }
      }
    }

    if (problems.length > 0) {
      errors.push({ line: raw.line, pincode, message: problems.join(" ") });
      continue;
    }

    // A later row for the same pincode layers on top of the earlier one: its
    // filled cells win, its blank cells keep what the earlier row said.
    const previous = byPincode.get(pincode);
    if (previous) duplicates += 1;
    byPincode.set(pincode, previous ? { ...previous, ...row, line: row.line } : row);
  }

  return { rows: [...byPincode.values()], errors, duplicates };
}
