/**
 * Money is stored as an integer number of PAISE everywhere in the database.
 *
 * The legacy storefront data is in whole rupees (`price: 2999`), so:
 *   - the seeder and every admin form multiply by 100 on the way in
 *   - the public storefront serializer divides by 100 on the way out
 * Getting this wrong makes every price 100x too high, so both directions go
 * through this file and nowhere else.
 */

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const INR_PRECISE = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COMPACT = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/** Display form for the admin UI. Whole rupees unless there are real paise. */
export function formatPaise(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "—";
  const rupees = paise / 100;
  return paise % 100 === 0 ? INR.format(rupees) : INR_PRECISE.format(rupees);
}

/** For KPI tiles where the exact figure would not fit: ₹1.2L, ₹3.4Cr. */
export function formatPaiseCompact(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "—";
  return `₹${COMPACT.format(paise / 100)}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
}

export function formatPercent(value: number, fractionDigits = 1): string {
  return `${value.toFixed(fractionDigits)}%`;
}

/**
 * discountPercentage is computed, never stored.
 *
 * The legacy data stores both a salePrice and a discountPercentage and they
 * have drifted apart (e.g. handbag-001 stores 17% where the real figure is
 * 16.7%, handbag-003 stores 14% where the real figure is 14.3%). Computing it
 * means the two can never disagree again.
 */
export function discountPercentage(
  pricePaise: number,
  salePricePaise: number | null | undefined,
): number {
  if (!salePricePaise || salePricePaise >= pricePaise || pricePaise <= 0) {
    return 0;
  }
  return Math.round(((pricePaise - salePricePaise) / pricePaise) * 100);
}

/**
 * The price actually charged, respecting the sale window.
 * A sale price with no window is treated as always active, which matches the
 * current storefront behaviour (`isOnSale` is a plain boolean there).
 */
export function effectivePricePaise(input: {
  pricePaise: number;
  salePricePaise?: number | null;
  saleStartsAt?: Date | null;
  saleEndsAt?: Date | null;
  now?: Date;
}): number {
  if (!isOnSale(input)) return input.pricePaise;
  return input.salePricePaise as number;
}

export function isOnSale(input: {
  pricePaise: number;
  salePricePaise?: number | null;
  saleStartsAt?: Date | null;
  saleEndsAt?: Date | null;
  now?: Date;
}): boolean {
  const { pricePaise, salePricePaise, saleStartsAt, saleEndsAt } = input;
  if (!salePricePaise || salePricePaise >= pricePaise) return false;

  const now = input.now ?? new Date();
  if (saleStartsAt && now < saleStartsAt) return false;
  if (saleEndsAt && now > saleEndsAt) return false;
  return true;
}

/** Percentage change between two periods, for KPI deltas. */
export function delta(
  current: number,
  previous: number,
): { value: number; direction: "up" | "down" | "flat" } | null {
  if (previous === 0) return current === 0 ? { value: 0, direction: "flat" } : null;
  const value = ((current - previous) / previous) * 100;
  if (Math.abs(value) < 0.05) return { value: 0, direction: "flat" };
  return { value, direction: value > 0 ? "up" : "down" };
}
