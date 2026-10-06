/**
 * IST day semantics for marketing schedules (blueprint §11.27).
 *
 * A coupon, promotion or banner window is typed as two dates in an
 * `<input type="date">`. "1 Oct" means the whole IST day, so the start pins
 * to 00:00:00.000 IST and the end to 23:59:59.999 IST - the same rule the
 * product sale window uses (src/features/products/schemas.ts). India has no
 * daylight saving, so the offset is a constant and no timezone library is
 * needed.
 *
 * Shared by the coupons, promotions and banners features (all owned by the
 * marketing module); no Next or server imports so the check scripts and the
 * pure rule engine can use it too.
 */

const IST = "+05:30";
const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

export const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function istStartOfDay(value: string): Date {
  return new Date(`${value}T00:00:00.000${IST}`);
}

export function istEndOfDay(value: string): Date {
  return new Date(`${value}T23:59:59.999${IST}`);
}

/** The inverse, for pre-filling an <input type="date">. */
export function toDateInputValue(date: Date | string | null | undefined): string {
  if (!date) return "";
  const parsed = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(parsed.getTime())) return "";
  return new Date(parsed.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const IST_SHORT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
});

const IST_SHORT_YEAR = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function sameIstYear(a: Date, b: Date): boolean {
  return toDateInputValue(a).slice(0, 4) === toDateInputValue(b).slice(0, 4);
}

/** "1 Oct–31 Oct", "from 1 Oct 2026", "until 31 Oct", or "always". */
export function formatIstWindow(
  startsAt: Date | string | null | undefined,
  endsAt: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  const start = startsAt ? new Date(startsAt) : null;
  const end = endsAt ? new Date(endsAt) : null;
  const fmt = (date: Date) => (sameIstYear(date, now) ? IST_SHORT.format(date) : IST_SHORT_YEAR.format(date));

  if (start && end) return `${fmt(start)}\u2013${fmt(end)}`;
  if (start) return `from ${fmt(start)}`;
  if (end) return `until ${fmt(end)}`;
  return "always";
}
