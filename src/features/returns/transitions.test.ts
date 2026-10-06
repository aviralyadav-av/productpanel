import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OPEN_RETURN_STATUSES,
  REFUND_STATUSES,
  REFUND_TRANSITIONS,
  RETURN_REQUEST_STATUSES,
  RETURN_REQUEST_TRANSITIONS,
  canTransitionRefund,
  canTransitionReturn,
  type RefundStatus,
  type ReturnRequestStatus,
} from "@/lib/enums";

import { CLOSED_RETURN_STATUSES, RETURN_BULK_TARGET, RETURN_FLOW_STEPS, returnFlowIndex } from "./schemas";

/**
 * The two state machines this module drives (blueprint §14.C4, B6).
 *
 * The transition tables live in enums.ts (frozen), but the RETURNS and REFUNDS
 * screens read them to decide which buttons exist, and the services trust them
 * to reject anything else. These assertions pin the properties both sides rely
 * on: the flow reaches its end, the terminals are terminal, no state is
 * stranded, and the open/closed split covers every status exactly once.
 */

describe("return transitions (C4)", () => {
  it("walks the happy path from REQUESTED to CLOSED", () => {
    const path: ReturnRequestStatus[] = [
      "REQUESTED",
      "UNDER_REVIEW",
      "APPROVED",
      "PICKUP_SCHEDULED",
      "RECEIVED",
      "QC_PASSED",
      "REFUND_INITIATED",
      "REFUND_COMPLETED",
      "CLOSED",
    ];
    for (let index = 0; index < path.length - 1; index += 1) {
      assert.equal(canTransitionReturn(path[index], path[index + 1]), true, `${path[index]} → ${path[index + 1]}`);
    }
  });

  it("offers a replacement branch out of QC_PASSED and a refund branch out of QC_FAILED", () => {
    assert.equal(canTransitionReturn("QC_PASSED", "REPLACEMENT_SHIPPED"), true);
    assert.equal(canTransitionReturn("REPLACEMENT_SHIPPED", "CLOSED"), true);
    assert.equal(canTransitionReturn("QC_FAILED", "REFUND_INITIATED"), true);
    assert.equal(canTransitionReturn("QC_FAILED", "CLOSED"), true);
  });

  it("allows a cancellation only before the goods are collected", () => {
    for (const status of ["REQUESTED", "UNDER_REVIEW", "APPROVED", "PICKUP_SCHEDULED"] as ReturnRequestStatus[]) {
      assert.equal(canTransitionReturn(status, "CANCELLED"), true, status);
    }
    for (const status of ["RECEIVED", "QC_PASSED", "QC_FAILED", "REFUND_INITIATED"] as ReturnRequestStatus[]) {
      assert.equal(canTransitionReturn(status, "CANCELLED"), false, status);
    }
  });

  it("refuses to skip QC or to un-receive goods", () => {
    assert.equal(canTransitionReturn("APPROVED", "QC_PASSED"), false);
    assert.equal(canTransitionReturn("RECEIVED", "REFUND_INITIATED"), false);
    assert.equal(canTransitionReturn("RECEIVED", "PICKUP_SCHEDULED"), false);
    assert.equal(canTransitionReturn("REQUESTED", "REFUND_COMPLETED"), false);
  });

  it("has exactly two terminal states", () => {
    const terminal = RETURN_REQUEST_STATUSES.filter((status) => RETURN_REQUEST_TRANSITIONS[status].length === 0);
    assert.deepEqual([...terminal].sort(), ["CANCELLED", "CLOSED"].sort());
  });

  it("leaves no status unreachable from REQUESTED", () => {
    const seen = new Set<ReturnRequestStatus>(["REQUESTED"]);
    const queue: ReturnRequestStatus[] = ["REQUESTED"];
    while (queue.length) {
      const current = queue.shift()!;
      for (const next of RETURN_REQUEST_TRANSITIONS[current]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    for (const status of RETURN_REQUEST_STATUSES) {
      assert.equal(seen.has(status), true, `${status} is unreachable`);
    }
  });

  it("splits every status into exactly one of open or closed", () => {
    for (const status of RETURN_REQUEST_STATUSES) {
      const open = OPEN_RETURN_STATUSES.includes(status);
      const closed = CLOSED_RETURN_STATUSES.includes(status);
      assert.equal(open !== closed, true, `${status} is in both or neither bucket`);
    }
  });

  it("treats REPLACEMENT_SHIPPED as settled, not open", () => {
    // The goods are back and the replacement is out: nothing about this RMA
    // should keep holding the order in "return requested".
    assert.equal(OPEN_RETURN_STATUSES.includes("REPLACEMENT_SHIPPED"), false);
  });

  it("targets every bulk operation at a legal status", () => {
    for (const [op, target] of Object.entries(RETURN_BULK_TARGET)) {
      assert.equal(RETURN_REQUEST_STATUSES.includes(target), true, `${op} → ${target}`);
    }
  });

  it("places every happy-path step on the stepper, in order", () => {
    assert.equal(RETURN_FLOW_STEPS[0], "REQUESTED");
    assert.equal(RETURN_FLOW_STEPS.at(-1), "CLOSED");
    assert.equal(returnFlowIndex("REQUESTED"), 0);
    assert.ok(returnFlowIndex("QC_PASSED") > returnFlowIndex("RECEIVED"));
    // Off-path states borrow the position of the step they replace, so the
    // Stepper never jumps back to the start for a failed QC.
    assert.equal(returnFlowIndex("QC_FAILED"), returnFlowIndex("QC_PASSED"));
    assert.equal(returnFlowIndex("REPLACEMENT_SHIPPED"), returnFlowIndex("REFUND_COMPLETED"));
  });
});

describe("refund transitions (B6)", () => {
  it("walks PENDING → APPROVED → PROCESSING → COMPLETED", () => {
    const path: RefundStatus[] = ["PENDING", "APPROVED", "PROCESSING", "COMPLETED"];
    for (let index = 0; index < path.length - 1; index += 1) {
      assert.equal(canTransitionRefund(path[index], path[index + 1]), true, `${path[index]} → ${path[index + 1]}`);
    }
  });

  it("only fails from PROCESSING, and a failure can be retried", () => {
    assert.equal(canTransitionRefund("PROCESSING", "FAILED"), true);
    assert.equal(canTransitionRefund("PENDING", "FAILED"), false);
    assert.equal(canTransitionRefund("APPROVED", "FAILED"), false);
    assert.equal(canTransitionRefund("FAILED", "PENDING"), true);
  });

  it("never lets a refund skip approval or un-complete itself", () => {
    assert.equal(canTransitionRefund("PENDING", "PROCESSING"), false);
    assert.equal(canTransitionRefund("PENDING", "COMPLETED"), false);
    assert.equal(canTransitionRefund("COMPLETED", "CANCELLED"), false);
    assert.equal(canTransitionRefund("COMPLETED", "FAILED"), false);
  });

  it("can be cancelled only before the money is in flight", () => {
    assert.equal(canTransitionRefund("PENDING", "CANCELLED"), true);
    assert.equal(canTransitionRefund("APPROVED", "CANCELLED"), true);
    assert.equal(canTransitionRefund("PROCESSING", "CANCELLED"), false);
  });

  it("has COMPLETED and CANCELLED as its only terminals", () => {
    const terminal = REFUND_STATUSES.filter((status) => REFUND_TRANSITIONS[status].length === 0);
    assert.deepEqual([...terminal].sort(), ["CANCELLED", "COMPLETED"].sort());
  });
});
