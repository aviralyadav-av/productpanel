import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveFulfillmentStatus, deriveOrderState, deriveReturnStatus, type DerivationItem } from "./derived";

/**
 * Order status past PACKED is a function of the rows, not a column an operator
 * sets (blueprint §14.C1, C2, C4). These cases are the specification: if one
 * of them changes, a customer somewhere is being told the wrong thing about
 * where their parcel is.
 */

const AT = new Date("2026-09-01T10:00:00Z");

function item(overrides: Partial<DerivationItem> = {}): DerivationItem {
  return { status: "ACTIVE", quantity: 1, returnedQty: 0, shippedAt: null, deliveredAt: null, ...overrides };
}

function state(overrides: Partial<Parameters<typeof deriveOrderState>[0]> = {}) {
  return deriveOrderState({
    current: "CONFIRMED",
    items: [item()],
    shipments: [],
    openReturns: 0,
    paidPaise: 0,
    refundedPaise: 0,
    ...overrides,
  });
}

describe("deriveFulfillmentStatus (C1)", () => {
  it("is UNFULFILLED with no shipped lines", () => {
    assert.equal(deriveFulfillmentStatus([item(), item()]), "UNFULFILLED");
  });

  it("is PARTIAL when some lines shipped", () => {
    assert.equal(deriveFulfillmentStatus([item({ shippedAt: AT }), item()]), "PARTIAL");
  });

  it("is FULFILLED when every ACTIVE line shipped, ignoring cancelled ones", () => {
    assert.equal(deriveFulfillmentStatus([item({ shippedAt: AT }), item({ status: "CANCELLED" })]), "FULFILLED");
  });

  it("is UNFULFILLED when every line is cancelled", () => {
    assert.equal(deriveFulfillmentStatus([item({ status: "CANCELLED" })]), "UNFULFILLED");
  });
});

describe("deriveReturnStatus (C4)", () => {
  it("is REQUESTED while any RMA is open, whatever the quantities say", () => {
    assert.equal(deriveReturnStatus([item()], 1), "REQUESTED");
  });

  it("is FULL only when every active line is fully returned", () => {
    assert.equal(deriveReturnStatus([item({ quantity: 2, returnedQty: 2 })], 0), "FULL");
    assert.equal(deriveReturnStatus([item({ quantity: 2, returnedQty: 1 })], 0), "PARTIAL");
    assert.equal(deriveReturnStatus([item({ quantity: 2, returnedQty: 2 }), item()], 0), "PARTIAL");
  });

  it("is NONE with no returns", () => {
    assert.equal(deriveReturnStatus([item()], 0), "NONE");
  });
});

describe("deriveOrderState - transit (C1)", () => {
  it("keeps the manual pre-shipment status while nothing has shipped", () => {
    assert.equal(state({ current: "PROCESSING" }).status, "PROCESSING");
    assert.equal(state({ current: "PACKED" }).status, "PACKED");
  });

  it("is SHIPPED once a shipment is in transit", () => {
    assert.equal(state({ current: "PACKED", items: [item({ shippedAt: AT })], shipments: [{ status: "IN_TRANSIT" }] }).status, "SHIPPED");
  });

  it("is OUT_FOR_DELIVERY when a shipment is with the agent and not everything is delivered", () => {
    const result = state({
      current: "SHIPPED",
      items: [item({ shippedAt: AT }), item({ shippedAt: AT })],
      shipments: [{ status: "OUT_FOR_DELIVERY" }, { status: "DELIVERED" }],
    });
    assert.equal(result.status, "OUT_FOR_DELIVERY");
  });

  it("is DELIVERED only when every active line carries a deliveredAt", () => {
    const partial = state({
      current: "SHIPPED",
      items: [item({ shippedAt: AT, deliveredAt: AT }), item({ shippedAt: AT })],
      shipments: [{ status: "DELIVERED" }],
    });
    assert.equal(partial.status, "SHIPPED");

    const full = state({
      current: "SHIPPED",
      items: [item({ shippedAt: AT, deliveredAt: AT }), item({ shippedAt: AT, deliveredAt: AT })],
      shipments: [{ status: "DELIVERED" }],
    });
    assert.equal(full.status, "DELIVERED");
    assert.equal(full.fulfillmentStatus, "FULFILLED");
  });

  it("ignores cancelled shipments when deciding transit", () => {
    const result = state({ current: "PACKED", items: [item()], shipments: [{ status: "CANCELLED" }] });
    assert.equal(result.status, "PACKED");
  });

  it("falls back to PACKED when the evidence for a derived status disappears", () => {
    const result = state({ current: "SHIPPED", items: [item()], shipments: [{ status: "CANCELLED" }] });
    assert.equal(result.status, "PACKED");
  });
});

describe("deriveOrderState - returns and refunds (C4, B6)", () => {
  it("is RETURN_REQUESTED while an RMA is open on a delivered order", () => {
    const result = state({
      current: "DELIVERED",
      items: [item({ shippedAt: AT, deliveredAt: AT })],
      shipments: [{ status: "DELIVERED" }],
      openReturns: 1,
    });
    assert.equal(result.status, "RETURN_REQUESTED");
    assert.equal(result.returnStatus, "REQUESTED");
  });

  it("is RETURNED when every line came back and the money has not", () => {
    const result = state({
      current: "RETURN_REQUESTED",
      items: [item({ quantity: 1, returnedQty: 1, shippedAt: AT, deliveredAt: AT })],
      shipments: [{ status: "DELIVERED" }],
      paidPaise: 100000,
      refundedPaise: 0,
    });
    assert.equal(result.status, "RETURNED");
  });

  it("is REFUNDED once the refund covers what was paid", () => {
    const result = state({
      current: "RETURNED",
      items: [item({ quantity: 1, returnedQty: 1, shippedAt: AT, deliveredAt: AT })],
      shipments: [{ status: "DELIVERED" }],
      paidPaise: 100000,
      refundedPaise: 100000,
    });
    assert.equal(result.status, "REFUNDED");
  });

  it("stays RETURNED on a partial refund", () => {
    const result = state({
      current: "RETURNED",
      items: [item({ quantity: 1, returnedQty: 1, shippedAt: AT, deliveredAt: AT })],
      shipments: [{ status: "DELIVERED" }],
      paidPaise: 100000,
      refundedPaise: 40000,
    });
    assert.equal(result.status, "RETURNED");
  });
});

describe("deriveOrderState - terminal states", () => {
  it("never re-derives CANCELLED or FAILED", () => {
    assert.equal(state({ current: "CANCELLED", items: [item({ shippedAt: AT, deliveredAt: AT })], shipments: [{ status: "DELIVERED" }] }).status, "CANCELLED");
    assert.equal(state({ current: "FAILED" }).status, "FAILED");
  });

  it("cancels an order whose every line was cancelled (C2)", () => {
    assert.equal(state({ current: "CONFIRMED", items: [item({ status: "CANCELLED" })] }).status, "CANCELLED");
  });
});
