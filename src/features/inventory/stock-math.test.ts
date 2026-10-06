import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatSigned, isAdjustMode, previewAdjustment, resolveDelta } from "./stock-math";

/**
 * Run with: node --import tsx --test src/features/inventory/stock-math.test.ts
 * The delta maths behind every manual adjustment (§11.7, F7): the dialog
 * preview, the CSV dry run and the service must agree on these numbers.
 */

describe("resolveDelta", () => {
  it("add is +quantity, remove is -quantity", () => {
    assert.equal(resolveDelta("add", 4, 10), 4);
    assert.equal(resolveDelta("remove", 4, 10), -4);
  });

  it("set derives the delta from the current balance", () => {
    assert.equal(resolveDelta("set", 10, 10), 0);
    assert.equal(resolveDelta("set", 3, 10), -7);
    assert.equal(resolveDelta("set", 12, 10), 2);
    assert.equal(resolveDelta("set", 0, 5), -5);
  });

  it("truncates fractional input rather than moving part of a unit", () => {
    assert.equal(resolveDelta("add", 2.9, 0), 2);
    assert.equal(resolveDelta("set", 7.5, 3.2), 4);
  });
});

describe("previewAdjustment", () => {
  const base = { onHand: 10, reserved: 3, lowStockThreshold: 3, allowBackorder: false };

  it("computes the next balances and state", () => {
    const preview = previewAdjustment({ ...base, mode: "remove", quantity: 5 });
    assert.equal(preview.delta, -5);
    assert.equal(preview.nextOnHand, 5);
    assert.equal(preview.nextAvailable, 2);
    assert.equal(preview.nextState, "LOW_STOCK");
    assert.equal(preview.blocked, false);
    assert.equal(preview.noop, false);
  });

  it("blocks a result below zero available unless backorders are allowed", () => {
    const blocked = previewAdjustment({ ...base, mode: "remove", quantity: 8 });
    assert.equal(blocked.nextAvailable, -1);
    assert.equal(blocked.negative, true);
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.nextState, "OUT_OF_STOCK");

    const allowed = previewAdjustment({ ...base, allowBackorder: true, mode: "remove", quantity: 8 });
    assert.equal(allowed.negative, true);
    assert.equal(allowed.blocked, false);
    assert.equal(allowed.nextState, "BACKORDER");
  });

  it("reserved units count against availability: removing down to the reserved figure is fine, one more is not", () => {
    assert.equal(previewAdjustment({ ...base, mode: "set", quantity: 3 }).blocked, false);
    assert.equal(previewAdjustment({ ...base, mode: "set", quantity: 2 }).blocked, true);
  });

  it("flags a no-op when nothing would move", () => {
    assert.equal(previewAdjustment({ ...base, mode: "set", quantity: 10 }).noop, true);
    assert.equal(previewAdjustment({ ...base, mode: "add", quantity: 0 }).noop, true);
  });

  it("an add up then remove down nets to zero", () => {
    const up = previewAdjustment({ ...base, mode: "add", quantity: 6 });
    const down = previewAdjustment({ ...base, onHand: up.nextOnHand, mode: "remove", quantity: 6 });
    assert.equal(up.delta + down.delta, 0);
    assert.equal(down.nextOnHand, base.onHand);
  });
});

describe("helpers", () => {
  it("formatSigned follows the ledger convention", () => {
    assert.equal(formatSigned(3), "+3");
    assert.equal(formatSigned(-2), "-2");
    assert.equal(formatSigned(0), "0");
  });

  it("isAdjustMode narrows strings", () => {
    assert.equal(isAdjustMode("set"), true);
    assert.equal(isAdjustMode("SET"), false);
    assert.equal(isAdjustMode(1), false);
  });
});
