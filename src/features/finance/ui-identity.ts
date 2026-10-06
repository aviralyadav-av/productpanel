import { PAYOUT_STATUS_META, type PayoutStatus } from "@/lib/enums";

/**
 * Pure display helpers for a payout statement (blueprint §14.B5).
 *
 * These exist as their own module - with no database and no React - because
 * the B5 identity is the one number an operator has to be able to trust:
 * `net = gross - commission - charges - refunds + adjustments`, and the
 * signed sum of the scheduled ledger rows must equal it. `generatePayout`
 * asserts it at write time; this file is what SHOWS it, and `ui-identity.test.ts`
 * pins both the arithmetic and the wording so a UI refactor cannot quietly
 * start displaying a different sum than the ledger holds.
 */

export type StatementTotals = {
  grossSalesPaise: number;
  commissionPaise: number;
  chargesPaise: number;
  refundsPaise: number;
  adjustmentsPaise: number;
  netPaise: number;
};

export type StatementLine = {
  key: keyof StatementTotals;
  label: string;
  /** How the figure enters the identity. `total` is the result, not a term. */
  sign: "plus" | "minus" | "total";
  paise: number;
  hint?: string;
};

/** The five terms of the B5 identity, in the order the formula reads. */
export function statementLines(totals: StatementTotals): StatementLine[] {
  return [
    {
      key: "grossSalesPaise",
      label: "Gross sales",
      sign: "plus",
      paise: totals.grossSalesPaise,
      hint: "Seller share of delivered lines",
    },
    { key: "commissionPaise", label: "Commission", sign: "minus", paise: totals.commissionPaise },
    {
      key: "chargesPaise",
      label: "Marketplace charges",
      sign: "minus",
      paise: totals.chargesPaise,
      hint: "From the marketplace.charges rules",
    },
    {
      key: "refundsPaise",
      label: "Refund reversals",
      sign: "minus",
      paise: totals.refundsPaise,
      hint: "Sale reversed less commission returned",
    },
    {
      key: "adjustmentsPaise",
      label: "Adjustments",
      sign: "plus",
      paise: totals.adjustmentsPaise,
      hint: "Signed manual entries",
    },
    { key: "netPaise", label: "Net payable", sign: "total", paise: totals.netPaise },
  ];
}

/** `gross - commission - charges - refunds + adjustments`, in paise. */
export function expectedNetPaise(totals: StatementTotals): number {
  return (
    totals.grossSalesPaise -
    totals.commissionPaise -
    totals.chargesPaise -
    totals.refundsPaise +
    totals.adjustmentsPaise
  );
}

export type IdentityCheck = {
  expectedPaise: number;
  netPaise: number;
  /** Signed sum of the statement's ledger rows, when the caller has them. */
  ledgerSumPaise: number | null;
  balanced: boolean;
  /** net - expected; non-zero means the stored columns disagree with B5. */
  differencePaise: number;
  /** net - ledgerSum; non-zero means the statement disagrees with the ledger. */
  ledgerDifferencePaise: number | null;
  formula: string;
  message: string;
};

/**
 * Checks the stored columns against B5 and, when the entries are loaded, against
 * the ledger itself. A statement that fails either check is not a rounding
 * curiosity: it means somebody would be paid an amount the ledger does not
 * account for, so the UI says so in words rather than hiding the discrepancy.
 */
export function checkStatementIdentity(
  totals: StatementTotals,
  ledgerSumPaise: number | null = null,
): IdentityCheck {
  const expected = expectedNetPaise(totals);
  const difference = totals.netPaise - expected;
  const ledgerDifference = ledgerSumPaise === null ? null : totals.netPaise - ledgerSumPaise;
  const balanced = difference === 0 && (ledgerDifference === null || ledgerDifference === 0);

  const message = balanced
    ? ledgerSumPaise === null
      ? "Net matches gross - commission - charges - refunds + adjustments."
      : "Net matches the formula and the signed sum of this statement's ledger entries."
    : difference !== 0
      ? "The stored net does not match gross - commission - charges - refunds + adjustments."
      : "The stored net does not match the signed sum of this statement's ledger entries.";

  return {
    expectedPaise: expected,
    netPaise: totals.netPaise,
    ledgerSumPaise,
    balanced,
    differencePaise: difference,
    ledgerDifferencePaise: ledgerDifference,
    formula: "net = gross − commission − charges − refunds + adjustments",
    message,
  };
}

// ---------------------------------------------------------------------------
// Statement progress (B5 transitions)
// ---------------------------------------------------------------------------

/** The happy path. FAILED and CANCELLED are shown as a failed final step. */
export const PAYOUT_FLOW: readonly PayoutStatus[] = ["PENDING", "APPROVED", "PROCESSING", "PAID"];

export type PayoutStepView = {
  id: PayoutStatus;
  label: string;
  description?: string;
  status: "complete" | "current" | "upcoming" | "error";
};

/**
 * A statement that failed or was cancelled stopped somewhere on the happy
 * path, so the step it stopped at is rendered as the error rather than
 * dropping the whole trail - "failed while processing" is the useful sentence,
 * not "failed".
 */
export function payoutSteps(status: PayoutStatus): PayoutStepView[] {
  const broken = status === "FAILED" || status === "CANCELLED";
  // CANCELLED can happen at PENDING or APPROVED; without history the safest
  // reading is that it stopped one step short of PROCESSING.
  const stoppedAt = status === "FAILED" ? 2 : 1;
  const index = broken ? stoppedAt : PAYOUT_FLOW.indexOf(status);

  return PAYOUT_FLOW.map((step, position) => {
    const meta = PAYOUT_STATUS_META[step];
    let state: PayoutStepView["status"];
    if (broken && position === index) state = "error";
    else if (position < index) state = "complete";
    else if (position === index) state = "current";
    else state = "upcoming";
    return {
      id: step,
      label: broken && position === index ? PAYOUT_STATUS_META[status].label : meta.label,
      description: broken && position === index ? PAYOUT_STATUS_META[status].description : undefined,
      status: state,
    };
  });
}

/** Index for `Stepper currentIndex`; PAID sits past the last step. */
export function payoutStepIndex(status: PayoutStatus): number {
  if (status === "FAILED") return 2;
  if (status === "CANCELLED") return 1;
  const index = PAYOUT_FLOW.indexOf(status);
  return index < 0 ? 0 : index;
}

// ---------------------------------------------------------------------------
// Bank account snapshot (D4: masked, never the full number)
// ---------------------------------------------------------------------------

export type BankSnapshot = {
  accountHolder: string | null;
  bankName: string | null;
  accountNumberLast4: string | null;
  ifsc: string | null;
  upiId: string | null;
  isVerified: boolean;
  snapshotAt: string | null;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * The snapshot column is `Json?` written by `transitionPayout` at PROCESSING.
 * It is parsed defensively because it is data at rest: a statement written by
 * an older shape must still render, and a malformed blob must not take the
 * page down.
 */
export function parseBankSnapshot(raw: unknown): BankSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  return {
    accountHolder: stringOrNull(value.accountHolder),
    bankName: stringOrNull(value.bankName),
    accountNumberLast4: stringOrNull(value.accountNumberLast4),
    ifsc: stringOrNull(value.ifsc),
    upiId: stringOrNull(value.upiId),
    isVerified: value.isVerified === true,
    snapshotAt: stringOrNull(value.snapshotAt),
  };
}

/** `••••3412`; an em dash when the last4 was never recorded. */
export function maskAccountNumber(last4: string | null | undefined): string {
  if (!last4) return "—";
  return `••••${last4}`;
}

/** `10%`, `12.5%` - basis points as a person writes them. */
export function formatBps(bps: number): string {
  const percent = bps / 100;
  if (Number.isInteger(percent)) return `${percent}%`;
  // Trailing zeros are dropped: "12.50%" reads as a more precise number than
  // the rate the operator actually typed.
  return `${percent.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

/**
 * A commission rule window in one phrase. Rules with no dates are the common
 * case and read as "Always", not as two em dashes.
 */
export function formatWindow(
  startsAt: Date | string | null,
  endsAt: Date | string | null,
  format: (date: Date) => string,
): string {
  const start = startsAt ? new Date(startsAt) : null;
  const end = endsAt ? new Date(endsAt) : null;
  if (!start && !end) return "Always";
  if (start && !end) return `From ${format(start)}`;
  if (!start && end) return `Until ${format(end as Date)}`;
  return `${format(start as Date)} – ${format(end as Date)}`;
}
