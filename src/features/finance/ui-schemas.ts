import { z } from "zod";

import {
  COMMISSION_SCOPES,
  LEDGER_ENTRY_STATUSES,
  LEDGER_ENTRY_TYPES,
  MARKETPLACE_CHARGE_CONDITIONS,
  MARKETPLACE_CHARGE_TYPES,
  PAYOUT_METHODS,
  PAYOUT_STATUSES,
  commissionScopeSchema,
  commissionTargetKey,
  ledgerEntryStatusSchema,
  ledgerEntryTypeSchema,
  payoutMethodSchema,
  payoutStatusSchema,
  type CommissionScope,
  type LedgerEntryStatus,
  type LedgerEntryType,
  type PayoutStatus,
} from "@/lib/enums";
import { one, type SearchParams } from "@/lib/list-params";
import { bpsSchema, idSchema, optionalTextSchema, paiseSchema } from "@/lib/validation";

/**
 * The finance front-end contract (blueprint §14.B3-B5, D14): what the URL may
 * say on /admin/commissions and /admin/payouts, and what every Server Action
 * and REST body must look like.
 *
 * Client-safe on purpose - the dialogs validate with the same schemas the
 * actions and route handlers parse, so a rejected form never disagrees with
 * the server about which field is wrong.
 */

export {
  COMMISSION_SCOPES,
  LEDGER_ENTRY_STATUSES,
  LEDGER_ENTRY_TYPES,
  PAYOUT_METHODS,
  PAYOUT_STATUSES,
  commissionTargetKey,
  commissionScopeSchema,
  ledgerEntryStatusSchema,
  ledgerEntryTypeSchema,
  payoutStatusSchema,
};
export type { CommissionScope, LedgerEntryStatus, LedgerEntryType, PayoutStatus };

// ---------------------------------------------------------------------------
// Commission rules
// ---------------------------------------------------------------------------

/**
 * Empty string and null both mean "no boundary". Dates arrive from
 * `input type=datetime-local` as a local string, so they are parsed rather
 * than coerced, and an unparseable value becomes a field error instead of an
 * Invalid Date written to the column.
 */
export const optionalDateSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? trimmed : parsed;
  },
  z.date({ error: "Enter a valid date and time." }).nullable(),
);

const ruleBaseSchema = z.object({
  scope: commissionScopeSchema,
  /** Category / seller / product id. Forced to null for GLOBAL. */
  targetId: z.string().trim().min(1).max(64).nullable().default(null),
  rateBps: bpsSchema,
  fixedPaise: paiseSchema.default(0),
  isActive: z.boolean().default(true),
  startsAt: optionalDateSchema,
  endsAt: optionalDateSchema,
  note: optionalTextSchema(300),
});

/**
 * A non-GLOBAL rule without a target has no targetKey to be unique on, and an
 * inverted window would silently never apply - both are rejected at the edge
 * rather than saved as a rule that quietly does nothing.
 */
export const commissionRuleSchema = ruleBaseSchema.superRefine((value, ctx) => {
  if (value.scope !== "GLOBAL" && !value.targetId) {
    ctx.addIssue({ code: "custom", path: ["targetId"], message: "Choose what this rule applies to." });
  }
  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The end must be after the start." });
  }
});
export type CommissionRuleInput = z.input<typeof commissionRuleSchema>;
export type CommissionRuleValues = z.output<typeof commissionRuleSchema>;

/** Editing the global card: rate, fixed and note only - its scope cannot move. */
export const globalRuleSchema = z.object({
  rateBps: bpsSchema,
  fixedPaise: paiseSchema.default(0),
  note: optionalTextSchema(300),
});
export type GlobalRuleInput = z.input<typeof globalRuleSchema>;
export type GlobalRuleValues = z.output<typeof globalRuleSchema>;

export const toggleRuleSchema = z.object({ isActive: z.boolean() });
export const resolveCommissionSchema = z.object({ productId: idSchema });
export type ResolveCommissionInput = z.input<typeof resolveCommissionSchema>;

// ---------------------------------------------------------------------------
// marketplace.charges (B3)
// ---------------------------------------------------------------------------

/**
 * One editable `marketplace.charges` row. The stored shape
 * (`marketplaceChargeSchema` in enums) keeps valueBps and valuePaise both
 * optional; here the type decides which one is required, so an operator
 * cannot save a percentage rule that carries an amount and no rate.
 */
export const chargeRowSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, "A code is required.")
      .max(40)
      .regex(/^[A-Za-z0-9_]+$/, "Use letters, digits and underscores only."),
    label: z.string().trim().min(1, "A label is required.").max(80),
    type: z.enum(MARKETPLACE_CHARGE_TYPES),
    valueBps: bpsSchema.nullable().default(null),
    valuePaise: paiseSchema.nullable().default(null),
    appliesWhen: z.enum(MARKETPLACE_CHARGE_CONDITIONS).default("ALWAYS"),
  })
  .superRefine((value, ctx) => {
    if (value.type === "PERCENT_OF_GROSS") {
      if (value.valueBps === null) {
        ctx.addIssue({ code: "custom", path: ["valueBps"], message: "Enter a percentage." });
      }
    } else if (value.valuePaise === null) {
      ctx.addIssue({ code: "custom", path: ["valuePaise"], message: "Enter an amount." });
    }
  });
export type ChargeRowInput = z.input<typeof chargeRowSchema>;
export type ChargeRowValues = z.output<typeof chargeRowSchema>;

export const chargesSchema = z
  .object({ charges: z.array(chargeRowSchema).max(20, "Twenty charge rules is plenty.") })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.charges.forEach((row, index) => {
      const code = row.code.toLowerCase();
      if (seen.has(code)) {
        ctx.addIssue({ code: "custom", path: ["charges", index, "code"], message: "This code is already used." });
      }
      seen.add(code);
    });
  });
export type ChargesInput = z.input<typeof chargesSchema>;
export type ChargesValues = z.output<typeof chargesSchema>;

/** Persisted form: only the keys the setting's own schema accepts. */
export function chargeRowToSetting(row: ChargeRowValues): Record<string, unknown> {
  return {
    code: row.code,
    label: row.label,
    type: row.type,
    appliesWhen: row.appliesWhen,
    ...(row.type === "PERCENT_OF_GROSS"
      ? { valueBps: row.valueBps ?? 0 }
      : { valuePaise: row.valuePaise ?? 0 }),
  };
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

export const generatePayoutSchema = z.object({
  sellerId: z.string().trim().min(1, "Choose a seller."),
  /** Everything available on or before this instant; defaults to now. */
  periodTo: optionalDateSchema,
  method: payoutMethodSchema.default("BANK_TRANSFER"),
  bankAccountId: z.string().trim().min(1).nullable().default(null),
  notes: optionalTextSchema(1000),
});
export type GeneratePayoutFormInput = z.input<typeof generatePayoutSchema>;
export type GeneratePayoutFormValues = z.output<typeof generatePayoutSchema>;

/**
 * PAID needs a reference number and FAILED needs a reason: money that left
 * the platform without a bank reference cannot be reconciled, and a failure
 * with no reason cannot be retried by whoever picks it up next.
 */
export const payoutTransitionSchema = z
  .object({
    toStatus: payoutStatusSchema,
    referenceNumber: optionalTextSchema(120),
    failureReason: optionalTextSchema(500),
    bankAccountId: z.string().trim().min(1).nullable().default(null),
    notes: optionalTextSchema(1000),
  })
  .superRefine((value, ctx) => {
    if (value.toStatus === "PAID" && !value.referenceNumber) {
      ctx.addIssue({ code: "custom", path: ["referenceNumber"], message: "Record the bank reference number." });
    }
    if (value.toStatus === "FAILED" && !value.failureReason) {
      ctx.addIssue({ code: "custom", path: ["failureReason"], message: "Say why the transfer failed." });
    }
  });
export type PayoutTransitionInput = z.input<typeof payoutTransitionSchema>;
export type PayoutTransitionValues = z.output<typeof payoutTransitionSchema>;

/** A signed manual ledger entry (B5, permission payouts.adjust). */
export const adjustmentSchema = z.object({
  sellerId: z.string().trim().min(1, "Choose a seller."),
  amountPaise: z
    .number({ error: "Enter an amount." })
    .int("Amounts are whole paise.")
    .refine((value) => value !== 0, "An adjustment of zero would change nothing.")
    .refine((value) => Math.abs(value) <= 2_147_483_647, "Amount is too large."),
  description: z.string().trim().min(3, "Say what this adjustment is for.").max(300),
});
export type AdjustmentInput = z.input<typeof adjustmentSchema>;
export type AdjustmentValues = z.output<typeof adjustmentSchema>;

export const recomputeBalanceSchema = z.object({ sellerId: z.string().trim().min(1) });

// ---------------------------------------------------------------------------
// URL vocabulary
// ---------------------------------------------------------------------------

export const COMMISSION_SORTS = ["scope", "rateBps", "fixedPaise", "updatedAt", "createdAt"] as const;
export type CommissionSort = (typeof COMMISSION_SORTS)[number];
export function parseCommissionSort(raw: string | undefined): CommissionSort {
  return (COMMISSION_SORTS as readonly string[]).includes(raw ?? "") ? (raw as CommissionSort) : "updatedAt";
}

export type CommissionFilters = {
  q: string;
  scope?: CommissionScope;
  /** true = active only, false = inactive only, undefined = both. */
  active?: boolean;
  /** ?product= drives the "resolve for a product" tester card. */
  productId?: string;
};

export function parseCommissionFilters(params: SearchParams): CommissionFilters {
  const scope = one(params, "scope");
  const active = one(params, "active");
  return {
    q: (one(params, "q") ?? "").trim(),
    scope: (COMMISSION_SCOPES as readonly string[]).includes(scope ?? "")
      ? (scope as CommissionScope)
      : undefined,
    active: active === "1" ? true : active === "0" ? false : undefined,
    productId: one(params, "product"),
  };
}

export function hasCommissionFilters(filters: CommissionFilters): boolean {
  return Boolean(filters.q || filters.scope || filters.active !== undefined);
}

export const PAYOUT_TABS = ["overview", "statements", "ledger"] as const;
export type PayoutTab = (typeof PAYOUT_TABS)[number];
export const PAYOUT_TAB_LABELS: Record<PayoutTab, string> = {
  overview: "Overview",
  statements: "Statements",
  ledger: "Ledger",
};
export function parsePayoutTab(raw: string | undefined): PayoutTab {
  return (PAYOUT_TABS as readonly string[]).includes(raw ?? "") ? (raw as PayoutTab) : "overview";
}

export const PAYOUT_SORTS = ["createdAt", "payoutNumber", "seller", "netPaise", "periodTo", "paidAt"] as const;
export type PayoutSort = (typeof PAYOUT_SORTS)[number];
export function parsePayoutSort(raw: string | undefined): PayoutSort {
  return (PAYOUT_SORTS as readonly string[]).includes(raw ?? "") ? (raw as PayoutSort) : "createdAt";
}

export const BALANCE_SORTS = ["seller", "pending", "available", "scheduled", "paid"] as const;
export type BalanceSort = (typeof BALANCE_SORTS)[number];
export function parseBalanceSort(raw: string | undefined): BalanceSort {
  return (BALANCE_SORTS as readonly string[]).includes(raw ?? "") ? (raw as BalanceSort) : "available";
}

export type PayoutListFilters = {
  q: string;
  status?: PayoutStatus;
  sellerId?: string;
};

export function parsePayoutFilters(params: SearchParams): PayoutListFilters {
  const status = one(params, "status");
  return {
    q: (one(params, "q") ?? "").trim(),
    status: (PAYOUT_STATUSES as readonly string[]).includes(status ?? "")
      ? (status as PayoutStatus)
      : undefined,
    sellerId: one(params, "seller"),
  };
}

export type LedgerFilters = {
  q: string;
  sellerId?: string;
  type?: LedgerEntryType;
  status?: LedgerEntryStatus;
};

/**
 * The ledger tab shares its URL with the statements tab, so its status filter
 * is `lstatus`: one `status` param for both would make a bookmarked statement
 * filter reappear as a ledger filter.
 */
export function parseLedgerFilters(params: SearchParams): LedgerFilters {
  const type = one(params, "type");
  const status = one(params, "lstatus");
  return {
    q: (one(params, "q") ?? "").trim(),
    sellerId: one(params, "seller"),
    type: (LEDGER_ENTRY_TYPES as readonly string[]).includes(type ?? "")
      ? (type as LedgerEntryType)
      : undefined,
    status: (LEDGER_ENTRY_STATUSES as readonly string[]).includes(status ?? "")
      ? (status as LedgerEntryStatus)
      : undefined,
  };
}

export function hasLedgerFilters(filters: LedgerFilters): boolean {
  return Boolean(filters.q || filters.sellerId || filters.type || filters.status);
}

// ---------------------------------------------------------------------------
// Column visibility (ColumnVisibilityMenu tableKeys "payouts" and "ledger")
// ---------------------------------------------------------------------------

export type FinanceColumn = { key: string; label: string; defaultHidden?: boolean; locked?: boolean };

/**
 * The statement table's optional columns. Every term of the B5 identity is
 * visible by default so an operator can read `net = gross − commission −
 * charges − refunds + adjustments` straight across the row; the menu is for
 * the operator who only wants the net.
 */
export const PAYOUT_TABLE_COLUMNS: readonly FinanceColumn[] = [
  { key: "gross", label: "Gross sales" },
  { key: "commission", label: "Commission" },
  { key: "charges", label: "Charges" },
  { key: "refunds", label: "Refund reversals" },
  { key: "adjustments", label: "Adjustments" },
  { key: "method", label: "Method" },
  { key: "reference", label: "Bank reference" },
  { key: "entries", label: "Entries", defaultHidden: true },
  { key: "paidAt", label: "Paid" },
];

export const LEDGER_TABLE_COLUMNS: readonly FinanceColumn[] = [
  { key: "order", label: "Order" },
  { key: "item", label: "Item", defaultHidden: true },
  { key: "statement", label: "Statement" },
  { key: "availableAt", label: "Available at" },
];

/** Overview-tab filters for the "sellers with balances" table. */
export type BalanceFilters = { q: string; sellerId?: string; onlyOwed: boolean };

export function parseBalanceFilters(params: SearchParams): BalanceFilters {
  return {
    q: (one(params, "q") ?? "").trim(),
    sellerId: one(params, "seller"),
    // Default ON: a marketplace has far more sellers with a zero balance than
    // with money owed, and the zero rows are noise on this screen.
    onlyOwed: one(params, "owed") !== "0",
  };
}
