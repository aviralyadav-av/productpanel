import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allocate,
  applyCoupon,
  applyPromotion,
  computeCommission,
  computeLineFinancials,
  computeOrderTotals,
  deriveCouponStatus,
  derivePaymentStatus,
  lineInScope,
  promotionUnitPrice,
  proRata,
  resolveShippingPaise,
  roundHalfUp,
  taxFromExclusive,
  taxFromInclusive,
} from "./math";

/**
 * Run with: node --import tsx --test src/features/finance/math.test.ts
 *
 * The first block is the binding B1 reference vector. If it ever fails, the
 * money formulas changed - not the test.
 */

describe("B1 reference vector", () => {
  const grosses = [200000, 55000, 33300];
  const rates = [1200, 500, 1200];
  const coupon = { type: "PERCENT", value: 10, maxDiscountPaise: 25000 };

  const application = applyCoupon({
    coupon,
    eligibleLines: grosses.map((weightPaise) => ({ weightPaise })),
    subtotalPaise: 288300,
  });

  const lines = grosses.map((gross, index) =>
    computeLineFinancials({
      unitPricePaise: gross,
      quantity: 1,
      platformFundedDiscountPaise: application.perLine[index],
      taxRateBps: rates[index],
      pricesIncludeTax: true,
    }),
  );

  it("caps the 10% coupon at ₹250 and allocates by largest remainder", () => {
    assert.equal(application.discountPaise, 25000);
    assert.deepEqual(application.perLine, [17343, 4769, 2888]);
  });

  it("produces the documented nets", () => {
    assert.deepEqual(
      lines.map((line) => line.lineNet),
      [182657, 50231, 30412],
    );
  });

  it("extracts the documented inclusive taxes", () => {
    assert.deepEqual(
      lines.map((line) => line.taxPaise),
      [19570, 2392, 3258],
    );
  });

  it("sums to taxPaise 25220 and total 268200 with the ₹49 COD fee", () => {
    const totals = computeOrderTotals(
      lines.map((line, index) => ({
        lineGross: line.lineGross,
        promotionDiscountPaise: 0,
        couponDiscountPaise: application.perLine[index],
        taxPaise: line.taxPaise,
        lineTotalPaise: line.lineTotalPaise,
      })),
      { shippingPaise: 0, codFeePaise: 4900 },
    );
    assert.equal(totals.subtotalPaise, 288300);
    assert.equal(totals.discountPaise, 0);
    assert.equal(totals.couponDiscountPaise, 25000);
    assert.equal(totals.taxPaise, 25220);
    assert.equal(totals.totalPaise, 268200);
    assert.equal(totals.totalPaise - totals.codFeePaise, 263300);
  });
});

describe("roundHalfUp", () => {
  it("matches floor((a*b + 5000) / 10000) for the default divisor", () => {
    for (const [a, b] of [
      [182657, 1200],
      [1, 1],
      [9999, 5000],
      [12345, 6789],
      [0, 1000],
    ]) {
      assert.equal(roundHalfUp(a, b), Math.floor((a * b + 5000) / 10000));
    }
  });

  it("rounds exact halves up", () => {
    assert.equal(roundHalfUp(5, 1000), 1); // 0.5 -> 1
    assert.equal(roundHalfUp(15, 1000), 2); // 1.5 -> 2
    assert.equal(roundHalfUp(25, 1000), 3); // 2.5 -> 3
  });

  it("handles odd divisors without a fractional half", () => {
    // 100 * 1500 / 11500 = 13.043... -> 13
    assert.equal(roundHalfUp(100, 1500, 11500), 13);
    // 115 * 1500 / 11500 = 15 exactly
    assert.equal(roundHalfUp(115, 1500, 11500), 15);
  });

  it("rounds negative halves towards +infinity", () => {
    assert.equal(roundHalfUp(-5, 1000), 0); // -0.5 -> 0
    assert.equal(roundHalfUp(-15, 1000), -1); // -1.5 -> -1
    assert.equal(roundHalfUp(-7, 1000), -1); // -0.7 -> -1
  });

  it("rejects non-integers", () => {
    assert.throws(() => roundHalfUp(1.5, 10));
    assert.throws(() => roundHalfUp(10, 10, 0));
  });
});

describe("allocate", () => {
  it("always sums to the amount", () => {
    for (const [amount, weights] of [
      [25000, [200000, 55000, 33300]],
      [1, [1, 1, 1]],
      [2, [1, 1, 1]],
      [999, [3, 3, 3, 1]],
      [100, [0, 50, 50]],
    ] as Array<[number, number[]]>) {
      const result = allocate(amount, weights);
      assert.equal(result.reduce((sum, value) => sum + value, 0), amount);
      assert.equal(result.length, weights.length);
    }
  });

  it("breaks remainder ties towards the lowest position", () => {
    assert.deepEqual(allocate(1, [1, 1, 1]), [1, 0, 0]);
    assert.deepEqual(allocate(2, [1, 1, 1]), [1, 1, 0]);
  });

  it("gives nothing to zero-weight lines", () => {
    assert.deepEqual(allocate(100, [0, 50, 50]), [0, 50, 50]);
  });

  it("returns zeros when weights are empty or all zero", () => {
    assert.deepEqual(allocate(100, []), []);
    assert.deepEqual(allocate(100, [0, 0]), [0, 0]);
  });

  it("allocates negative amounts symmetrically", () => {
    assert.deepEqual(allocate(-25000, [200000, 55000, 33300]), [-17343, -4769, -2888]);
  });
});

describe("tax helpers", () => {
  it("inclusive tax at 18% on ₹1,180 is ₹180", () => {
    assert.equal(taxFromInclusive(118000, 1800), 18000);
  });
  it("exclusive tax at 18% on ₹1,000 is ₹180", () => {
    assert.equal(taxFromExclusive(100000, 1800), 18000);
  });
  it("zero rate yields zero tax", () => {
    assert.equal(taxFromInclusive(100000, 0), 0);
    assert.equal(taxFromExclusive(100000, 0), 0);
  });
});

describe("computeLineFinancials", () => {
  it("adds customisation per unit and tax on top when prices exclude tax", () => {
    const line = computeLineFinancials({
      unitPricePaise: 50000,
      customizationPaise: 5000,
      quantity: 2,
      sellerFundedDiscountPaise: 1000,
      platformFundedDiscountPaise: 2000,
      taxRateBps: 500,
      pricesIncludeTax: false,
    });
    assert.equal(line.lineGross, 110000);
    assert.equal(line.discountPaise, 3000);
    assert.equal(line.lineNet, 107000);
    assert.equal(line.taxPaise, 5350);
    assert.equal(line.lineTotalPaise, 112350);
  });

  it("keeps lineTotal equal to lineNet when prices include tax", () => {
    const line = computeLineFinancials({
      unitPricePaise: 200000,
      quantity: 1,
      taxRateBps: 1200,
      pricesIncludeTax: true,
    });
    assert.equal(line.lineTotalPaise, line.lineNet);
    assert.equal(line.taxPaise, 21429);
  });
});

describe("computeCommission (B3)", () => {
  const base = {
    lineGross: 200000,
    sellerFundedDiscountPaise: 0,
    taxRateBps: 1200,
    pricesIncludeTax: true,
    rateBps: 1000,
    fixedPaise: 500,
    quantity: 2,
    paymentMethod: "ONLINE",
  } as const;

  it("computes commission on the tax-exclusive value with per-unit fixed fee", () => {
    const result = computeCommission({ ...base, taxRemittedBy: "SELLER" });
    assert.equal(result.sellerBaseGross, 200000);
    assert.equal(result.taxOnSellerBase, 21429);
    assert.equal(result.taxableValue, 178571);
    assert.equal(result.commissionPaise, 17857 + 1000);
    assert.equal(result.chargesPaise, 0);
    assert.equal(result.sellerGross, 200000);
    assert.equal(result.sellerPayablePaise, 200000 - 18857);
  });

  it("pays the tax-exclusive value when the platform remits tax", () => {
    const result = computeCommission({ ...base, taxRemittedBy: "PLATFORM" });
    assert.equal(result.sellerGross, 178571);
    assert.equal(result.sellerPayablePaise, 178571 - 18857);
  });

  it("deducts seller-funded discounts before commission, not platform-funded ones", () => {
    const result = computeCommission({
      ...base,
      taxRemittedBy: "SELLER",
      sellerFundedDiscountPaise: 20000,
    });
    assert.equal(result.sellerBaseGross, 180000);
    assert.equal(result.taxableValue, 180000 - taxFromInclusive(180000, 1200));
  });

  it("applies charge rules by type and payment method", () => {
    const charges = [
      { code: "gateway", label: "Gateway", type: "PERCENT_OF_GROSS", valueBps: 200, appliesWhen: "ONLINE_PAYMENT" },
      { code: "pack", label: "Packaging", type: "FIXED_PER_ITEM", valuePaise: 1000, appliesWhen: "ALWAYS" },
      { code: "cod", label: "COD handling", type: "FIXED_PER_ORDER", valuePaise: 2500, appliesWhen: "COD" },
    ] as const;

    const online = computeCommission({ ...base, taxRemittedBy: "SELLER", charges: [...charges] });
    assert.equal(online.chargesPaise, 4000 + 2000);

    const cod = computeCommission({
      ...base,
      taxRemittedBy: "SELLER",
      charges: [...charges],
      paymentMethod: "COD",
      applyPerOrderCharges: true,
    });
    assert.equal(cod.chargesPaise, 2000 + 2500);

    const codSecondLine = computeCommission({
      ...base,
      taxRemittedBy: "SELLER",
      charges: [...charges],
      paymentMethod: "COD",
    });
    assert.equal(codSecondLine.chargesPaise, 2000);
  });
});

describe("computeOrderTotals and shipping (B1, B7)", () => {
  const line = {
    lineGross: 100000,
    promotionDiscountPaise: 10000,
    couponDiscountPaise: 5000,
    taxPaise: 0,
    lineTotalPaise: 85000,
  };

  it("adds shipping and COD fee, splitting promotion and coupon discounts", () => {
    const totals = computeOrderTotals([line], { shippingPaise: 9900, codFeePaise: 4900 });
    assert.equal(totals.discountPaise, 10000);
    assert.equal(totals.couponDiscountPaise, 5000);
    assert.equal(totals.totalPaise, 85000 + 9900 + 4900);
  });

  it("records a free-shipping coupon as coupon discount and never waives COD", () => {
    const totals = computeOrderTotals([{ ...line, couponDiscountPaise: 0 }], {
      shippingPaise: 9900,
      codFeePaise: 4900,
      freeShippingCoupon: true,
    });
    assert.equal(totals.couponDiscountPaise, 9900);
    assert.equal(totals.totalPaise, 85000 + 4900);
  });

  it("lets the rate threshold beat the store threshold", () => {
    assert.equal(
      resolveShippingPaise({ ratePaise: 9900, rateFreeAbovePaise: 50000, settingFreeAbovePaise: 99900, discountedSubtotalPaise: 60000 }),
      0,
    );
    assert.equal(
      resolveShippingPaise({ ratePaise: 9900, rateFreeAbovePaise: null, settingFreeAbovePaise: 99900, discountedSubtotalPaise: 60000 }),
      9900,
    );
    assert.equal(
      resolveShippingPaise({ ratePaise: 9900, settingFreeAbovePaise: 0, discountedSubtotalPaise: 60000 }),
      9900,
    );
  });
});

describe("applyCoupon", () => {
  it("rejects below the minimum order", () => {
    const result = applyCoupon({
      coupon: { type: "FIXED", value: 5000, minOrderPaise: 100000 },
      eligibleLines: [{ weightPaise: 50000 }],
      subtotalPaise: 50000,
    });
    assert.equal(result.discountPaise, 0);
    assert.equal(result.rejection, "MIN_ORDER_NOT_MET");
  });

  it("caps a FIXED coupon at the eligible subtotal", () => {
    const result = applyCoupon({
      coupon: { type: "FIXED", value: 90000 },
      eligibleLines: [{ weightPaise: 30000 }, { weightPaise: 20000 }],
      subtotalPaise: 50000,
    });
    assert.equal(result.discountPaise, 50000);
    assert.deepEqual(result.perLine, [30000, 20000]);
  });

  it("flags FREE_SHIPPING without allocating to lines", () => {
    const result = applyCoupon({
      coupon: { type: "FREE_SHIPPING", value: 0 },
      eligibleLines: [{ weightPaise: 30000 }],
      subtotalPaise: 30000,
    });
    assert.equal(result.freeShipping, true);
    assert.deepEqual(result.perLine, [0]);
  });

  it("reports when no line is eligible", () => {
    const result = applyCoupon({
      coupon: { type: "PERCENT", value: 10 },
      eligibleLines: [],
      subtotalPaise: 30000,
    });
    assert.equal(result.rejection, "NO_ELIGIBLE_LINES");
  });
});

describe("scope and promotions", () => {
  const line = { productId: "p1", sellerId: "s1", categoryAncestorIds: ["root", "child"] };

  it("matches scopes and honours exclusions", () => {
    assert.equal(lineInScope({ appliesTo: "ALL" }, line), true);
    assert.equal(lineInScope({ appliesTo: "CATEGORIES", categoryIds: ["root"] }, line), true);
    assert.equal(lineInScope({ appliesTo: "CATEGORIES", categoryIds: ["other"] }, line), false);
    assert.equal(lineInScope({ appliesTo: "PRODUCTS", productIds: ["p1"] }, line), true);
    assert.equal(lineInScope({ appliesTo: "SELLERS", sellerIds: ["s2"] }, line), false);
    assert.equal(lineInScope({ appliesTo: "ALL", excludedProductIds: ["p1"] }, line), false);
  });

  it("computes promotion prices per unit and never below zero", () => {
    assert.equal(promotionUnitPrice(99900, { discountType: "PERCENT", value: 20 }), 79920);
    assert.equal(promotionUnitPrice(99900, { discountType: "FIXED", value: 10000 }), 89900);
    assert.equal(promotionUnitPrice(5000, { discountType: "FIXED", value: 10000 }), 0);
  });

  it("allocates promotion discount per line as (unit − promo unit) × qty", () => {
    const result = applyPromotion({
      promotion: { discountType: "PERCENT", value: 10 },
      lines: [
        { unitPricePaise: 99900, quantity: 2 },
        { unitPricePaise: 5, quantity: 1 },
      ],
    });
    assert.deepEqual(result.perLine, [19980, 1]);
    assert.equal(result.discountPaise, 19981);
  });
});

describe("derived statuses", () => {
  const now = new Date("2026-09-07T10:00:00Z");

  it("derives coupon status in precedence order", () => {
    const base = { isActive: true, usageCount: 0 };
    assert.equal(deriveCouponStatus({ ...base, isActive: false }, now), "DISABLED");
    assert.equal(deriveCouponStatus({ ...base, deletedAt: now }, now), "DISABLED");
    assert.equal(deriveCouponStatus({ ...base, usageLimit: 5, usageCount: 5 }, now), "EXHAUSTED");
    assert.equal(deriveCouponStatus({ ...base, startsAt: new Date("2026-10-01") }, now), "SCHEDULED");
    assert.equal(deriveCouponStatus({ ...base, endsAt: new Date("2026-01-01") }, now), "EXPIRED");
    assert.equal(deriveCouponStatus(base, now), "ACTIVE");
  });

  it("derives payment status per B6", () => {
    const total = 100000;
    assert.equal(derivePaymentStatus({ paidPaise: 100000, refundedPaise: 100000, totalPaise: total, orderStatus: "REFUNDED" }), "REFUNDED");
    assert.equal(derivePaymentStatus({ paidPaise: 100000, refundedPaise: 30000, totalPaise: total, orderStatus: "DELIVERED" }), "PARTIALLY_REFUNDED");
    assert.equal(derivePaymentStatus({ paidPaise: 100000, refundedPaise: 0, totalPaise: total, orderStatus: "CONFIRMED" }), "PAID");
    assert.equal(derivePaymentStatus({ paidPaise: 0, refundedPaise: 0, totalPaise: total, orderStatus: "PENDING", hasAuthorization: true }), "AUTHORIZED");
    assert.equal(derivePaymentStatus({ paidPaise: 0, refundedPaise: 0, totalPaise: total, orderStatus: "CANCELLED" }), "CANCELLED");
    assert.equal(derivePaymentStatus({ paidPaise: 0, refundedPaise: 0, totalPaise: total, orderStatus: "FAILED" }), "FAILED");
    assert.equal(derivePaymentStatus({ paidPaise: 0, refundedPaise: 0, totalPaise: total, orderStatus: "PENDING" }), "PENDING");
    assert.equal(derivePaymentStatus({ paidPaise: 50000, refundedPaise: 0, totalPaise: total, orderStatus: "CANCELLED" }), "PENDING");
  });
});

describe("proRata (B4)", () => {
  it("rounds intermediate units and gives the last unit the exact remainder", () => {
    const total = 10001;
    const first = proRata(total, 1, 3, 0);
    const second = proRata(total, 1, 3, first);
    // The final unit is signalled by k >= n from the caller's perspective.
    const finalUnit = proRata(total, 3, 3, first + second);
    assert.equal(first, 3334);
    assert.equal(second, 3334);
    assert.equal(finalUnit, total - first - second);
    assert.equal(first + second + finalUnit, total);
  });
});
