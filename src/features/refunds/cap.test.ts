import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isCustomerFaultReason,
  isSellerFaultReason,
  isShippingRefundableReason,
  returnRefundCap,
  unitShare,
  type ReturnCapInput,
} from "./cap";

/**
 * The refund cap is the last thing standing between an operator's typo and
 * money leaving the business twice (blueprint §14.B6, B5, §11.11). These cases
 * ARE the rule; if one of them changes, the ledger changes with it.
 */

function input(overrides: Partial<ReturnCapInput> = {}): ReturnCapInput {
  return {
    lineTotalPaise: 100_000,
    itemQuantity: 2,
    returnQuantity: 1,
    itemRefundedPaise: 0,
    shippingPaise: 5_000,
    allLinesReturned: false,
    reason: "CHANGED_MIND",
    pickupFeePaise: 0,
    customerPaysPickup: false,
    orderRemainingPaise: 1_000_000,
    ...overrides,
  };
}

describe("unitShare", () => {
  it("returns the whole line when every unit comes back", () => {
    assert.equal(unitShare(100_001, 3, 3), 100_001);
  });

  it("floors a partial share so partials can never sum above the line", () => {
    // 100001 / 3 = 33333.67 → 33333 each; three of them = 99999 ≤ 100001.
    assert.equal(unitShare(100_001, 3, 1), 33_333);
    assert.equal(unitShare(100_001, 3, 1) * 3 <= 100_001, true);
  });

  it("is zero for nonsense input rather than negative", () => {
    assert.equal(unitShare(100_000, 0, 1), 0);
    assert.equal(unitShare(100_000, 2, 0), 0);
  });
});

describe("reason classification (B5, B6)", () => {
  it("treats the four seller-fault reasons as seller fault", () => {
    for (const reason of ["DAMAGED", "DEFECTIVE", "WRONG_ITEM", "NOT_AS_DESCRIBED"]) {
      assert.equal(isSellerFaultReason(reason), true, reason);
    }
    assert.equal(isSellerFaultReason("CHANGED_MIND"), false);
  });

  it("refunds shipping for seller fault and for a late delivery", () => {
    assert.equal(isShippingRefundableReason("DEFECTIVE"), true);
    assert.equal(isShippingRefundableReason("LATE_DELIVERY"), true);
    assert.equal(isShippingRefundableReason("SIZE_ISSUE"), false);
  });

  it("only asks the customer to carry the pickup for their own change of heart", () => {
    assert.equal(isCustomerFaultReason("CHANGED_MIND"), true);
    assert.equal(isCustomerFaultReason("SIZE_ISSUE"), true);
    assert.equal(isCustomerFaultReason("DAMAGED"), false);
  });
});

describe("returnRefundCap", () => {
  it("caps a partial return at the returned units' share, no shipping", () => {
    const cap = returnRefundCap(input());
    assert.equal(cap.itemSharePaise, 50_000);
    assert.equal(cap.shippingPaise, 0);
    assert.equal(cap.capPaise, 50_000);
  });

  it("adds shipping when every line on the order is coming back", () => {
    const cap = returnRefundCap(input({ returnQuantity: 2, allLinesReturned: true }));
    assert.equal(cap.itemSharePaise, 100_000);
    assert.equal(cap.shippingPaise, 5_000);
    assert.equal(cap.capPaise, 105_000);
  });

  it("adds shipping for a seller-fault reason even on a partial return", () => {
    const cap = returnRefundCap(input({ reason: "DAMAGED" }));
    assert.equal(cap.shippingPaise, 5_000);
    assert.equal(cap.capPaise, 55_000);
  });

  it("deducts what has already been refunded against the line", () => {
    const cap = returnRefundCap(input({ itemRefundedPaise: 20_000 }));
    assert.equal(cap.alreadyRefundedPaise, 20_000);
    assert.equal(cap.capPaise, 30_000);
  });

  it("deducts the pickup fee only for a customer-fault reason with the setting on", () => {
    assert.equal(returnRefundCap(input({ pickupFeePaise: 4_000, customerPaysPickup: true })).capPaise, 46_000);
    assert.equal(returnRefundCap(input({ pickupFeePaise: 4_000, customerPaysPickup: false })).capPaise, 50_000);
    assert.equal(
      returnRefundCap(input({ reason: "DEFECTIVE", pickupFeePaise: 4_000, customerPaysPickup: true })).capPaise,
      55_000,
      "a seller-fault return never charges the customer for the pickup",
    );
  });

  it("never exceeds what is still refundable on the order as a whole (§11.11)", () => {
    const cap = returnRefundCap(input({ orderRemainingPaise: 12_000 }));
    assert.equal(cap.rmaCapPaise, 50_000);
    assert.equal(cap.capPaise, 12_000);
    assert.ok(cap.notes.some((note) => note.includes("Capped by what is still refundable")));
  });

  it("floors at zero rather than going negative", () => {
    const cap = returnRefundCap(input({ itemRefundedPaise: 90_000, pickupFeePaise: 9_000, customerPaysPickup: true }));
    assert.equal(cap.capPaise, 0);
  });

  it("is zero once the order has nothing left to give back", () => {
    assert.equal(returnRefundCap(input({ orderRemainingPaise: 0 })).capPaise, 0);
  });
});
