import {
  computeCommission,
  computeLineFinancials,
  computeOrderTotals,
  type ChargeRule,
  type OrderTotals,
} from "@/features/finance/math";
import type { CustomizationSnapshotEntry } from "@/features/products/customization";

/**
 * The order pricing core (blueprint §14.B1-B3, B7) - PURE.
 *
 * `draft.ts` loads catalogue rows, validates customisation, evaluates the
 * coupon and quotes shipping; this file turns that into the exact integer
 * paise that land on Order and OrderItem. Nothing here touches the database,
 * so `pricing.test.ts` pins it to the B1 reference vector and both the
 * storefront checkout and the manual order form go through the same function:
 * an operator keying a phone order and a shopper on the website must never
 * arrive at different totals for the same basket.
 */

export type DraftLine = {
  /** Caller's handle for problem reporting (line index or client key). */
  key: string;
  productId: string;
  variantId: string | null;
  sellerId: string | null;
  categoryId: string | null;
  titleSnapshot: string;
  variantSnapshot: string | null;
  skuSnapshot: string | null;
  sellerNameSnapshot: string | null;
  categoryPathSnapshot: string | null;
  hsnCodeSnapshot: string | null;
  brandSnapshot: string | null;
  costPaiseSnapshot: number | null;
  imageUrl: string | null;
  attributesSnapshot: unknown | null;
  customization: CustomizationSnapshotEntry[] | null;
  listPricePaise: number;
  /** After sale price and any MANUAL override; before promotion (B2). */
  unitPricePaise: number;
  /** Per unit (B1). */
  customizationPaise: number;
  quantity: number;
  /** Whole-line promotion allocation (B2 promotion first). */
  promotionDiscountPaise: number;
  promotionFundedBy: "PLATFORM" | "SELLER" | null;
  taxRateBps: number;
  commission: { rateBps: number; fixedPaise: number; ruleId: string | null };
};

export type DraftCoupon = {
  id: string;
  code: string;
  type: string;
  fundedBy: string;
  /** Parallel to `lines`; zero for lines out of scope. */
  perLine: readonly number[];
  freeShipping: boolean;
};

export type DraftShipping = {
  rateId: string | null;
  methodName: string | null;
  /** After the rate/setting free-above threshold (B7); the coupon zeroes it later. */
  ratePaise: number;
  /** 0 unless the order is COD; never waived (B7). */
  codFeePaise: number;
  estimatedDeliveryAt: Date | null;
};

export type PricingContext = {
  pricesIncludeTax: boolean;
  taxRemittedBy: "SELLER" | "PLATFORM";
  paymentMethod: string;
  coupon: DraftCoupon | null;
  shipping: DraftShipping;
  chargeRules: readonly ChargeRule[];
};

/** Exactly the OrderItem money + snapshot columns, ready for createMany. */
export type PricedLine = DraftLine & {
  couponDiscountPaise: number;
  sellerFundedDiscountPaise: number;
  platformFundedDiscountPaise: number;
  discountPaise: number;
  lineGross: number;
  lineNet: number;
  taxPaise: number;
  lineTotalPaise: number;
  commissionBps: number;
  commissionFixedPaise: number;
  commissionRuleId: string | null;
  commissionPaise: number;
  chargesPaise: number;
  sellerPayablePaise: number;
  sellerGrossPaise: number;
};

export type PricedDraft = {
  lines: PricedLine[];
  totals: OrderTotals;
  /** Σ lineGross − promotion − coupon allocations: the B7 threshold figure. */
  discountedSubtotalPaise: number;
  freeShippingCoupon: boolean;
};

/** Which side of the marketplace absorbs a discount (B3). */
function split(amount: number, fundedBy: string | null | undefined): { seller: number; platform: number } {
  return fundedBy === "SELLER" ? { seller: amount, platform: 0 } : { seller: 0, platform: amount };
}

/**
 * Price every line and the order. FIXED_PER_ORDER charges are levied on the
 * first line of each seller (computeCommission's `applyPerOrderCharges`).
 * Lines without a seller carry no commission and no payable (B3).
 */
export function priceOrderDraft(lines: readonly DraftLine[], ctx: PricingContext): PricedDraft {
  const seenSellers = new Set<string>();
  const coupon = ctx.coupon;
  const freeShippingCoupon = Boolean(coupon?.freeShipping);

  const priced: PricedLine[] = lines.map((line, index) => {
    const couponDiscountPaise = coupon && !coupon.freeShipping ? coupon.perLine[index] ?? 0 : 0;
    const promo = split(line.promotionDiscountPaise, line.promotionFundedBy);
    const cpn = split(couponDiscountPaise, coupon?.fundedBy);
    const sellerFundedDiscountPaise = promo.seller + cpn.seller;
    const platformFundedDiscountPaise = promo.platform + cpn.platform;

    const financials = computeLineFinancials({
      unitPricePaise: line.unitPricePaise,
      customizationPaise: line.customizationPaise,
      quantity: line.quantity,
      sellerFundedDiscountPaise,
      platformFundedDiscountPaise,
      taxRateBps: line.taxRateBps,
      pricesIncludeTax: ctx.pricesIncludeTax,
    });

    let commissionPaise = 0;
    let chargesPaise = 0;
    let sellerPayablePaise = 0;
    let sellerGrossPaise = 0;
    if (line.sellerId) {
      const first = !seenSellers.has(line.sellerId);
      seenSellers.add(line.sellerId);
      const commission = computeCommission({
        lineGross: financials.lineGross,
        sellerFundedDiscountPaise,
        taxRateBps: line.taxRateBps,
        pricesIncludeTax: ctx.pricesIncludeTax,
        taxRemittedBy: ctx.taxRemittedBy,
        rateBps: line.commission.rateBps,
        fixedPaise: line.commission.fixedPaise,
        quantity: line.quantity,
        charges: ctx.chargeRules,
        paymentMethod: ctx.paymentMethod,
        applyPerOrderCharges: first,
      });
      commissionPaise = commission.commissionPaise;
      chargesPaise = commission.chargesPaise;
      sellerPayablePaise = commission.sellerPayablePaise;
      sellerGrossPaise = commission.sellerGross;
    }

    return {
      ...line,
      couponDiscountPaise,
      sellerFundedDiscountPaise,
      platformFundedDiscountPaise,
      discountPaise: financials.discountPaise,
      lineGross: financials.lineGross,
      lineNet: financials.lineNet,
      taxPaise: financials.taxPaise,
      lineTotalPaise: financials.lineTotalPaise,
      commissionBps: line.sellerId ? line.commission.rateBps : 0,
      commissionFixedPaise: line.sellerId ? line.commission.fixedPaise : 0,
      commissionRuleId: line.sellerId ? line.commission.ruleId : null,
      commissionPaise,
      chargesPaise,
      sellerPayablePaise,
      sellerGrossPaise,
    };
  });

  const totals = computeOrderTotals(
    priced.map((line) => ({
      lineGross: line.lineGross,
      promotionDiscountPaise: line.promotionDiscountPaise,
      couponDiscountPaise: line.couponDiscountPaise,
      taxPaise: line.taxPaise,
      lineTotalPaise: line.lineTotalPaise,
    })),
    { shippingPaise: ctx.shipping.ratePaise, codFeePaise: ctx.shipping.codFeePaise, freeShippingCoupon },
  );

  const discountedSubtotalPaise = priced.reduce(
    (sum, line) => sum + line.lineGross - line.promotionDiscountPaise - line.couponDiscountPaise,
    0,
  );

  return { lines: priced, totals, discountedSubtotalPaise, freeShippingCoupon };
}

/** Per-seller view for the detail page's split card and the invoice. */
export type SellerSplit = {
  sellerId: string | null;
  sellerName: string;
  lines: number;
  grossPaise: number;
  sellerFundedDiscountPaise: number;
  taxPaise: number;
  commissionPaise: number;
  chargesPaise: number;
  payablePaise: number;
};

export function summariseSellerSplit(
  items: ReadonlyArray<{
    sellerId: string | null;
    sellerNameSnapshot: string | null;
    status: string;
    unitPricePaise: number;
    customizationPaise: number;
    quantity: number;
    sellerFundedDiscountPaise: number;
    taxPaise: number;
    commissionPaise: number;
    chargesPaise: number;
    sellerPayablePaise: number;
  }>,
): SellerSplit[] {
  const groups = new Map<string, SellerSplit>();
  for (const item of items) {
    if (item.status === "CANCELLED") continue;
    const key = item.sellerId ?? "__platform";
    const group = groups.get(key) ?? {
      sellerId: item.sellerId,
      sellerName: item.sellerId ? item.sellerNameSnapshot ?? "Seller" : "DIY Baazar (platform)",
      lines: 0,
      grossPaise: 0,
      sellerFundedDiscountPaise: 0,
      taxPaise: 0,
      commissionPaise: 0,
      chargesPaise: 0,
      payablePaise: 0,
    };
    group.lines += 1;
    group.grossPaise += (item.unitPricePaise + item.customizationPaise) * item.quantity;
    group.sellerFundedDiscountPaise += item.sellerFundedDiscountPaise;
    group.taxPaise += item.taxPaise;
    group.commissionPaise += item.commissionPaise;
    group.chargesPaise += item.chargesPaise;
    group.payablePaise += item.sellerPayablePaise;
    groups.set(key, group);
  }
  return [...groups.values()];
}
