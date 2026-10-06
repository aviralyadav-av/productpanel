import { z } from "zod";

import {
  OPEN_RETURN_STATUSES,
  QC_DISPOSITIONS,
  RETURN_REASONS,
  RETURN_REQUEST_STATUSES,
  qcDispositionSchema,
  refundMethodSchema,
  returnReasonSchema,
  returnRequestStatusSchema,
  returnResolutionSchema,
  type ReturnReason,
  type ReturnRequestStatus,
  type ReturnResolution,
} from "@/lib/enums";
import type { ColumnDef } from "@/components/shared/column-visibility";
import type { SearchParams } from "@/lib/list-params";
import { paiseSchema } from "@/lib/validation";

/**
 * Client-safe vocabulary and validation for the RETURNS module (blueprint
 * §14.C4, D1, D9).
 *
 * Nothing here imports Prisma or `server-only`, so the same schemas validate
 * the public intake handler, the REST routes, the Server Actions and the
 * dialogs on the detail screen - one rule set, enforced four times over.
 */

// ---------------------------------------------------------------------------
// URL vocabulary
// ---------------------------------------------------------------------------

export const RETURN_SORTS = ["requested", "rma", "status", "customer", "order", "updated"] as const;
export type ReturnSort = (typeof RETURN_SORTS)[number];
export function resolveReturnSort(raw: string | undefined): ReturnSort {
  return (RETURN_SORTS as readonly string[]).includes(raw ?? "") ? (raw as ReturnSort) : "requested";
}

/** The two tabs on /admin/returns: work in progress vs. everything settled. */
export const RETURN_STATE_TABS = ["open", "closed"] as const;
export type ReturnStateTab = (typeof RETURN_STATE_TABS)[number];

export const CLOSED_RETURN_STATUSES: readonly ReturnRequestStatus[] = RETURN_REQUEST_STATUSES.filter(
  (status) => !OPEN_RETURN_STATUSES.includes(status),
);

export const RETURN_COLUMNS: ColumnDef[] = [
  { key: "rma", label: "RMA", locked: true },
  { key: "order", label: "Order" },
  { key: "customer", label: "Customer" },
  { key: "item", label: "Item", locked: true },
  { key: "seller", label: "Seller" },
  { key: "reason", label: "Reason" },
  { key: "resolution", label: "Requested resolution" },
  { key: "status", label: "Status", locked: true },
  { key: "requested", label: "Requested" },
  { key: "handled", label: "Handled by", defaultHidden: true },
];

export type ReturnListFilters = {
  /** A single status wins over the open/closed tab when both are present. */
  status?: ReturnRequestStatus;
  state?: ReturnStateTab;
  reason?: ReturnReason;
  resolution?: ReturnResolution;
  sellerId?: string;
  customerId?: string;
  orderId?: string;
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

export function parseReturnFilters(params: SearchParams | URLSearchParams): ReturnListFilters {
  return {
    status: pickEnum(RETURN_REQUEST_STATUSES, readParam(params, "status")),
    state: pickEnum(RETURN_STATE_TABS, readParam(params, "state")),
    reason: pickEnum(RETURN_REASONS, readParam(params, "reason")),
    resolution: pickEnum(["REFUND", "REPLACEMENT", "STORE_CREDIT"] as const, readParam(params, "resolution")),
    sellerId: readParam(params, "seller"),
    customerId: readParam(params, "customer"),
    orderId: readParam(params, "order"),
    range: readParam(params, "range"),
    from: readParam(params, "from"),
    to: readParam(params, "to"),
  };
}

export function hasReturnFilters(filters: ReturnListFilters, q: string): boolean {
  return Boolean(
    q ||
      filters.status ||
      filters.state ||
      filters.reason ||
      filters.resolution ||
      filters.sellerId ||
      filters.customerId ||
      filters.orderId ||
      filters.range ||
      filters.from ||
      filters.to,
  );
}

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optionalText = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

export const returnIdSchema = z.string().trim().min(1, "Missing id.");

export const returnQuantitySchema = z.coerce
  .number()
  .int("Quantity must be a whole number.")
  .min(1, "Return at least one unit.")
  .max(1000, "That is more units than the order can hold.");

// ---------------------------------------------------------------------------
// Public intake (POST /api/v1/returns) - blueprint §5.3, D1
// ---------------------------------------------------------------------------

export const PUBLIC_RETURN_MAX_IMAGES = 5;

export const publicReturnSchema = z.object({
  orderNumber: z.string().trim().min(3).max(30),
  /** The D1 order access token, mailed with the confirmation. */
  token: z.string().trim().min(10).max(200),
  orderItemId: z.string().trim().min(1),
  quantity: returnQuantitySchema.default(1),
  reason: returnReasonSchema,
  reasonDetail: optionalText(2000),
  requestedResolution: z.enum(["REFUND", "REPLACEMENT"]).optional(),
  /** Opaque upload tokens from POST /api/v1/uploads/review-image style intake. */
  images: z.array(z.string().trim().min(1).max(200)).max(PUBLIC_RETURN_MAX_IMAGES).optional(),
});
export type PublicReturnInput = z.input<typeof publicReturnSchema>;
export type PublicReturnValues = z.output<typeof publicReturnSchema>;

// ---------------------------------------------------------------------------
// Admin transitions - one schema, target-specific requirements in the service
// ---------------------------------------------------------------------------

/**
 * One payload for every move in the C4 flow. Each target consumes the fields
 * it needs and the service rejects a target whose required fields are absent,
 * rather than a discriminated union per status: the REST body, the dialog
 * state and the audit diff then all have the same shape.
 */
export const returnTransitionSchema = z.object({
  toStatus: returnRequestStatusSchema,
  /** Visible to the customer unless `isInternal`. */
  note: optionalText(2000),
  isInternal: z.boolean().default(true),

  /** APPROVED: what the customer will get (STORE_CREDIT is out of scope, B6). */
  resolution: z.enum(["REFUND", "REPLACEMENT"]).optional(),
  /** REJECTED: required. */
  rejectionReason: optionalText(500),

  /** PICKUP_SCHEDULED. */
  pickupPartnerId: z.preprocess(blankToNull, z.string().trim().min(1).nullable().optional()),
  pickupScheduledAt: z.preprocess(blankToNull, z.coerce.date().nullable().optional()),
  pickupTrackingNumber: optionalText(80),

  /** QC_PASSED / QC_FAILED. */
  qcNote: optionalText(2000),
  qcDisposition: qcDispositionSchema.optional(),

  /** REFUND_INITIATED. */
  amountPaise: paiseSchema.optional(),
  refundMethod: refundMethodSchema.optional(),

  /** REPLACEMENT_SHIPPED. */
  replacement: z
    .object({
      partnerId: z.preprocess(blankToNull, z.string().trim().min(1).nullable().optional()),
      carrierName: optionalText(80),
      trackingNumber: optionalText(80),
      note: optionalText(500),
    })
    .optional(),
});
export type ReturnTransitionInput = z.input<typeof returnTransitionSchema>;
export type ReturnTransitionValues = z.output<typeof returnTransitionSchema>;

export const returnNoteSchema = z.object({
  message: z.string().trim().min(2, "Write a note.").max(2000),
  /** Internal notes never reach the customer's tracking page (D11). */
  isInternal: z.boolean().default(true),
});
export type ReturnNoteInput = z.input<typeof returnNoteSchema>;
export type ReturnNoteValues = z.output<typeof returnNoteSchema>;

export const RETURN_BULK_OPS = ["REVIEW", "APPROVE", "REJECT", "CLOSE"] as const;
export type ReturnBulkOp = (typeof RETURN_BULK_OPS)[number];
export const RETURN_BULK_TARGET: Record<ReturnBulkOp, ReturnRequestStatus> = {
  REVIEW: "UNDER_REVIEW",
  APPROVE: "APPROVED",
  REJECT: "REJECTED",
  CLOSE: "CLOSED",
};
export const RETURN_BULK_LABELS: Record<ReturnBulkOp, string> = {
  REVIEW: "Move to review",
  APPROVE: "Approve",
  REJECT: "Reject",
  CLOSE: "Close",
};
export const RETURN_BULK_MAX_IDS = 500;

export const bulkReturnsSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1, "Select at least one RMA.").max(RETURN_BULK_MAX_IDS),
  op: z.enum(RETURN_BULK_OPS),
  /** REJECT needs a reason; the others accept an optional note. */
  reason: optionalText(500),
});
export type BulkReturnsInput = z.input<typeof bulkReturnsSchema>;
export type BulkReturnsValues = z.output<typeof bulkReturnsSchema>;

// ---------------------------------------------------------------------------
// The C4 flow as the UI shows it
// ---------------------------------------------------------------------------

/**
 * The Stepper on the detail page. Not a transition table - that lives in
 * enums.ts (`RETURN_REQUEST_TRANSITIONS`); this is only the happy path a
 * human reads left to right, with the terminal states handled separately.
 */
export const RETURN_FLOW_STEPS: readonly ReturnRequestStatus[] = [
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

/** Where a status sits on the happy path; −1 for the off-path terminals. */
export function returnFlowIndex(status: string): number {
  if (status === "QC_FAILED") return RETURN_FLOW_STEPS.indexOf("QC_PASSED");
  if (status === "REPLACEMENT_SHIPPED") return RETURN_FLOW_STEPS.indexOf("REFUND_COMPLETED");
  return RETURN_FLOW_STEPS.indexOf(status as ReturnRequestStatus);
}

export const QC_DISPOSITION_VALUES = QC_DISPOSITIONS;
export { returnResolutionSchema };

/**
 * Methods an operator may pick when a return turns into a refund. STORE_CREDIT
 * is out of scope for v1 (B6) and is deliberately absent: offering a method
 * the ledger cannot settle would create refunds that never complete.
 */
export const SELECTABLE_RETURN_REFUND_METHODS = [
  { value: "ORIGINAL", label: "Original payment method" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "MANUAL", label: "Manual / other" },
] as const;

export function resolveReturnStateTab(raw: string | undefined): ReturnStateTab | undefined {
  return (RETURN_STATE_TABS as readonly string[]).includes(raw ?? "") ? (raw as ReturnStateTab) : undefined;
}
