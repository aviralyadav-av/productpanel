import { resolveShippingPaise } from "@/features/finance/math";
import type { ShippingMethod } from "@/lib/enums";

/**
 * The pure half of the shipping service: which zone a pincode belongs to and
 * which rates a basket qualifies for, with no database in sight so the rules
 * are unit-tested exactly (resolution.test.ts) and the ORDERS module's
 * checkout maths and the public quote endpoint cannot disagree.
 */

// ---------------------------------------------------------------------------
// Zone resolution
// ---------------------------------------------------------------------------

export type ZoneCandidate = {
  id: string;
  name: string;
  states: readonly string[];
  pincodePrefixes: readonly string[];
  isDefault: boolean;
  isActive: boolean;
};

export type ZoneMatch = "assigned" | "prefix" | "state" | "default";

export type ZoneResolution<Z extends ZoneCandidate = ZoneCandidate> = {
  zone: Z | null;
  matchedBy: ZoneMatch | null;
};

/**
 * Priority (task brief §5): the pincode row's explicit zone, then the LONGEST
 * matching `pincodePrefixes` entry (a 4-digit prefix beats a 2-digit one -
 * "1100" for Delhi city wins over "11" for the wider region), then a zone
 * listing the state, then the default zone. Inactive zones never match: a
 * zone switched off is a zone we do not ship to, whatever its prefixes say.
 *
 * Ties at the same prefix length or the same state go to the lowest position
 * in the caller's ordering, which is why callers pass zones ordered by
 * position.
 */
export function resolveZoneFromCandidates<Z extends ZoneCandidate>(
  input: { pincode: string; stateCode?: string | null; assignedZoneId?: string | null },
  zones: readonly Z[],
): ZoneResolution<Z> {
  const active = zones.filter((zone) => zone.isActive);

  if (input.assignedZoneId) {
    const assigned = active.find((zone) => zone.id === input.assignedZoneId);
    if (assigned) return { zone: assigned, matchedBy: "assigned" };
  }

  let best: { zone: Z; length: number } | null = null;
  for (const zone of active) {
    for (const prefix of zone.pincodePrefixes) {
      if (prefix && input.pincode.startsWith(prefix) && (!best || prefix.length > best.length)) {
        best = { zone, length: prefix.length };
      }
    }
  }
  if (best) return { zone: best.zone, matchedBy: "prefix" };

  const stateCode = input.stateCode?.toUpperCase();
  if (stateCode) {
    const byState = active.find((zone) => zone.states.some((state) => state.toUpperCase() === stateCode));
    if (byState) return { zone: byState, matchedBy: "state" };
  }

  const fallback = active.find((zone) => zone.isDefault);
  return fallback ? { zone: fallback, matchedBy: "default" } : { zone: null, matchedBy: null };
}

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

/** Used when neither the variant nor the product declares a weight (§5 brief). */
export const DEFAULT_ITEM_WEIGHT_GRAMS = 500;

export type WeightedItem = { quantity: number; weightGrams?: number | null };

/** Total basket weight; missing weights fall back to the 500 g default per unit. */
export function sumWeightGrams(items: readonly WeightedItem[]): number {
  let total = 0;
  for (const item of items) {
    const unit =
      item.weightGrams !== null && item.weightGrams !== undefined && item.weightGrams >= 0
        ? item.weightGrams
        : DEFAULT_ITEM_WEIGHT_GRAMS;
    total += unit * Math.max(0, item.quantity);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Rate selection and quoting
// ---------------------------------------------------------------------------

export type QuotePaymentMethod = "COD" | "ONLINE" | "MANUAL";

export type RateCandidate = {
  id: string;
  name: string;
  method: string;
  ratePaise: number;
  freeAbovePaise: number | null;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
  minOrderPaise: number | null;
  maxOrderPaise: number | null;
  codAvailable: boolean;
  codFeePaise: number;
  estimatedDaysMin: number;
  estimatedDaysMax: number;
  isActive: boolean;
  position: number;
};

/** The settings the quote depends on, read once by the caller. */
export type QuoteSettings = {
  /** shipping.free_above_paise; null/0 disables the store-wide threshold. */
  freeAbovePaise: number | null;
  /** orders.cod_enabled */
  codEnabled: boolean;
  /** orders.cod_fee_paise - used when the rate's own fee is 0. */
  codFeePaise: number;
  /** orders.cod_max_paise; null/0 = no ceiling. */
  codMaxPaise: number | null;
};

export type QuotedRate = {
  rateId: string;
  name: string;
  method: ShippingMethod | string;
  /** What the shopper pays for this method after free-above (B7). */
  ratePaise: number;
  /** The configured price before free-above. */
  baseRatePaise: number;
  isFree: boolean;
  codAvailable: boolean;
  /** 0 unless COD is available for this rate; never waived by free shipping (B7). */
  codFeePaise: number;
  estimatedDaysMin: number;
  estimatedDaysMax: number;
  estimatedDeliveryAt: Date;
};

export type RateSelection = {
  rates: QuotedRate[];
  defaultRateId: string | null;
  /** Machine-readable notes on what was excluded and why (for the admin preview and logs). */
  reasons: string[];
};

export function estimatedDelivery(now: Date, days: number): Date {
  const date = new Date(now.getTime());
  date.setUTCDate(date.getUTCDate() + Math.max(0, days));
  return date;
}

function within(value: number, min: number | null, max: number | null): boolean {
  if (min !== null && min !== undefined && value < min) return false;
  if (max !== null && max !== undefined && value > max) return false;
  return true;
}

/** Cheapest active STANDARD rate, else the cheapest overall; ties by position. */
export function pickDefaultRate(rates: readonly QuotedRate[], positions?: ReadonlyMap<string, number>): string | null {
  if (rates.length === 0) return null;
  const byPrice = (a: QuotedRate, b: QuotedRate) =>
    a.ratePaise + a.codFeePaise - (b.ratePaise + b.codFeePaise) ||
    (positions?.get(a.rateId) ?? 0) - (positions?.get(b.rateId) ?? 0);
  const standard = rates.filter((rate) => rate.method === "STANDARD").sort(byPrice);
  if (standard.length > 0) return standard[0].rateId;
  return [...rates].sort(byPrice)[0].rateId;
}

/**
 * Apply the bounds, the active flags, B7 free-above precedence and the COD
 * rules to a zone's rates.
 *
 * COD on a rate needs four yeses: the rate allows it, the store has COD on,
 * the pincode row (when known) allows it, and the basket is under the COD
 * ceiling. A COD checkout drops rates that fail any of those, because a rate
 * the shopper cannot pay for is not an option.
 */
export function selectRates(input: {
  rates: readonly RateCandidate[];
  weightGrams: number;
  discountedSubtotalPaise: number;
  paymentMethod: QuotePaymentMethod;
  /** PincodeServiceability.codAvailable when the pincode is known; true otherwise. */
  pincodeCodAvailable: boolean;
  settings: QuoteSettings;
  now: Date;
}): RateSelection {
  const reasons: string[] = [];
  const positions = new Map(input.rates.map((rate) => [rate.id, rate.position]));
  const codCeilingOk =
    !input.settings.codMaxPaise || input.settings.codMaxPaise <= 0 || input.discountedSubtotalPaise <= input.settings.codMaxPaise;

  const quoted: QuotedRate[] = [];
  const sorted = [...input.rates].sort((a, b) => a.position - b.position || a.ratePaise - b.ratePaise);

  for (const rate of sorted) {
    if (!rate.isActive) {
      reasons.push(`${rate.id}:inactive`);
      continue;
    }
    if (!within(input.weightGrams, rate.minWeightGrams, rate.maxWeightGrams)) {
      reasons.push(`${rate.id}:weight_out_of_bounds`);
      continue;
    }
    if (!within(input.discountedSubtotalPaise, rate.minOrderPaise, rate.maxOrderPaise)) {
      reasons.push(`${rate.id}:order_value_out_of_bounds`);
      continue;
    }

    const codAvailable = rate.codAvailable && input.settings.codEnabled && input.pincodeCodAvailable && codCeilingOk;
    if (input.paymentMethod === "COD" && !codAvailable) {
      reasons.push(`${rate.id}:cod_unavailable`);
      continue;
    }

    const ratePaise = resolveShippingPaise({
      ratePaise: rate.ratePaise,
      rateFreeAbovePaise: rate.freeAbovePaise,
      settingFreeAbovePaise: input.settings.freeAbovePaise,
      discountedSubtotalPaise: input.discountedSubtotalPaise,
    });

    quoted.push({
      rateId: rate.id,
      name: rate.name,
      method: rate.method,
      ratePaise,
      baseRatePaise: rate.ratePaise,
      isFree: ratePaise === 0,
      codAvailable,
      codFeePaise: codAvailable ? (rate.codFeePaise > 0 ? rate.codFeePaise : input.settings.codFeePaise) : 0,
      estimatedDaysMin: Math.min(rate.estimatedDaysMin, rate.estimatedDaysMax),
      estimatedDaysMax: Math.max(rate.estimatedDaysMin, rate.estimatedDaysMax),
      estimatedDeliveryAt: estimatedDelivery(input.now, Math.max(rate.estimatedDaysMin, rate.estimatedDaysMax)),
    });
  }

  if (quoted.length === 0 && input.rates.length > 0) reasons.push("no_rate_matches");

  return { rates: quoted, defaultRateId: pickDefaultRate(quoted, positions), reasons };
}
