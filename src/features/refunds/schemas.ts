import { z } from "zod";

import {
  PAYMENT_PROVIDERS,
  REFUND_METHODS,
  REFUND_STATUSES,
  refundMethodSchema,
  refundStatusSchema,
  type PaymentProviderCode,
  type RefundMethod,
  type RefundStatus,
} from "@/lib/enums";
import type { ColumnDef } from "@/components/shared/column-visibility";
import type { SearchParams } from "@/lib/list-params";
import { paiseSchema } from "@/lib/validation";

/**
 * Client-safe vocabulary for the REFUNDS module (blueprint §14.B6).
 *
 * The refund state machine itself is `REFUND_TRANSITIONS` in enums.ts; this
 * file only carries the URL shape, the request bodies and the small pieces of
 * presentation vocabulary (which methods can be picked, which ones can be
 * pushed to a gateway) that both the screen and the service need.
 */

// ---------------------------------------------------------------------------
// URL vocabulary
// ---------------------------------------------------------------------------

export const REFUND_SORTS = ["created", "number", "amount", "status", "order", "completed"] as const;
export type RefundSort = (typeof REFUND_SORTS)[number];
export function resolveRefundSort(raw: string | undefined): RefundSort {
  return (REFUND_SORTS as readonly string[]).includes(raw ?? "") ? (raw as RefundSort) : "created";
}

export const REFUND_COLUMNS: ColumnDef[] = [
  { key: "number", label: "Refund", locked: true },
  { key: "order", label: "Order" },
  { key: "customer", label: "Customer" },
  { key: "amount", label: "Amount", locked: true },
  { key: "method", label: "Method" },
  { key: "provider", label: "Provider" },
  { key: "status", label: "Status", locked: true },
  { key: "return", label: "Return" },
  { key: "created", label: "Created" },
  { key: "completed", label: "Completed", defaultHidden: true },
];

export type RefundListFilters = {
  status?: RefundStatus;
  method?: RefundMethod;
  provider?: PaymentProviderCode;
  orderId?: string;
  customerId?: string;
  range?: string;
  from?: string;
  to?: string;
};

function readParam(params: SearchParams | URLSearchParams, key: string): string | undefined {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.length > 0 ? first : undefined;
}

function pickEnum<T extends string>(list: readonly T[], value: string | undefined): T | undefined {
  return value && (list as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function parseRefundFilters(params: SearchParams | URLSearchParams): RefundListFilters {
  return {
    status: pickEnum(REFUND_STATUSES, readParam(params, "status")),
    method: pickEnum(REFUND_METHODS, readParam(params, "method")),
    provider: pickEnum(PAYMENT_PROVIDERS, readParam(params, "provider")),
    orderId: readParam(params, "order"),
    customerId: readParam(params, "customer"),
    range: readParam(params, "range"),
    from: readParam(params, "from"),
    to: readParam(params, "to"),
  };
}

export function hasRefundFilters(filters: RefundListFilters, q: string): boolean {
  return Boolean(
    q ||
      filters.status ||
      filters.method ||
      filters.provider ||
      filters.orderId ||
      filters.customerId ||
      filters.range ||
      filters.from ||
      filters.to,
  );
}

// ---------------------------------------------------------------------------
// Presentation vocabulary shared by the screen and the service
// ---------------------------------------------------------------------------

/**
 * Methods an operator may choose when creating a refund by hand. STORE_CREDIT
 * is deliberately absent: B6 puts it out of scope for v1, and offering a
 * method the ledger cannot settle would produce refunds that never complete.
 */
export const SELECTABLE_REFUND_METHODS: readonly RefundMethod[] = ["ORIGINAL", "BANK_TRANSFER", "MANUAL"];

/** Providers that can actually be asked to move money back (B6, §10). */
export const GATEWAY_PROVIDERS: readonly string[] = ["MOCK", "RAZORPAY", "STRIPE", "PAYU", "PHONEPE"];

export function isGatewayProvider(provider: string | null | undefined): boolean {
  return Boolean(provider && GATEWAY_PROVIDERS.includes(provider));
}

/** The happy path a human reads left to right on the detail Stepper. */
export const REFUND_FLOW_STEPS: readonly RefundStatus[] = ["PENDING", "APPROVED", "PROCESSING", "COMPLETED"];

export function refundFlowIndex(status: string): number {
  return REFUND_FLOW_STEPS.indexOf(status as RefundStatus);
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const optionalText = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

export const refundIdSchema = z.string().trim().min(1, "Missing id.");

/**
 * "Create refund" from an order. The amount is validated against
 * `refundableRemaining(orderId)` inside the transaction, not here: the cap
 * moves whenever another refund is created, so a schema-level bound would
 * either be stale or wrong.
 */
export const createRefundSchema = z.object({
  orderId: z.string().trim().min(1, "Pick an order."),
  amountPaise: paiseSchema.refine((value) => value > 0, "Enter an amount greater than zero."),
  method: refundMethodSchema.default("ORIGINAL"),
  reason: z.string().trim().min(2, "Say why this refund is being issued.").max(500),
  notes: optionalText(2000),
  /** Optional RMA this refund settles; makes it count against the line's cap. */
  returnRequestId: optionalText(64),
});
export type CreateRefundInput = z.input<typeof createRefundSchema>;
export type CreateRefundValues = z.output<typeof createRefundSchema>;

export const refundTransitionSchema = z.object({
  toStatus: refundStatusSchema,
  /** COMPLETED / PROCESSING: the bank UTR or the operator's own reference. */
  reference: optionalText(120),
  /** FAILED: required. */
  failureReason: optionalText(500),
  note: optionalText(2000),
});
export type RefundTransitionInput = z.input<typeof refundTransitionSchema>;
export type RefundTransitionValues = z.output<typeof refundTransitionSchema>;

export const refundNoteSchema = z.object({
  message: z.string().trim().min(2, "Write a note.").max(2000),
});
export type RefundNoteInput = z.input<typeof refundNoteSchema>;
export type RefundNoteValues = z.output<typeof refundNoteSchema>;

export { refundMethodSchema, refundStatusSchema };
