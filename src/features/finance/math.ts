import type {
  CouponStatus,
  MarketplaceCharge,
  PaymentStatus,
} from "@/lib/enums";

/**
 * Money arithmetic (blueprint §14.B1-B7, B6). PURE: no database, no dates
 * except the ones passed in, integer paise in and integer paise out.
 *
 * Every formula an order, a ledger row or a payout depends on is here and
 * nowhere else, and `math.test.ts` pins them to the reference vector in B1.
 * The reason is not elegance: a rounding rule implemented twice - once at
 * checkout and once in the seller statement - drifts by a paisa per line, and
 * a paisa per line is what makes a payout statement fail its own assertion.
 */

// ---------------------------------------------------------------------------
// Rounding and allocation
// ---------------------------------------------------------------------------

function assertSafe(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer, got ${value}`);
  }
}

/**
 * round(a × b / divisor) with halves rounding UP, in integer arithmetic:
 * floor((2ab + divisor) / (2 divisor)) == floor(ab/divisor + 1/2). Works for
 * odd divisors such as 10000 + r, where (divisor / 2) would not be an integer.
 * Negative inputs round half towards +infinity, which is what "half up" means.
 */
export function roundHalfUp(a: number, b: number, divisor = 10000): number {
  assertSafe(a, "a");
  assertSafe(b, "b");
  assertSafe(divisor, "divisor");
  if (divisor <= 0) throw new RangeError("divisor must be positive");
  const numerator = 2 * a * b + divisor;
  assertSafe(numerator, "a*b");
  return Math.floor(numerator / (2 * divisor));
}

/**
 * Largest-remainder allocation (B2). Floor shares first, then one paisa at a
 * time to the largest fractional remainders; ties go to the lowest index so
 * the same lines always get the same paise. Σ result === amount whenever the
 * weights sum to a positive number; zero weights give zero shares.
 */
export function allocate(amountPaise: number, weights: readonly number[]): number[] {
  assertSafe(amountPaise, "amountPaise");
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (weights.length === 0 || total <= 0 || amountPaise === 0) {
    return weights.map(() => 0);
  }

  const sign = amountPaise < 0 ? -1 : 1;
  const amount = Math.abs(amountPaise);

  const shares = weights.map((weight) => {
    const exact = (amount * Math.max(0, weight)) / total;
    const floor = Math.floor(exact);
    return { floor, remainder: exact - floor };
  });

  let leftover = amount - shares.reduce((sum, share) => sum + share.floor, 0);
  const order = shares
    .map((share, index) => ({ index, remainder: share.remainder }))
    .sort((x, y) => y.remainder - x.remainder || x.index - y.index);

  for (const { index } of order) {
    if (leftover <= 0) break;
    shares[index].floor += 1;
    leftover -= 1;
  }

  return shares.map((share) => sign * share.floor);
}

/** Tax contained in a tax-inclusive amount: net × r / (10000 + r). */
export function taxFromInclusive(netPaise: number, rateBps: number): number {
  if (rateBps <= 0) return 0;
  return roundHalfUp(netPaise, rateBps, 10000 + rateBps);
}

/** Tax added on top of a tax-exclusive amount: net × r / 10000. */
export function taxFromExclusive(netPaise: number, rateBps: number): number {
  if (rateBps <= 0) return 0;
  return roundHalfUp(netPaise, rateBps, 10000);
}

// ---------------------------------------------------------------------------
// Line financials (B1)
// ---------------------------------------------------------------------------

export type LineFinancialsInput = {
  unitPricePaise: number;
  /** Σ selected customisation option surcharges, PER UNIT. */
  customizationPaise?: number;
  quantity: number;
  sellerFundedDiscountPaise?: number;
  platformFundedDiscountPaise?: number;
  taxRateBps: number;
  pricesIncludeTax: boolean;
};

export type LineFinancials = {
  lineGross: number;
  discountPaise: number;
  lineNet: number;
  taxPaise: number;
  lineTotalPaise: number;
};

export function computeLineFinancials(input: LineFinancialsInput): LineFinancials {
  const lineGross = (input.unitPricePaise + (input.customizationPaise ?? 0)) * input.quantity;
  const discountPaise =
    (input.sellerFundedDiscountPaise ?? 0) + (input.platformFundedDiscountPaise ?? 0);
  const lineNet = lineGross - discountPaise;
  const taxPaise = input.pricesIncludeTax
    ? taxFromInclusive(lineNet, input.taxRateBps)
    : taxFromExclusive(lineNet, input.taxRateBps);
  return {
    lineGross,
    discountPaise,
    lineNet,
    taxPaise,
    lineTotalPaise: input.pricesIncludeTax ? lineNet : lineNet + taxPaise,
  };
}

// ---------------------------------------------------------------------------
// Commission and charges (B3)
// ---------------------------------------------------------------------------

export type ChargeRule = MarketplaceCharge;

export type CommissionInput = {
  lineGross: number;
  sellerFundedDiscountPaise?: number;
  taxRateBps: number;
  pricesIncludeTax: boolean;
  taxRemittedBy: "SELLER" | "PLATFORM";
  rateBps: number;
  /** PER UNIT. */
  fixedPaise?: number;
  quantity: number;
  charges?: readonly ChargeRule[];
  paymentMethod: string;
  /**
   * FIXED_PER_ORDER charges cannot be split across lines; the caller sets this
   * on exactly one line per seller per order (the first) so it is levied once.
   */
  applyPerOrderCharges?: boolean;
};

export type CommissionResult = {
  sellerBaseGross: number;
  taxOnSellerBase: number;
  taxableValue: number;
  commissionPaise: number;
  chargesPaise: number;
  sellerGross: number;
  sellerPayablePaise: number;
};

function chargeApplies(rule: ChargeRule, paymentMethod: string): boolean {
  switch (rule.appliesWhen) {
    case "ONLINE_PAYMENT":
      return paymentMethod === "ONLINE";
    case "COD":
      return paymentMethod === "COD";
    default:
      return true;
  }
}

export function computeCharges(input: {
  sellerBaseGross: number;
  quantity: number;
  charges: readonly ChargeRule[];
  paymentMethod: string;
  applyPerOrderCharges?: boolean;
}): number {
  let total = 0;
  for (const rule of input.charges) {
    if (!chargeApplies(rule, input.paymentMethod)) continue;
    switch (rule.type) {
      case "PERCENT_OF_GROSS":
        total += roundHalfUp(input.sellerBaseGross, rule.valueBps ?? 0);
        break;
      case "FIXED_PER_ITEM":
        total += (rule.valuePaise ?? 0) * input.quantity;
        break;
      case "FIXED_PER_ORDER":
        if (input.applyPerOrderCharges) total += rule.valuePaise ?? 0;
        break;
    }
  }
  return total;
}

export function computeCommission(input: CommissionInput): CommissionResult {
  const sellerBaseGross = input.lineGross - (input.sellerFundedDiscountPaise ?? 0);
  const taxOnSellerBase = input.pricesIncludeTax
    ? taxFromInclusive(sellerBaseGross, input.taxRateBps)
    : 0;
  const taxableValue = sellerBaseGross - taxOnSellerBase;
  const commissionPaise =
    roundHalfUp(taxableValue, input.rateBps) + (input.fixedPaise ?? 0) * input.quantity;
  const chargesPaise = computeCharges({
    sellerBaseGross,
    quantity: input.quantity,
    charges: input.charges ?? [],
    paymentMethod: input.paymentMethod,
    applyPerOrderCharges: input.applyPerOrderCharges,
  });
  const sellerGross = input.taxRemittedBy === "PLATFORM" ? taxableValue : sellerBaseGross;

  return {
    sellerBaseGross,
    taxOnSellerBase,
    taxableValue,
    commissionPaise,
    chargesPaise,
    sellerGross,
    sellerPayablePaise: sellerGross - commissionPaise - chargesPaise,
  };
}

// ---------------------------------------------------------------------------
// Order totals (B1, B7)
// ---------------------------------------------------------------------------

export type OrderTotalsLine = {
  lineGross: number;
  promotionDiscountPaise: number;
  couponDiscountPaise: number;
  taxPaise: number;
  lineTotalPaise: number;
};

export type OrderTotals = {
  subtotalPaise: number;
  /** Σ promotion allocations. */
  discountPaise: number;
  /** Σ coupon allocations, or the shipping charge for a FREE_SHIPPING coupon. */
  couponDiscountPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  taxPaise: number;
  totalPaise: number;
};

export function computeOrderTotals(
  lines: readonly OrderTotalsLine[],
  options: { shippingPaise: number; codFeePaise: number; freeShippingCoupon?: boolean },
): OrderTotals {
  const sum = (pick: (line: OrderTotalsLine) => number) =>
    lines.reduce((total, line) => total + pick(line), 0);

  const couponLines = sum((line) => line.couponDiscountPaise);
  const shippingWaived = options.freeShippingCoupon ? options.shippingPaise : 0;

  return {
    subtotalPaise: sum((line) => line.lineGross),
    discountPaise: sum((line) => line.promotionDiscountPaise),
    couponDiscountPaise: couponLines + shippingWaived,
    shippingPaise: options.shippingPaise,
    codFeePaise: options.codFeePaise,
    taxPaise: sum((line) => line.taxPaise),
    totalPaise:
      sum((line) => line.lineTotalPaise) +
      options.shippingPaise +
      options.codFeePaise -
      shippingWaived,
  };
}

/**
 * Free-shipping precedence (B7): the rate's own threshold beats the store
 * setting; a FREE_SHIPPING coupon zeroes whatever remains (recorded as coupon
 * discount by computeOrderTotals). COD fee is never touched here.
 */
export function resolveShippingPaise(input: {
  ratePaise: number;
  rateFreeAbovePaise?: number | null;
  settingFreeAbovePaise?: number | null;
  /** Item subtotal after promotion + coupon allocations. */
  discountedSubtotalPaise: number;
}): number {
  const threshold = input.rateFreeAbovePaise ?? input.settingFreeAbovePaise ?? null;
  if (threshold !== null && threshold > 0 && input.discountedSubtotalPaise >= threshold) return 0;
  return input.ratePaise;
}

// ---------------------------------------------------------------------------
// Coupons and promotions (B2)
// ---------------------------------------------------------------------------

export type ScopeRule = {
  appliesTo: string;
  categoryIds?: readonly string[];
  productIds?: readonly string[];
  sellerIds?: readonly string[];
  excludedProductIds?: readonly string[];
};

export type ScopedLine = {
  productId: string | null;
  sellerId: string | null;
  /** The product's category and every ancestor. */
  categoryAncestorIds: readonly string[];
};

/** Does a coupon/promotion scope include this line? */
export function lineInScope(rule: ScopeRule, line: ScopedLine): boolean {
  if (line.productId && rule.excludedProductIds?.includes(line.productId)) return false;
  switch (rule.appliesTo) {
    case "CATEGORIES":
      return line.categoryAncestorIds.some((id) => rule.categoryIds?.includes(id));
    case "PRODUCTS":
      return Boolean(line.productId && rule.productIds?.includes(line.productId));
    case "SELLERS":
      return Boolean(line.sellerId && rule.sellerIds?.includes(line.sellerId));
    default:
      return true;
  }
}

export type CouponLike = {
  type: string;
  value: number;
  maxDiscountPaise?: number | null;
  minOrderPaise?: number | null;
};

export type CouponApplication = {
  discountPaise: number;
  /** Parallel to `eligibleLines`; zeros for FREE_SHIPPING. */
  perLine: number[];
  freeShipping: boolean;
  /** Set when nothing was applied and the caller should say why. */
  rejection?: "MIN_ORDER_NOT_MET" | "NO_ELIGIBLE_LINES";
};

/**
 * `eligibleLines[].weightPaise` = lineGross − promotion allocation for the
 * lines in scope (B2: coupon second, on what the promotion left). `subtotal`
 * is the whole order's discounted item subtotal for the minimum-order check.
 */
export function applyCoupon(input: {
  coupon: CouponLike;
  eligibleLines: ReadonlyArray<{ weightPaise: number }>;
  subtotalPaise: number;
}): CouponApplication {
  const { coupon } = input;
  const zeros = input.eligibleLines.map(() => 0);

  if (coupon.minOrderPaise && input.subtotalPaise < coupon.minOrderPaise) {
    return { discountPaise: 0, perLine: zeros, freeShipping: false, rejection: "MIN_ORDER_NOT_MET" };
  }

  if (coupon.type === "FREE_SHIPPING") {
    return { discountPaise: 0, perLine: zeros, freeShipping: true };
  }

  const eligibleSubtotal = input.eligibleLines.reduce(
    (sum, line) => sum + Math.max(0, line.weightPaise),
    0,
  );
  if (eligibleSubtotal <= 0) {
    return { discountPaise: 0, perLine: zeros, freeShipping: false, rejection: "NO_ELIGIBLE_LINES" };
  }

  let discount =
    coupon.type === "PERCENT"
      ? roundHalfUp(eligibleSubtotal, coupon.value * 100)
      : Math.max(0, coupon.value);
  if (coupon.type === "PERCENT" && coupon.maxDiscountPaise) {
    discount = Math.min(discount, coupon.maxDiscountPaise);
  }
  discount = Math.min(discount, eligibleSubtotal);

  return {
    discountPaise: discount,
    perLine: allocate(
      discount,
      input.eligibleLines.map((line) => Math.max(0, line.weightPaise)),
    ),
    freeShipping: false,
  };
}

export type PromotionLike = {
  discountType: string;
  value: number;
};

/** The unit price a promotion produces from a list/sale price; never below zero. */
export function promotionUnitPrice(unitPricePaise: number, promotion: PromotionLike): number {
  const discount =
    promotion.discountType === "PERCENT"
      ? roundHalfUp(unitPricePaise, promotion.value * 100)
      : Math.max(0, promotion.value);
  return Math.max(0, unitPricePaise - discount);
}

/**
 * Promotion allocation is per line, per unit (B2 "promotion first"): the
 * discount is (unit − promotionUnit) × quantity, so it agrees to the paisa
 * with the promotion price shown on the product page (pricing.ts).
 */
export function applyPromotion(input: {
  promotion: PromotionLike;
  lines: ReadonlyArray<{ unitPricePaise: number; quantity: number }>;
}): { discountPaise: number; perLine: number[] } {
  const perLine = input.lines.map(
    (line) =>
      (line.unitPricePaise - promotionUnitPrice(line.unitPricePaise, input.promotion)) *
      line.quantity,
  );
  return { discountPaise: perLine.reduce((sum, value) => sum + value, 0), perLine };
}

// ---------------------------------------------------------------------------
// Derived statuses (§4.7, B6)
// ---------------------------------------------------------------------------

export function deriveCouponStatus(
  coupon: {
    isActive: boolean;
    deletedAt?: Date | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
    usageLimit?: number | null;
    usageCount: number;
  },
  now: Date = new Date(),
): CouponStatus {
  if (!coupon.isActive || coupon.deletedAt) return "DISABLED";
  if (coupon.usageLimit !== null && coupon.usageLimit !== undefined && coupon.usageCount >= coupon.usageLimit) {
    return "EXHAUSTED";
  }
  if (coupon.startsAt && coupon.startsAt > now) return "SCHEDULED";
  if (coupon.endsAt && coupon.endsAt < now) return "EXPIRED";
  return "ACTIVE";
}

/**
 * B6 derivation. `paid` = Σ SUCCEEDED CHARGE|CAPTURE, `refunded` = Σ COMPLETED
 * refunds; both computed by the payments service in the same transaction as
 * the change that triggered the recompute.
 */
export function derivePaymentStatus(input: {
  paidPaise: number;
  refundedPaise: number;
  totalPaise: number;
  orderStatus: string;
  hasAuthorization?: boolean;
}): PaymentStatus {
  const { paidPaise, refundedPaise, totalPaise, orderStatus } = input;
  if (refundedPaise >= paidPaise && paidPaise > 0) return "REFUNDED";
  if (refundedPaise > 0) return "PARTIALLY_REFUNDED";
  if (paidPaise >= totalPaise && totalPaise > 0) return "PAID";
  if (input.hasAuthorization) return "AUTHORIZED";
  if (paidPaise === 0 && orderStatus === "CANCELLED") return "CANCELLED";
  if (paidPaise === 0 && orderStatus === "FAILED") return "FAILED";
  return "PENDING";
}

// ---------------------------------------------------------------------------
// Refund reversal fractions (B4)
// ---------------------------------------------------------------------------

/**
 * Pro-rata share of `total` for k of n units, with the LAST unit taking the
 * exact remainder so the reversals of a line sum to the original to the paisa.
 */
export function proRata(total: number, k: number, n: number, alreadyReversed: number): number {
  if (n <= 0 || k <= 0) return 0;
  if (k >= n) return total - alreadyReversed;
  return roundHalfUp(total, k, n);
}
