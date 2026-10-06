import type { ExportColumnType } from "./types";

/**
 * Value rendering shared by every export format. Kept format-agnostic so the
 * CSV, XLSX and print writers agree on what "a date" or "₹1,234.50" means.
 * IST is a fixed +05:30 (no DST), see src/lib/dates.ts.
 */

const IST_DATE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const INR_PRECISE = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** "2026-09-04 14:05:33" in IST - sortable as text, unambiguous to a reader. */
export function formatIstTimestamp(date: Date): string {
  // en-CA gives yyyy-mm-dd; the comma separator between date and time varies
  // by ICU version so it is normalised away.
  return IST_DATE_TIME.format(date).replace(",", "");
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Paise → "1234.50" (plain, machine-friendly; CSV). */
export function paiseToPlainRupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(paise));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Paise → "₹1,234.50" (display; print view). */
export function paiseToDisplayRupees(paise: number): string {
  return INR_PRECISE.format(paise / 100);
}

/**
 * Text form of a cell for CSV and print. Money is plain rupees here; the
 * print writer swaps in the display form itself. Null/undefined → "".
 */
export function cellText(value: unknown, type: ExportColumnType = "string"): string {
  if (value === null || value === undefined) return "";
  switch (type) {
    case "money": {
      const paise = toNumber(value);
      return paise === null ? "" : paiseToPlainRupees(paise);
    }
    case "number": {
      const number = toNumber(value);
      return number === null ? "" : String(number);
    }
    case "date": {
      const date = toDate(value);
      return date ? formatIstTimestamp(date) : "";
    }
    case "boolean":
      return value === true || value === "true" ? "Yes" : value === false || value === "false" ? "No" : "";
    default:
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
  }
}

/** Reject path separators, quotes and control chars; keep it ASCII-safe. */
export function safeFilename(name: string, extension: string): string {
  const base =
    name
      .replace(/\.[A-Za-z0-9]+$/, "")
      .replace(/[^A-Za-z0-9._ -]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 80) || "export";
  return `${base}.${extension}`;
}
