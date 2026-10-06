import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { allocate, applyCoupon } from "@/features/finance/math";

import { priceOrderDraft, summariseSellerSplit, type DraftLine, type PricingContext } from "./pricing";

/**
 * The B1 reference vector, driven through the ORDERS pricing core rather than
 * the finance primitives directly.
 *
 * finance/math.test.ts already pins `computeLineFinancials`; what this file
 * proves is that the composition an order actually goes through - coupon
 * allocation split into seller- and platform-funded columns, per-line
 * commission, then the order totals - lands on the same numbers. A regression
 * in `priceOrderDraft` that finance's own tests cannot see is exactly the bug
 * that would silently over- or under-charge every customer.
 */

const GROSSES = [200000, 55000, 33300];
const RATES = [1200, 500, 1200];

function draftLine(index: number, overrides: Partial<DraftLine> = {}): DraftLine {
  return {
    key: String(index),
    productId: `p${index}`,
    variantId: `v${index}`,
    sellerId: null,
    categoryId: null,
    titleSnapshot: `Item ${index}`,
    variantSnapshot: null,
    skuSnapshot: null,
    sellerNameSnapshot: null,
    categoryPathSnapshot: null,
    hsnCodeSnapshot: null,
    brandSnapshot: null,
    costPaiseSnapshot: null,
    imageUrl: null,
    attributesSnapshot: null,
    customization: null,
    listPricePaise: GROSSES[index],
    unitPricePaise: GROSSES[index],
    customizationPaise: 0,
    quantity: 1,
    promotionDiscountPaise: 0,
    promotionFundedBy: null,
    taxRateBps: RATES[index],
    commission: { rateBps: 0, fixedPaise: 0, ruleId: null },
    ...overrides,
  };
}

const COUPON_APPLICATION = applyCoupon({
  coupon: { type: "PERCENT", value: 10, maxDiscountPaise: 25000 },
  eligibleLines: GROSSES.map((weightPaise) => ({ weightPaise })),
  subtotalPaise: 288300,
});

function context(overrides: Partial<PricingContext> = {}): PricingContext {
  return {
    pricesIncludeTax: true,
    taxRemittedBy: "SELLER",
    paymentMethod: "COD",
    coupon: {
      id: "c1",
      code: "SAVE10",
      type: "PERCENT",
      fundedBy: "PLATFORM",
      perLine: COUPON_APPLICATION.perLine,
      freeShipping: false,
    },
    shipping: { rateId: null, methodName: null, ratePaise: 0, codFeePaise: 4900, estimatedDeliveryAt: null },
    chargeRules: [],
    ...overrides,
  };
}

describe("priceOrderDraft - blueprint 14.B1 reference vector", () => {
  const priced = priceOrderDraft([draftLine(0), draftLine(1), draftLine(2)], context());

  it("allocates the capped coupon by largest remainder", () => {
    assert.deepEqual(
      priced.lines.map((line) => line.couponDiscountPaise),
      [17343, 4769, 2888],
    );
  });

  it("puts a PLATFORM-funded coupon in the platform column only", () => {
    assert.deepEqual(
      priced.lines.map((line) => line.platformFundedDiscountPaise),
      [17343, 4769, 2888],
    );
    assert.deepEqual(
      priced.lines.map((line) => line.sellerFundedDiscountPaise),
      [0, 0, 0],
    );
  });

  it("produces the documented nets and inclusive taxes", () => {
    assert.deepEqual(
      priced.lines.map((line) => line.lineNet),
      [182657, 50231, 30412],
    );
    assert.deepEqual(
      priced.lines.map((line) => line.taxPaise),
      [19570, 2392, 3258],
    );
  });

  it("totals 268200 with the 49 rupee COD fee", () => {
    assert.equal(priced.totals.subtotalPaise, 288300);
    assert.equal(priced.totals.couponDiscountPaise, 25000);
    assert.equal(priced.totals.discountPaise, 0);
    assert.equal(priced.totals.taxPaise, 25220);
    assert.equal(priced.totals.codFeePaise, 4900);
    assert.equal(priced.totals.totalPaise, 268200);
    assert.equal(priced.totals.totalPaise - priced.totals.codFeePaise, 263300);
  });

  it("reports the discounted subtotal used for the free-shipping threshold (B7)", () => {
    assert.equal(priced.discountedSubtotalPaise, 288300 - 25000);
  });
});

describe("priceOrderDraft - funding split and commission", () => {
  it("routes a SELLER-funded coupon into sellerFundedDiscountPaise", () => {
    const priced = priceOrderDraft(
      [draftLine(0, { sellerId: "s1", sellerNameSnapshot: "Kalakriti" })],
      context({ coupon: { id: "c1", code: "S10", type: "PERCENT", fundedBy: "SELLER", perLine: [20000], freeShipping: false } }),
    );
    assert.equal(priced.lines[0].sellerFundedDiscountPaise, 20000);
    assert.equal(priced.lines[0].platformFundedDiscountPaise, 0);
  });

  it("keeps promotion and coupon funding independent per line", () => {
    const priced = priceOrderDraft(
      [draftLine(0, { promotionDiscountPaise: 5000, promotionFundedBy: "SELLER" })],
      context({ coupon: { id: "c1", code: "P10", type: "PERCENT", fundedBy: "PLATFORM", perLine: [1000], freeShipping: false } }),
    );
    assert.equal(priced.lines[0].sellerFundedDiscountPaise, 5000);
    assert.equal(priced.lines[0].platformFundedDiscountPaise, 1000);
    assert.equal(priced.lines[0].discountPaise, 6000);
  });

  it("charges no commission and no payable on a platform-owned line (B3)", () => {
    const priced = priceOrderDraft([draftLine(0)], context({ coupon: null }));
    assert.equal(priced.lines[0].commissionPaise, 0);
    assert.equal(priced.lines[0].sellerPayablePaise, 0);
    assert.equal(priced.lines[0].commissionBps, 0);
  });

  it("snapshots the resolved commission on a seller line", () => {
    const priced = priceOrderDraft(
      [draftLine(0, { sellerId: "s1", commission: { rateBps: 1500, fixedPaise: 500, ruleId: "rule_1" } })],
      context({ coupon: null }),
    );
    const line = priced.lines[0];
    assert.equal(line.commissionBps, 1500);
    assert.equal(line.commissionFixedPaise, 500);
    assert.equal(line.commissionRuleId, "rule_1");
    // sellerBaseGross 200000, inclusive 12% tax -> taxable 178572 (roundHalfUp),
    // commission = 15% of taxable + 500 fixed per unit.
    assert.equal(line.commissionPaise, Math.floor((178572 * 1500 + 5000) / 10000) + 500);
    assert.equal(line.sellerPayablePaise, 200000 - line.commissionPaise);
  });

  it("levies a FIXED_PER_ORDER charge once per seller, not once per line", () => {
    const rules = [{ code: "ops", label: "Ops fee", type: "FIXED_PER_ORDER" as const, valuePaise: 1000, appliesWhen: "ALWAYS" as const }];
    const priced = priceOrderDraft(
      [draftLine(0, { sellerId: "s1" }), draftLine(1, { sellerId: "s1" }), draftLine(2, { sellerId: "s2" })],
      context({ coupon: null, chargeRules: rules }),
    );
    assert.equal(priced.lines[0].chargesPaise, 1000);
    assert.equal(priced.lines[1].chargesPaise, 0);
    assert.equal(priced.lines[2].chargesPaise, 1000);
  });
});

describe("priceOrderDraft - free shipping coupon (B7)", () => {
  it("zeroes shipping in the total and records it as coupon discount", () => {
    const priced = priceOrderDraft([draftLine(0)], {
      ...context({ coupon: { id: "c1", code: "FREESHIP", type: "FREE_SHIPPING", fundedBy: "PLATFORM", perLine: [0], freeShipping: true } }),
      shipping: { rateId: "r1", methodName: "Standard", ratePaise: 9900, codFeePaise: 4900, estimatedDeliveryAt: null },
    });
    // Line total unchanged, shipping charged then waived, COD fee still due.
    assert.equal(priced.totals.shippingPaise, 9900);
    assert.equal(priced.totals.couponDiscountPaise, 9900);
    assert.equal(priced.totals.totalPaise, priced.lines[0].lineTotalPaise + 4900);
  });
});

describe("summariseSellerSplit", () => {
  const items = [
    {
      sellerId: "s1",
      sellerNameSnapshot: "Kalakriti",
      status: "ACTIVE",
      unitPricePaise: 100000,
      customizationPaise: 5000,
      quantity: 2,
      sellerFundedDiscountPaise: 1000,
      taxPaise: 2000,
      commissionPaise: 3000,
      chargesPaise: 500,
      sellerPayablePaise: 96500,
    },
    {
      sellerId: null,
      sellerNameSnapshot: null,
      status: "ACTIVE",
      unitPricePaise: 20000,
      customizationPaise: 0,
      quantity: 1,
      sellerFundedDiscountPaise: 0,
      taxPaise: 500,
      commissionPaise: 0,
      chargesPaise: 0,
      sellerPayablePaise: 0,
    },
    {
      sellerId: "s1",
      sellerNameSnapshot: "Kalakriti",
      status: "CANCELLED",
      unitPricePaise: 999999,
      customizationPaise: 0,
      quantity: 1,
      sellerFundedDiscountPaise: 0,
      taxPaise: 0,
      commissionPaise: 0,
      chargesPaise: 0,
      sellerPayablePaise: 0,
    },
  ];

  it("groups by seller, skips cancelled lines and keeps platform lines separate", () => {
    const split = summariseSellerSplit(items);
    assert.equal(split.length, 2);
    const seller = split.find((row) => row.sellerId === "s1");
    assert.ok(seller);
    assert.equal(seller.lines, 1);
    assert.equal(seller.grossPaise, (100000 + 5000) * 2);
    assert.equal(seller.payablePaise, 96500);
    const platform = split.find((row) => row.sellerId === null);
    assert.ok(platform);
    assert.equal(platform.grossPaise, 20000);
  });
});

describe("allocate - largest remainder (B2)", () => {
  it("never loses or invents a paisa", () => {
    const shares = allocate(1000, [1, 1, 1]);
    assert.deepEqual(shares, [334, 333, 333]);
    assert.equal(shares.reduce((sum, value) => sum + value, 0), 1000);
  });
});
