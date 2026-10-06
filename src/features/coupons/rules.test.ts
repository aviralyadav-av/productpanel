import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ancestorIdsForLine, evaluateCoupon, type CartLine, type CouponRuleRow } from "./rules";

/**
 * The rule engine is a pure function, so these tests are the specification
 * of §11.8 / §14.B2 for coupons: which carts a coupon accepts and how much it
 * takes off, to the paisa.
 */

const NOW = new Date("2026-09-08T10:00:00.000Z");

function coupon(overrides: Partial<CouponRuleRow> = {}): CouponRuleRow {
  return {
    id: "c1",
    code: "WELCOME10",
    type: "PERCENT",
    value: 10,
    maxDiscountPaise: 25_000,
    minOrderPaise: 49_900,
    appliesTo: "ALL",
    categoryIds: [],
    productIds: [],
    sellerIds: [],
    excludedProductIds: [],
    firstOrderOnly: false,
    customerIds: [],
    usageLimit: null,
    perCustomerLimit: null,
    usageCount: 0,
    startsAt: null,
    endsAt: null,
    isActive: true,
    deletedAt: null,
    fundedBy: "PLATFORM",
    ...overrides,
  };
}

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    productId: "p1",
    variantId: null,
    sellerId: "s1",
    categoryId: "cat-leaf",
    categoryPath: "/jewellery/earrings",
    quantity: 1,
    unitPricePaise: 100_000,
    ...overrides,
  };
}

const guest = { customerId: null, email: null, usageCount: 0, priorOrderCount: 0 };

describe("evaluateCoupon", () => {
  it("applies a percentage across eligible lines and allocates to the paisa", () => {
    const result = evaluateCoupon({
      coupon: coupon({ minOrderPaise: null, maxDiscountPaise: null }),
      lines: [line({ productId: "a", unitPricePaise: 33_333 }), line({ productId: "b", unitPricePaise: 33_333 })],
      customer: guest,
      now: NOW,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // 10% of 66,666 = 6,666.6 -> 6,667 half-up; split 3,334 / 3,333 by remainder rule.
    assert.equal(result.discountPaise, 6_667);
    assert.deepEqual(
      result.perLine.map((entry) => entry.discountPaise),
      [3_334, 3_333],
    );
    assert.equal(result.perLine.reduce((sum, entry) => sum + entry.discountPaise, 0), result.discountPaise);
  });

  it("caps a percentage at maxDiscountPaise and a fixed amount at the eligible subtotal", () => {
    const percent = evaluateCoupon({ coupon: coupon(), lines: [line({ unitPricePaise: 500_000 })], customer: guest, now: NOW });
    assert.equal(percent.ok && percent.discountPaise, 25_000);

    const fixed = evaluateCoupon({
      coupon: coupon({ type: "FIXED", value: 50_000, minOrderPaise: null, maxDiscountPaise: null }),
      lines: [line({ unitPricePaise: 20_000 })],
      customer: guest,
      now: NOW,
    });
    assert.equal(fixed.ok && fixed.discountPaise, 20_000);
  });

  it("rejects when the discounted subtotal is below the minimum order", () => {
    const result = evaluateCoupon({ coupon: coupon(), lines: [line({ unitPricePaise: 40_000 })], customer: guest, now: NOW });
    assert.deepEqual(result.ok ? null : result.reason, "MIN_ORDER_NOT_MET");
  });

  it("derives lifecycle rejections from the row", () => {
    const cases: Array<[Partial<CouponRuleRow>, string]> = [
      [{ isActive: false }, "DISABLED"],
      [{ deletedAt: NOW }, "DISABLED"],
      [{ usageLimit: 5, usageCount: 5 }, "EXHAUSTED"],
      [{ startsAt: new Date("2026-10-01T00:00:00Z") }, "SCHEDULED"],
      [{ endsAt: new Date("2026-01-01T00:00:00Z") }, "EXPIRED"],
    ];
    for (const [overrides, reason] of cases) {
      const result = evaluateCoupon({ coupon: coupon(overrides), lines: [line()], customer: guest, now: NOW });
      assert.equal(result.ok ? "ok" : result.reason, reason, JSON.stringify(overrides));
    }
  });

  it("matches category scope by path prefix (descendants included) and honours exclusions", () => {
    const scoped = coupon({ appliesTo: "CATEGORIES", categoryIds: ["cat-jewellery"], excludedProductIds: ["p-excluded"], minOrderPaise: null });
    const scopeCategories = [{ id: "cat-jewellery", path: "/jewellery" }];
    const result = evaluateCoupon({
      coupon: scoped,
      lines: [
        line({ productId: "in", categoryPath: "/jewellery/earrings", unitPricePaise: 10_000 }),
        line({ productId: "out", categoryPath: "/home-living/decor", unitPricePaise: 10_000 }),
        line({ productId: "p-excluded", categoryPath: "/jewellery", unitPricePaise: 10_000 }),
        // A sibling whose slug merely starts with the same letters must NOT match.
        line({ productId: "lookalike", categoryPath: "/jewellery-boxes", unitPricePaise: 10_000 }),
      ],
      scopeCategories,
      customer: guest,
      now: NOW,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.perLine.map((entry) => entry.discountPaise),
      [1_000, 0, 0, 0],
    );
  });

  it("uses the line's own category id when no path is available", () => {
    assert.deepEqual(ancestorIdsForLine({ categoryId: "leaf", categoryPath: null }, [{ id: "root", path: "/root" }]), ["leaf"]);
    assert.deepEqual(
      ancestorIdsForLine({ categoryId: "leaf", categoryPath: "/root/leaf" }, [{ id: "root", path: "/root" }]),
      ["leaf", "root"],
    );
  });

  it("weights lines by lineGross minus the promotion allocation (coupon second)", () => {
    const result = evaluateCoupon({
      coupon: coupon({ minOrderPaise: null, maxDiscountPaise: null }),
      lines: [line({ unitPricePaise: 100_000, customizationPaise: 10_000, quantity: 2, promotionDiscountPaise: 20_000 })],
      customer: guest,
      now: NOW,
    });
    // (100,000 + 10,000) × 2 − 20,000 = 200,000 → 10% = 20,000
    assert.equal(result.ok && result.discountPaise, 20_000);
  });

  it("enforces customer targeting, first-order and per-customer limits", () => {
    const targeted = coupon({ customerIds: ["vip"], minOrderPaise: null });
    assert.equal(evaluateCoupon({ coupon: targeted, lines: [line()], customer: guest, now: NOW }).ok, false);
    const stranger = evaluateCoupon({ coupon: targeted, lines: [line()], customer: { ...guest, customerId: "other" }, now: NOW });
    assert.equal(!stranger.ok && stranger.reason, "NOT_ELIGIBLE_CUSTOMER");
    assert.equal(evaluateCoupon({ coupon: targeted, lines: [line()], customer: { ...guest, customerId: "vip" }, now: NOW }).ok, true);

    const first = evaluateCoupon({
      coupon: coupon({ firstOrderOnly: true, minOrderPaise: null }),
      lines: [line()],
      customer: { ...guest, customerId: "c", priorOrderCount: 2 },
      now: NOW,
    });
    assert.equal(!first.ok && first.reason, "FIRST_ORDER_ONLY");

    const capped = evaluateCoupon({
      coupon: coupon({ perCustomerLimit: 1, minOrderPaise: null }),
      lines: [line()],
      customer: { ...guest, customerId: "c", usageCount: 1 },
      now: NOW,
    });
    assert.equal(!capped.ok && capped.reason, "PER_CUSTOMER_LIMIT");
  });

  it("free shipping carries no item discount but zeroes the remaining shipping charge", () => {
    const result = evaluateCoupon({
      coupon: coupon({ type: "FREE_SHIPPING", value: 0, minOrderPaise: 59_900, maxDiscountPaise: null }),
      lines: [line({ unitPricePaise: 80_000 })],
      customer: guest,
      shippingPaise: 7_900,
      now: NOW,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.discountPaise, 0);
    assert.equal(result.freeShipping, true);
    assert.equal(result.shippingDiscountPaise, 7_900);
  });

  it("rejects a cart with nothing in scope", () => {
    const result = evaluateCoupon({
      coupon: coupon({ appliesTo: "PRODUCTS", productIds: ["x"], minOrderPaise: null }),
      lines: [line({ productId: "y" })],
      customer: guest,
      now: NOW,
    });
    assert.equal(!result.ok && result.reason, "NO_ELIGIBLE_LINES");
  });
});
