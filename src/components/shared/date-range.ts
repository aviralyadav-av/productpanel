import {
  addDays,
  endOfIstDay,
  startOfIstDay,
  type DateRange,
} from "@/lib/dates";
import { one, type SearchParams } from "@/lib/list-params";

/**
 * The `?range=&from=&to=` contract shared by DateRangePicker (writes) and
 * every list/report page (reads via resolveDateRangeParams).
 *
 * This extends the rolling presets in src/lib/dates.ts with calendar-aligned
 * ones ("this month") that reports need and the dashboard does not. Everything
 * is computed in IST because that is the store's business day; see dates.ts
 * for why that is plain arithmetic.
 */

export const DATE_RANGE_PRESETS = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "this_month",
  "last_month",
  "this_year",
  "custom",
] as const;

export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

export const DATE_RANGE_PRESET_LABELS: Record<DateRangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  this_month: "This month",
  last_month: "Last month",
  this_year: "This year",
  custom: "Custom",
};

export type ResolvedDateRange = DateRange & { preset: DateRangePreset };

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** IST calendar parts of an instant, for month/year alignment. */
function istParts(date: Date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() };
}

/** UTC instant for IST midnight at the start of (year, month, day). */
function istDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - IST_OFFSET_MS);
}

function isPreset(value: string | undefined): value is DateRangePreset {
  return !!value && (DATE_RANGE_PRESETS as readonly string[]).includes(value);
}

/** Parses "YYYY-MM-DD" as an IST calendar day; anything else is undefined. */
export function parseIstDay(value: string | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000+05:30`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** "YYYY-MM-DD" of the IST day containing `date`, for URL params. */
export function toIstDayParam(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(1, Math.round((to.getTime() + 1 - from.getTime()) / MS_PER_DAY));
}

export function resolvePreset(
  preset: Exclude<DateRangePreset, "custom">,
  now = new Date(),
): ResolvedDateRange {
  const label = DATE_RANGE_PRESET_LABELS[preset];
  const { year, month } = istParts(now);
  let from: Date;
  let to: Date;

  switch (preset) {
    case "today":
      from = startOfIstDay(now);
      to = endOfIstDay(now);
      break;
    case "yesterday":
      from = startOfIstDay(addDays(now, -1));
      to = endOfIstDay(addDays(now, -1));
      break;
    case "7d":
      from = startOfIstDay(addDays(now, -6));
      to = endOfIstDay(now);
      break;
    case "30d":
      from = startOfIstDay(addDays(now, -29));
      to = endOfIstDay(now);
      break;
    case "this_month":
      from = istDate(year, month, 1);
      to = endOfIstDay(now);
      break;
    case "last_month":
      from = istDate(year, month - 1, 1);
      to = new Date(istDate(year, month, 1).getTime() - 1);
      break;
    case "this_year":
      from = istDate(year, 0, 1);
      to = endOfIstDay(now);
      break;
  }

  return { from, to, days: daysBetween(from, to), label, preset };
}

/**
 * Reads the range a page should query for. Precedence:
 *   1. `range=<preset>` other than custom: the preset wins, from/to ignored
 *   2. valid `from` and/or `to`: a custom range (open ends fall back to today)
 *   3. nothing usable: `fallback` (default: last 30 days)
 *
 * `to` is inclusive and is widened to the end of its IST day, so
 * `?from=2026-09-01&to=2026-09-01` covers the whole of 1 September.
 */
export function resolveDateRangeParams(
  searchParams: SearchParams | URLSearchParams,
  fallback: Exclude<DateRangePreset, "custom"> = "30d",
  now = new Date(),
): ResolvedDateRange {
  const read = (key: string) =>
    searchParams instanceof URLSearchParams
      ? searchParams.get(key) ?? undefined
      : one(searchParams, key);

  const preset = read("range");
  if (isPreset(preset) && preset !== "custom") return resolvePreset(preset, now);

  const fromParam = parseIstDay(read("from"));
  const toParam = parseIstDay(read("to"));

  if (fromParam || toParam) {
    let from = fromParam ?? toParam!;
    let to = endOfIstDay(toParam ?? now);
    if (to < from) [from, to] = [startOfIstDay(to), endOfIstDay(from)];
    return {
      from,
      to,
      days: daysBetween(from, to),
      label: formatRangeLabel(from, to),
      preset: "custom",
    };
  }

  return resolvePreset(fallback, now);
}

const IST_SHORT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** "01 Sep 2026 - 07 Sep 2026", or a single day when from and to coincide. */
export function formatRangeLabel(from: Date, to: Date): string {
  const a = IST_SHORT.format(from);
  const b = IST_SHORT.format(to);
  return a === b ? a : `${a} - ${b}`;
}
