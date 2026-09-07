/**
 * Analytics day boundaries.
 *
 * The store operates in India, and India has no daylight saving time, so
 * Asia/Kolkata is a fixed UTC+05:30 offset. That means the correct IST day
 * boundary can be computed with plain arithmetic and no timezone library -
 * which is one fewer dependency and one fewer thing to get wrong.
 *
 * Timestamps are stored in UTC. Only the bucketing and the display are IST.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Start of the IST day containing `date`, expressed as a UTC instant. */
export function startOfIstDay(date: Date): Date {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MINUTES * 60_000);
}

export function endOfIstDay(date: Date): Date {
  return new Date(startOfIstDay(date).getTime() + MS_PER_DAY - 1);
}

/** "2026-09-04" for the IST day containing `date`. Used as a bucket key. */
export function istDayKey(date: Date): string {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export type DateRange = { from: Date; to: Date; days: number; label: string };

export const RANGE_PRESETS = {
  today: { days: 1, label: "Today" },
  "7d": { days: 7, label: "Last 7 days" },
  "30d": { days: 30, label: "Last 30 days" },
  "90d": { days: 90, label: "Last 90 days" },
} as const;

export type RangePreset = keyof typeof RANGE_PRESETS;

export function resolveRange(preset: RangePreset = "30d"): DateRange {
  const config = RANGE_PRESETS[preset] ?? RANGE_PRESETS["30d"];
  const now = new Date();
  const to = endOfIstDay(now);
  const from = startOfIstDay(addDays(now, -(config.days - 1)));
  return { from, to, days: config.days, label: config.label };
}

/** The equally sized window immediately before `range`, for comparisons. */
export function previousRange(range: DateRange): DateRange {
  const to = new Date(range.from.getTime() - 1);
  const from = startOfIstDay(addDays(range.from, -range.days));
  return { from, to, days: range.days, label: `Previous ${range.days} days` };
}

/** Every IST day key in the range, so chart gaps render as zero, not absent. */
export function dayKeysInRange(range: DateRange): string[] {
  const keys: string[] = [];
  let cursor = startOfIstDay(range.from);
  while (cursor <= range.to) {
    keys.push(istDayKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return keys;
}

const IST_DATE = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
});

const IST_DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatIstDate(date: Date): string {
  return IST_DATE.format(date);
}

export function formatIstDateTime(date: Date): string {
  return IST_DATE_TIME.format(date);
}

/** "04 Sep" from a YYYY-MM-DD bucket key, for chart axes. */
export function formatDayKey(key: string): string {
  return IST_DATE.format(new Date(`${key}T00:00:00Z`));
}
