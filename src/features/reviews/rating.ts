/**
 * Rating maths shared by the service and the node:test file (no imports, so
 * the seed and scripts can use it too).
 *
 * `reviewCount` is the number of APPROVED reviews - including ones without a
 * star rating - because that is the number the storefront prints next to
 * "reviews". `ratingAvg` averages only the rated ones and is stored with two
 * decimals so 4.333 and 4.33 do not look like different products.
 */
export type RatingSummary = { ratingAvg: number; reviewCount: number };

export function ratingSummary(ratings: ReadonlyArray<number | null | undefined>): RatingSummary {
  let sum = 0;
  let rated = 0;
  for (const rating of ratings) {
    if (typeof rating !== "number" || !Number.isFinite(rating)) continue;
    if (rating < 1 || rating > 5) continue;
    sum += rating;
    rated += 1;
  }
  return {
    reviewCount: ratings.length,
    ratingAvg: rated === 0 ? 0 : roundRating(sum / rated),
  };
}

/** Half-up to two decimals, avoiding the 1.005 -> 1 float trap. */
export function roundRating(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** A one-line "4.3 (12)" style label; null when there is nothing to show. */
export function ratingLabel(avg: number | null | undefined, count: number | null | undefined): string | null {
  if (!count) return null;
  return `${(avg ?? 0).toFixed(1)} (${count})`;
}
