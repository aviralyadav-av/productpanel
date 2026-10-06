import { addDays, dayKeysInRange, formatDayKey, istDayKey, startOfIstDay, type DateRange } from "@/lib/dates";

/**
 * Time buckets for every report and dashboard series (blueprint §11.27, E4).
 *
 * Bucket KEYS are always the IST calendar day the bucket starts on, as
 * "YYYY-MM-DD": a day is its own key, a week is keyed by its Monday, a month
 * by its first day. One key shape means a series of any granularity can be
 * zero-filled, joined and sorted with plain string comparison, and the SQL
 * side (`date_trunc(<bucket>, placedAt AT TIME ZONE 'Asia/Kolkata')`) produces
 * the same keys, so the database and this file can never disagree on which
 * bucket an instant belongs to.
 *
 * India has no daylight saving, so IST is a fixed +05:30 and the arithmetic
 * here needs no timezone library (see src/lib/dates.ts).
 */

export const BUCKETS = ["day", "week", "month"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const BUCKET_LABELS: Record<Bucket, string> = { day: "Daily", week: "Weekly", month: "Monthly" };

export function isBucket(value: unknown): value is Bucket {
  return typeof value === "string" && (BUCKETS as readonly string[]).includes(value);
}

/**
 * The granularity a chart reads best at for a given span: days up to about
 * a month, weeks up to a quarter and a bit, months beyond. Reports let the
 * operator override it; the dashboard takes the default.
 */
export function defaultBucketFor(days: number): Bucket {
  if (days <= 45) return "day";
  if (days <= 190) return "week";
  return "month";
}

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

/** IST calendar parts of an instant (UTC getters on the shifted clock). */
function istParts(date: Date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    /** 0 = Sunday, as Date.getUTCDay(). */
    weekday: shifted.getUTCDay(),
  };
}

/** UTC instant of IST midnight on (year, month, day). */
function istMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - IST_OFFSET_MS);
}

/** Start instant (UTC) of the bucket containing `date`, in IST. Weeks start Monday (ISO, matching date_trunc). */
export function bucketStart(date: Date, bucket: Bucket): Date {
  const parts = istParts(date);
  switch (bucket) {
    case "day":
      return startOfIstDay(date);
    case "week": {
      const sinceMonday = (parts.weekday + 6) % 7;
      return istMidnight(parts.year, parts.month, parts.day - sinceMonday);
    }
    case "month":
      return istMidnight(parts.year, parts.month, 1);
  }
}

/** The "YYYY-MM-DD" key of the bucket containing `date`. */
export function bucketKeyFor(date: Date, bucket: Bucket): string {
  return istDayKey(bucketStart(date, bucket));
}

/** Next bucket start after the bucket that begins at `start`. */
function nextBucketStart(start: Date, bucket: Bucket): Date {
  switch (bucket) {
    case "day":
      return addDays(start, 1);
    case "week":
      return addDays(start, 7);
    case "month": {
      const parts = istParts(start);
      return istMidnight(parts.year, parts.month + 1, 1);
    }
  }
}

/**
 * Every bucket key touching the range, in order, so a chart shows a zero
 * for a quiet week instead of silently bridging the gap. The first key can
 * start before `range.from` (a range starting mid-week still belongs to that
 * week's bucket) - the SQL side truncates the same way, so the keys line up.
 */
export function bucketKeysInRange(range: Pick<DateRange, "from" | "to">, bucket: Bucket): string[] {
  if (bucket === "day") return dayKeysInRange({ ...range, days: 0, label: "" });
  const keys: string[] = [];
  let cursor = bucketStart(range.from, bucket);
  while (cursor <= range.to) {
    keys.push(istDayKey(cursor));
    cursor = nextBucketStart(cursor, bucket);
  }
  return keys;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", month: "short", year: "numeric" });

const BUCKET_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Axis / table label for a bucket key: "04 Sep", "Wk of 04 Sep", "Sep 2026".
 *
 * Aggregate rows carry a sentinel key ("total") rather than a day, so a key
 * that is not a date passes straight through - Intl throws on an invalid
 * Date, and one summary row must never be able to take down a report.
 */
export function bucketLabel(key: string, bucket: Bucket): string {
  if (!BUCKET_KEY.test(key)) return key;
  switch (bucket) {
    case "day":
      return formatDayKey(key);
    case "week":
      return `Wk of ${formatDayKey(key)}`;
    case "month":
      return MONTH_LABEL.format(new Date(`${key}T00:00:00Z`));
  }
}

/**
 * Merge a sparse SQL result (one row per non-empty bucket) onto the full key
 * list. `blank(key)` builds the zero row; rows for keys outside the range
 * (impossible unless the caller's WHERE and range disagree) are dropped.
 */
export function zeroFill<T extends { key: string }>(
  range: Pick<DateRange, "from" | "to">,
  bucket: Bucket,
  rows: readonly T[],
  blank: (key: string) => T,
): T[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return bucketKeysInRange(range, bucket).map((key) => byKey.get(key) ?? blank(key));
}

// ---------------------------------------------------------------------------
// Category path roll-up
// ---------------------------------------------------------------------------

export type CategoryLevel = "root" | "leaf";

export function isCategoryLevel(value: unknown): value is CategoryLevel {
  return value === "root" || value === "leaf";
}

/**
 * OrderItem.categoryPathSnapshot is the Category.path at the time of sale,
 * e.g. "/home-living/wall-decor". Rolling up to the ROOT groups every
 * descendant sale under the top-level category ("/home-living"); the LEAF
 * keeps the exact path. A missing or malformed snapshot rolls into null so
 * the report can show it as "Uncategorised" rather than dropping the money.
 */
export function rollupCategoryPath(path: string | null | undefined, level: CategoryLevel): string | null {
  if (!path) return null;
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  return level === "root" ? `/${segments[0]}` : `/${segments.join("/")}`;
}

/** "wall-decor" -> "Wall decor", for paths whose category has since been deleted. */
export function humanizeSlug(slug: string): string {
  const text = slug.replace(/[-_]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : slug;
}
