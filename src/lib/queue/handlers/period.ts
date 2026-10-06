/**
 * Period buckets for recurring jobs. Pure - no database - so it is unit-tested
 * and so the dedupe-key format is defined in exactly one place.
 *
 * A recurring job is "the job for this bucket": one PENDING/RUNNING/finished
 * Job row per (type, cadence, bucket start), enforced by `Job.dedupeKey`. The
 * bucket is UTC-aligned on purpose - it is a deduplication key, not a
 * schedule, and IST day boundaries belong to the reports, not to housekeeping.
 */

export type RecurringCadence = "15min" | "hourly" | "daily";

export const CADENCE_MS: Record<RecurringCadence, number> = {
  "15min": 15 * 60_000,
  hourly: 60 * 60_000,
  daily: 24 * 60 * 60_000,
};

/** Start of the bucket `now` falls in. */
export function periodStart(every: RecurringCadence, now: Date): Date {
  const size = CADENCE_MS[every];
  return new Date(Math.floor(now.getTime() / size) * size);
}

/**
 * `<type>:<cadence>:<bucket>` where bucket is `2026-09-08` (daily),
 * `2026-09-08T10` (hourly) or `2026-09-08T10:15` (15min). Sorts
 * chronologically and reads at a glance on the jobs page.
 */
export function periodKey(type: string, every: RecurringCadence, now: Date): string {
  const iso = periodStart(every, now).toISOString();
  const stamp = every === "daily" ? iso.slice(0, 10) : every === "hourly" ? iso.slice(0, 13) : iso.slice(0, 16);
  return `${type}:${every}:${stamp}`;
}
