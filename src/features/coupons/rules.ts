import { applyCoupon, deriveCouponStatus, lineInScope } from "@/features/finance/math";

/**
 * The coupon rule engine (blueprint §11.8, §14.B2, B7).
 *
 * A PURE function of three things: the coupon row, the cart lines and a handful
 * of facts about the customer (how often they used this coupon, how many
 * orders they have placed). Nothing here touches the database, so the same
 * function is exercised by node:test, by `validateCouponForCart` (which loads
 * the facts) and by the ORDERS module at checkout - which is exactly what
 * §11.8 demands: "coupon re-validated at checkout under the same rules as
 * /coupons/validate".
 *
 * Category scope matches DESCENDANTS: a coupon on "Jewellery" applies to a
 * line whose `categoryPath` is "/jewellery/earrings". The caller passes the
 * paths of the coupon's scope categories (`scopeCategories`), the engine
 * turns "path prefix" into the ancestor-id list `lineInScope` expects.
 */

export type CouponRuleRow = {
  id: string;
  code: string;
  type: string;
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number | null;
  appliesTo: string;
  categoryIds: readonly string[];
  productIds: readonly string[];
  sellerIds: readonly string[];
  excludedProductIds: readonly string[];
  firstOrderOnly: boolean;
  customerIds: readonly string[];
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usageCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  deletedAt?: Date | null;
  fundedBy: string;
};

export type CartLine = {
  productId: string;
  variantId?: string | null;
  sellerId: string | null;
  categoryId: string | null;
  /** Copy of Category.path ("/fashion/kurta"); null when the product has no category. */
  categoryPath: string | null;
  quantity: number;
  /** Unit price AFTER any sale price, BEFORE promotions (the price the customer sees). */
  unitPricePaise: number;
  /** Per-unit personalisation surcharge, part of lineGross like computeLineFinancials. */
  customizationPaise?: number;
  /** Whole-line promotion allocation already applied (B2: coupon second). */
  promotionDiscountPaise?: number;
};

export type CouponCustomerFacts = {
  /** Resolved customer id, or null for an unknown guest. */
  customerId: string | null;
  email: string | null;
  /** CouponUsage rows for this coupon by this customer. */
  usageCount: number;
  /** Orders this customer (or guest email) has placed that were not cancelled/failed. */
  priorOrderCount: number;
};

export type CouponRejectionReason =
  | "NOT_FOUND"
  | "DISABLED"
  | "SCHEDULED"
  | "EXPIRED"
  | "EXHAUSTED"
  | "CUSTOMER_REQUIRED"
  | "NOT_ELIGIBLE_CUSTOMER"
  | "FIRST_ORDER_ONLY"
  | "PER_CUSTOMER_LIMIT"
  | "MIN_ORDER_NOT_MET"
  | "NO_ELIGIBLE_LINES";

/** Operator-facing explanations. The public endpoint never shows these (D9 uniform error). */
export const COUPON_REJECTION_MESSAGES: Record<CouponRejectionReason, string> = {
  NOT_FOUND: "No coupon with that code exists.",
  DISABLED: "This coupon is disabled.",
  SCHEDULED: "This coupon has not started yet.",
  EXPIRED: "This coupon has expired.",
  EXHAUSTED: "This coupon has reached its usage limit.",
  CUSTOMER_REQUIRED: "This coupon is reserved for specific customers; sign in to use it.",
  NOT_ELIGIBLE_CUSTOMER: "This coupon is not available for this customer.",
  FIRST_ORDER_ONLY: "This coupon is only valid on a customer's first order.",
  PER_CUSTOMER_LIMIT: "This customer has already used this coupon the maximum number of times.",
  MIN_ORDER_NOT_MET: "The order total is below the coupon's minimum.",
  NO_ELIGIBLE_LINES: "Nothing in the cart is covered by this coupon.",
};

export type CouponLineDiscount = { productId: string; variantId: string | null; discountPaise: number };

export type CouponEvaluation =
  | {
      ok: true;
      coupon: { id: string; code: string; type: string; fundedBy: string };
      /** Item discount only; shipping is reported separately (B7). */
      discountPaise: number;
      /** One entry per input line, in order; zero for lines out of scope. */
      perLine: CouponLineDiscount[];
      freeShipping: boolean;
      /** What a FREE_SHIPPING coupon zeroes: the remaining shipping charge. */
      shippingDiscountPaise: number;
    }
  | { ok: false; reason: CouponRejectionReason; message: string };

export type CouponEvaluationInput = {
  coupon: CouponRuleRow;
  lines: readonly CartLine[];
  /** `{ id, path }` for every id in `coupon.categoryIds`; ignored for other scopes. */
  scopeCategories?: ReadonlyArray<{ id: string; path: string }>;
  customer: CouponCustomerFacts;
  /** Discounted item subtotal (Σ lineGross − promotion). Computed from lines when omitted. */
  subtotalPaise?: number;
  shippingPaise?: number;
  now?: Date;
};

export function lineGrossPaise(line: Pick<CartLine, "unitPricePaise" | "customizationPaise" | "quantity">): number {
  return (line.unitPricePaise + (line.customizationPaise ?? 0)) * line.quantity;
}

/** lineGross − promotion allocation, floored at zero - the coupon's weight for this line (B2). */
export function couponWeightPaise(line: CartLine): number {
  return Math.max(0, lineGrossPaise(line) - (line.promotionDiscountPaise ?? 0));
}

/**
 * Which of the coupon's scope categories contain this line. The line's own
 * category id is always included so a coupon scoped to a leaf category works
 * even when `categoryPath` was never denormalised onto the product.
 */
export function ancestorIdsForLine(
  line: Pick<CartLine, "categoryId" | "categoryPath">,
  scopeCategories: ReadonlyArray<{ id: string; path: string }>,
): string[] {
  const ids = new Set<string>();
  if (line.categoryId) ids.add(line.categoryId);
  if (line.categoryPath) {
    for (const category of scopeCategories) {
      if (line.categoryPath === category.path || line.categoryPath.startsWith(`${category.path}/`)) {
        ids.add(category.id);
      }
    }
  }
  return [...ids];
}

function reject(reason: CouponRejectionReason): CouponEvaluation {
  return { ok: false, reason, message: COUPON_REJECTION_MESSAGES[reason] };
}

export function evaluateCoupon(input: CouponEvaluationInput): CouponEvaluation {
  const { coupon, lines, customer } = input;
  const now = input.now ?? new Date();
  const scopeCategories = input.scopeCategories ?? [];

  // 1. Lifecycle - the same derivation the list screen labels rows with.
  const status = deriveCouponStatus(coupon, now);
  if (status !== "ACTIVE") return reject(status);

  // 2. Who may use it.
  if (coupon.customerIds.length > 0) {
    if (!customer.customerId) return reject("CUSTOMER_REQUIRED");
    if (!coupon.customerIds.includes(customer.customerId)) return reject("NOT_ELIGIBLE_CUSTOMER");
  }
  if (coupon.firstOrderOnly && customer.priorOrderCount > 0) return reject("FIRST_ORDER_ONLY");
  if (coupon.perCustomerLimit !== null && customer.customerId && customer.usageCount >= coupon.perCustomerLimit) {
    return reject("PER_CUSTOMER_LIMIT");
  }

  // 3. What it covers.
  const eligibleIndexes: number[] = [];
  lines.forEach((line, index) => {
    const inScope = lineInScope(coupon, {
      productId: line.productId,
      sellerId: line.sellerId,
      categoryAncestorIds: ancestorIdsForLine(line, scopeCategories),
    });
    if (inScope && line.quantity > 0) eligibleIndexes.push(index);
  });

  const subtotalPaise =
    input.subtotalPaise ?? lines.reduce((sum, line) => sum + couponWeightPaise(line), 0);

  // FREE_SHIPPING still needs something in scope to attach to.
  if (eligibleIndexes.length === 0) {
    if (coupon.minOrderPaise && subtotalPaise < coupon.minOrderPaise) return reject("MIN_ORDER_NOT_MET");
    return reject("NO_ELIGIBLE_LINES");
  }

  // 4. Money - allocation lives in finance/math so the ledger and this agree.
  const application = applyCoupon({
    coupon,
    eligibleLines: eligibleIndexes.map((index) => ({ weightPaise: couponWeightPaise(lines[index]) })),
    subtotalPaise,
  });
  if (application.rejection) return reject(application.rejection);

  const perLine: CouponLineDiscount[] = lines.map((line) => ({
    productId: line.productId,
    variantId: line.variantId ?? null,
    discountPaise: 0,
  }));
  eligibleIndexes.forEach((lineIndex, position) => {
    perLine[lineIndex].discountPaise = application.perLine[position] ?? 0;
  });

  const shippingPaise = Math.max(0, input.shippingPaise ?? 0);
  return {
    ok: true,
    coupon: { id: coupon.id, code: coupon.code, type: coupon.type, fundedBy: coupon.fundedBy },
    discountPaise: application.discountPaise,
    perLine,
    freeShipping: application.freeShipping,
    shippingDiscountPaise: application.freeShipping ? shippingPaise : 0,
  };
}
