import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkStatementIdentity,
  expectedNetPaise,
  formatBps,
  formatWindow,
  maskAccountNumber,
  parseBankSnapshot,
  payoutStepIndex,
  payoutSteps,
  statementLines,
  type StatementTotals,
} from "./ui-identity";

/**
 * Run with: node --import tsx --test src/features/finance/ui-identity.test.ts
 *
 * These pin what the payout screen SHOWS. `generatePayout` already asserts the
 * B5 identity at write time; if the display arithmetic here ever drifts from
 * it, an operator would approve a number the ledger does not hold.
 */

const BALANCED: StatementTotals = {
  grossSalesPaise: 268200,
  commissionPaise: 26820,
  chargesPaise: 4000,
  refundsPaise: 12000,
  adjustmentsPaise: 5000,
  netPaise: 268200 - 26820 - 4000 - 12000 + 5000,
};

describe("B5 statement identity", () => {
  it("computes net = gross - commission - charges - refunds + adjustments", () => {
    assert.equal(expectedNetPaise(BALANCED), 230380);
    assert.equal(BALANCED.netPaise, 230380);
  });

  it("passes when the columns and the ledger sum agree", () => {
    const check = checkStatementIdentity(BALANCED, 230380);
    assert.equal(check.balanced, true);
    assert.equal(check.differencePaise, 0);
    assert.equal(check.ledgerDifferencePaise, 0);
    assert.match(check.message, /matches the formula and the signed sum/);
  });

  it("passes on the formula alone when the entries were not loaded", () => {
    const check = checkStatementIdentity(BALANCED);
    assert.equal(check.balanced, true);
    assert.equal(check.ledgerSumPaise, null);
    assert.equal(check.ledgerDifferencePaise, null);
  });

  it("reports a stored net that does not satisfy the formula", () => {
    const check = checkStatementIdentity({ ...BALANCED, netPaise: 230381 }, 230381);
    assert.equal(check.balanced, false);
    assert.equal(check.differencePaise, 1);
    assert.match(check.message, /does not match gross/);
  });

  it("reports a statement that disagrees with its own ledger rows", () => {
    const check = checkStatementIdentity(BALANCED, 230379);
    assert.equal(check.balanced, false);
    assert.equal(check.differencePaise, 0);
    assert.equal(check.ledgerDifferencePaise, 1);
    assert.match(check.message, /signed sum/);
  });

  it("handles a negative net (refunds beyond the period's sales)", () => {
    const totals: StatementTotals = {
      grossSalesPaise: 10000,
      commissionPaise: 1000,
      chargesPaise: 0,
      refundsPaise: 25000,
      adjustmentsPaise: 0,
      netPaise: -16000,
    };
    assert.equal(expectedNetPaise(totals), -16000);
    assert.equal(checkStatementIdentity(totals, -16000).balanced, true);
  });

  it("lists the five terms then the total, in formula order", () => {
    const lines = statementLines(BALANCED);
    assert.deepEqual(
      lines.map((line) => line.key),
      [
        "grossSalesPaise",
        "commissionPaise",
        "chargesPaise",
        "refundsPaise",
        "adjustmentsPaise",
        "netPaise",
      ],
    );
    assert.deepEqual(
      lines.map((line) => line.sign),
      ["plus", "minus", "minus", "minus", "plus", "total"],
    );
    // Every term is stored as a positive magnitude (B5); only the sign differs.
    for (const line of lines.slice(0, 5)) assert.ok(line.paise >= 0);
  });
});

describe("statement progress", () => {
  it("walks the happy path", () => {
    assert.equal(payoutStepIndex("PENDING"), 0);
    assert.equal(payoutStepIndex("APPROVED"), 1);
    assert.equal(payoutStepIndex("PROCESSING"), 2);
    assert.equal(payoutStepIndex("PAID"), 3);

    const paid = payoutSteps("PAID");
    assert.deepEqual(
      paid.map((step) => step.status),
      ["complete", "complete", "complete", "current"],
    );
  });

  it("marks the step a failed transfer stopped at", () => {
    const failed = payoutSteps("FAILED");
    assert.deepEqual(
      failed.map((step) => step.status),
      ["complete", "complete", "error", "upcoming"],
    );
    assert.equal(failed[2].label, "Failed");
  });

  it("marks a cancelled statement before processing", () => {
    const cancelled = payoutSteps("CANCELLED");
    assert.deepEqual(
      cancelled.map((step) => step.status),
      ["complete", "error", "upcoming", "upcoming"],
    );
    assert.equal(cancelled[1].label, "Cancelled");
  });
});

describe("bank snapshot (D4)", () => {
  it("parses the masked snapshot written at PROCESSING", () => {
    const snapshot = parseBankSnapshot({
      accountHolder: "Kalakriti Studio",
      bankName: "HDFC Bank",
      accountNumberLast4: "3412",
      ifsc: "HDFC0001234",
      upiId: null,
      isVerified: true,
      snapshotAt: "2026-09-01T10:00:00.000Z",
    });
    assert.ok(snapshot);
    assert.equal(snapshot?.accountNumberLast4, "3412");
    assert.equal(snapshot?.isVerified, true);
  });

  it("never invents fields from a malformed blob", () => {
    assert.equal(parseBankSnapshot(null), null);
    assert.equal(parseBankSnapshot("nonsense"), null);
    assert.equal(parseBankSnapshot([1, 2]), null);
    const partial = parseBankSnapshot({ bankName: "" });
    assert.equal(partial?.bankName, null);
    assert.equal(partial?.isVerified, false);
  });

  it("masks the account number and never shows more than four digits", () => {
    assert.equal(maskAccountNumber("3412"), "••••3412");
    assert.equal(maskAccountNumber(null), "—");
  });
});

describe("small formatters", () => {
  it("renders basis points the way a person writes a rate", () => {
    assert.equal(formatBps(1000), "10%");
    assert.equal(formatBps(1250), "12.5%");
    assert.equal(formatBps(0), "0%");
  });

  it("describes a rule window", () => {
    const fmt = (date: Date) => date.toISOString().slice(0, 10);
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-02-01T00:00:00.000Z");
    assert.equal(formatWindow(null, null, fmt), "Always");
    assert.equal(formatWindow(start, null, fmt), "From 2026-01-01");
    assert.equal(formatWindow(null, end, fmt), "Until 2026-02-01");
    assert.equal(formatWindow(start, end, fmt), "2026-01-01 – 2026-02-01");
  });
});
