import { z } from "zod";

import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  ORDER_SOURCES,
  orderStatusSchema,
  paymentMethodSchema,
  shipmentStatusSchema,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type OrderSource,
} from "@/lib/enums";
import type { ColumnDef } from "@/components/shared/column-visibility";
import { emailSchema, paiseSchema, phoneSchema, pincodeSchema, safeUrlSchema } from "@/lib/validation";
import type { SearchParams } from "@/lib/list-params";

/**
 * Every write path into an order (checkout intake, manual entry, the detail
 * page, REST) validates through one of these schemas. They are client-safe -
 * no Prisma, no server-only - so the manual order form can pre-validate with
 * the exact rules the action enforces.
 */

// ---------------------------------------------------------------------------
// Vocabularies the UI needs
// ---------------------------------------------------------------------------

/**
 * Fixed reasons so cancellations can be counted later without clustering free
 * text. "Other" keeps the note field honest for anything not listed.
 */
export const CANCEL_REASONS = [
  "Customer changed their mind",
  "Customer unreachable",
  "Address or pin code not serviceable",
  "Item out of stock",
  "Duplicate or test order",
  "Payment not received",
  "Fraud suspected",
  "Other",
] as const;

/** Instruments an operator can record by hand (B6 MANUAL/COD cash). */
export const MANUAL_PAYMENT_INSTRUMENTS = ["CASH", "UPI", "BANK_TRANSFER", "CARD", "OTHER"] as const;
export type ManualPaymentInstrument = (typeof MANUAL_PAYMENT_INSTRUMENTS)[number];

export const ORDER_SORTS = ["number", "placed", "customer", "total", "status", "payment", "updated"] as const;
export type OrderSort = (typeof ORDER_SORTS)[number];
export function resolveOrderSort(raw: string | undefined): OrderSort {
  return (ORDER_SORTS as readonly string[]).includes(raw ?? "") ? (raw as OrderSort) : "placed";
}

export const ORDER_COLUMNS: ColumnDef[] = [
  { key: "number", label: "Order", locked: true },
  { key: "placed", label: "Placed" },
  { key: "customer", label: "Customer" },
  { key: "items", label: "Items" },
  { key: "sellers", label: "Sellers" },
  { key: "total", label: "Total", locked: true },
  { key: "payment", label: "Payment" },
  { key: "status", label: "Status", locked: true },
  { key: "shipping", label: "Shipping" },
  { key: "source", label: "Source", defaultHidden: true },
  { key: "updated", label: "Updated", defaultHidden: true },
];

export const BULK_ORDER_OPS = ["CONFIRM", "PROCESSING", "PACKED"] as const;
export type BulkOrderOp = (typeof BULK_ORDER_OPS)[number];
export const BULK_OP_TARGET: Record<BulkOrderOp, OrderStatus> = {
  CONFIRM: "CONFIRMED",
  PROCESSING: "PROCESSING",
  PACKED: "PACKED",
};
export const BULK_MAX_IDS = 500;

// ---------------------------------------------------------------------------
// List filters (URL state)
// ---------------------------------------------------------------------------

export type OrderListFilters = {
  status?: OrderStatus;
  payment?: PaymentStatus;
  method?: PaymentMethod;
  source?: OrderSource;
  sellerId?: string;
  customerId?: string;
  /** DateRangePicker params; resolved by the query layer only when present. */
  range?: string;
  from?: string;
  to?: string;
  /** Rupees in the URL (operators think in rupees); converted by the query. */
  minTotal?: number;
  maxTotal?: number;
  hasReturns?: boolean;
  hasCustomization?: boolean;
};

function readParam(params: SearchParams | URLSearchParams, key: string): string | undefined {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.length > 0 ? first : undefined;
}

function pickEnum<T extends string>(list: readonly T[], value: string | undefined): T | undefined {
  return value && (list as readonly string[]).includes(value) ? (value as T) : undefined;
}

function readNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function parseOrderListFilters(params: SearchParams | URLSearchParams): OrderListFilters {
  return {
    status: pickEnum(ORDER_STATUSES, readParam(params, "status")),
    payment: pickEnum(PAYMENT_STATUSES, readParam(params, "payment")),
    method: pickEnum(PAYMENT_METHODS, readParam(params, "method")),
    source: pickEnum(ORDER_SOURCES, readParam(params, "source")),
    sellerId: readParam(params, "seller"),
    customerId: readParam(params, "customer"),
    range: readParam(params, "range"),
    from: readParam(params, "from"),
    to: readParam(params, "to"),
    minTotal: readNumber(readParam(params, "minTotal")),
    maxTotal: readNumber(readParam(params, "maxTotal")),
    hasReturns: readParam(params, "returns") === "1",
    hasCustomization: readParam(params, "custom") === "1",
  };
}

export function hasActiveOrderFilters(filters: OrderListFilters, q: string): boolean {
  return Boolean(
    q ||
      filters.status ||
      filters.payment ||
      filters.method ||
      filters.source ||
      filters.sellerId ||
      filters.customerId ||
      filters.range ||
      filters.from ||
      filters.to ||
      filters.minTotal !== undefined ||
      filters.maxTotal !== undefined ||
      filters.hasReturns ||
      filters.hasCustomization,
  );
}

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().max(max);
const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optionalText = (max: number) => z.preprocess(blankToUndefined, text(max).optional());
const nullableText = (max: number) => z.preprocess(blankToNull, text(max).nullable().optional());
const optionalEmail = z.preprocess(blankToUndefined, emailSchema.optional());
const optionalPhone = z.preprocess(blankToUndefined, phoneSchema.optional());

export const orderIdSchema = z.string().trim().min(1, "Missing id.");

/**
 * One customisation answer as the storefront (or the manual form) posts it.
 * `uploadTokens` come from POST /uploads/customization; `mediaAssetIds` is the
 * admin-side equivalent when an operator picks the customer's photo from the
 * media library while keying a manual order.
 */
export const customizationAnswerSchema = z.union([
  z.string().max(5000),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(200)).max(20),
  z.object({
    uploadTokens: z.array(z.string().min(1).max(200)).max(20).optional(),
    mediaAssetIds: z.array(z.string().min(1).max(200)).max(20).optional(),
    value: z.union([z.string().max(5000), z.array(z.string().max(200)).max(20), z.boolean()]).optional(),
  }),
]);
export const customizationAnswersSchema = z.record(z.string().min(1).max(64), customizationAnswerSchema);
export type CustomizationAnswersInput = z.input<typeof customizationAnswersSchema>;

export const addressInputSchema = z.object({
  fullName: text(120).min(2, "Enter the recipient name."),
  phone: phoneSchema,
  email: optionalEmail,
  line1: text(200).min(3, "Enter the street address."),
  line2: nullableText(200),
  landmark: nullableText(120),
  city: text(80).min(2, "Enter the city."),
  state: text(80).min(2, "Enter the state."),
  pinCode: pincodeSchema,
  country: z.string().trim().length(2).toUpperCase().default("IN"),
});
export type AddressInput = z.input<typeof addressInputSchema>;
export type AddressValues = z.output<typeof addressInputSchema>;

const quantitySchema = z.coerce.number().int().min(1, "Quantity must be at least 1.").max(1000);

export const orderLineInputSchema = z.object({
  productId: z.string().trim().min(1),
  variantId: z.string().trim().min(1).nullable().optional(),
  quantity: quantitySchema,
  customization: customizationAnswersSchema.nullable().optional(),
});
export type OrderLineInput = z.input<typeof orderLineInputSchema>;

// ---------------------------------------------------------------------------
// Checkout intake (POST /api/v1/orders)
// ---------------------------------------------------------------------------

export const storefrontOrderSchema = z.object({
  customer: z.object({
    email: emailSchema,
    name: optionalText(120),
    phone: optionalPhone,
  }),
  shippingAddress: addressInputSchema,
  billingAddress: addressInputSchema.optional(),
  items: z.array(orderLineInputSchema).min(1, "Add at least one item.").max(50),
  couponCode: optionalText(40),
  shippingRateId: optionalText(64),
  paymentMethod: z.enum(["COD", "ONLINE"]),
  /** Optional gateway code (RAZORPAY, MOCK...); the first enabled one otherwise. */
  paymentProvider: optionalText(20),
  customerNote: optionalText(1000),
  /** Cloudflare Turnstile response, verified when checkout.turnstile_secret is set. */
  turnstileToken: optionalText(4000),
});
export type StorefrontOrderInput = z.input<typeof storefrontOrderSchema>;
export type StorefrontOrderValues = z.output<typeof storefrontOrderSchema>;

// ---------------------------------------------------------------------------
// Manual order (admin)
// ---------------------------------------------------------------------------

export const manualOrderLineSchema = orderLineInputSchema.extend({
  /** MANUAL only: a negotiated unit price; the list price is still snapshotted. */
  unitPriceOverridePaise: z.preprocess((value) => (value === "" ? null : value), paiseSchema.nullable().optional()),
  overrideReason: optionalText(200),
});
export type ManualOrderLineInput = z.input<typeof manualOrderLineSchema>;

const manualOrderObject = z.object({
  customerId: z.string().trim().min(1).nullable().optional(),
  customer: z
    .object({
      email: emailSchema,
      name: optionalText(120),
      phone: optionalPhone,
    })
    .optional(),
  shippingAddress: addressInputSchema,
  billingSameAsShipping: z.boolean().default(true),
  billingAddress: addressInputSchema.optional(),
  items: z.array(manualOrderLineSchema).min(1, "Add at least one item.").max(50),
  couponCode: optionalText(40),
  shippingRateId: optionalText(64),
  paymentMethod: paymentMethodSchema,
  paymentProvider: optionalText(20),
  customerNote: optionalText(1000),
  internalNote: optionalText(2000),
});

export const manualOrderSchema = manualOrderObject.superRefine((value, ctx) => {
  if (!value.customerId && !value.customer) {
    ctx.addIssue({ code: "custom", path: ["customerId"], message: "Pick an existing customer or enter a new one." });
  }
  if (!value.billingSameAsShipping && !value.billingAddress) {
    ctx.addIssue({ code: "custom", path: ["billingAddress"], message: "Enter the billing address or tick same as shipping." });
  }
  value.items.forEach((line, index) => {
    if (line.unitPriceOverridePaise !== null && line.unitPriceOverridePaise !== undefined && !line.overrideReason) {
      ctx.addIssue({ code: "custom", path: ["items", index, "overrideReason"], message: "Say why the price was changed." });
    }
  });
});
export type ManualOrderInput = z.input<typeof manualOrderSchema>;
export type ManualOrderValues = z.output<typeof manualOrderSchema>;

// ---------------------------------------------------------------------------
// Detail-page mutations
// ---------------------------------------------------------------------------

export const transitionOrderSchema = z
  .object({
    toStatus: orderStatusSchema,
    reason: optionalText(200),
    note: optionalText(1000),
  })
  .superRefine((value, ctx) => {
    if ((value.toStatus === "CANCELLED" || value.toStatus === "FAILED") && !value.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Choose why this order is being cancelled." });
    }
  });
export type TransitionOrderInput = z.input<typeof transitionOrderSchema>;
export type TransitionOrderValues = z.output<typeof transitionOrderSchema>;

export const addNoteSchema = z.object({
  message: text(2000).min(1, "Write the note before saving it."),
  /** Internal notes never reach the customer or the public API. */
  isInternal: z.boolean().default(true),
});
export type AddNoteInput = z.input<typeof addNoteSchema>;
export type AddNoteValues = z.output<typeof addNoteSchema>;

export const updateAddressSchema = addressInputSchema.extend({
  type: z.enum(["SHIPPING", "BILLING"]).default("SHIPPING"),
});
export type UpdateAddressInput = z.input<typeof updateAddressSchema>;
export type UpdateAddressValues = z.output<typeof updateAddressSchema>;

export const recordManualPaymentSchema = z.object({
  amountPaise: paiseSchema.refine((value) => value > 0, "Enter an amount greater than zero."),
  method: z.enum(MANUAL_PAYMENT_INSTRUMENTS),
  reference: optionalText(120),
  note: optionalText(500),
});
export type RecordManualPaymentInput = z.input<typeof recordManualPaymentSchema>;
export type RecordManualPaymentValues = z.output<typeof recordManualPaymentSchema>;

export const createShipmentSchema = z.object({
  items: z.array(z.object({ orderItemId: z.string().trim().min(1), quantity: quantitySchema })).min(1, "Pick at least one line."),
  partnerId: z.string().trim().min(1).nullable().optional(),
  carrierName: optionalText(80),
  trackingNumber: optionalText(80),
  trackingUrl: z.preprocess(blankToUndefined, safeUrlSchema.optional()),
  weightGrams: z.preprocess((value) => (value === "" ? null : value), z.coerce.number().int().min(0).max(1_000_000).nullable().optional()),
  costPaise: z.preprocess((value) => (value === "" || value === null ? undefined : value), paiseSchema.optional()),
  estimatedDeliveryAt: z.preprocess(blankToNull, z.coerce.date().nullable().optional()),
  note: optionalText(500),
  /** Hand it to the courier straight away (status SHIPPED) instead of PENDING. */
  markShipped: z.boolean().default(false),
});
export type CreateShipmentInput = z.input<typeof createShipmentSchema>;
export type CreateShipmentValues = z.output<typeof createShipmentSchema>;

export const updateShipmentStatusSchema = z.object({
  toStatus: shipmentStatusSchema,
  note: optionalText(500),
  location: optionalText(120),
  occurredAt: z.preprocess(blankToUndefined, z.coerce.date().optional()),
});
export type UpdateShipmentStatusInput = z.input<typeof updateShipmentStatusSchema>;
export type UpdateShipmentStatusValues = z.output<typeof updateShipmentStatusSchema>;

export const cancelOrderItemSchema = z.object({
  quantity: quantitySchema,
  reason: text(200).min(2, "Say why the line is being cancelled."),
});
export type CancelOrderItemInput = z.input<typeof cancelOrderItemSchema>;
export type CancelOrderItemValues = z.output<typeof cancelOrderItemSchema>;

export const bulkOrdersSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(BULK_MAX_IDS),
  op: z.enum(BULK_ORDER_OPS),
});
export type BulkOrdersInput = z.input<typeof bulkOrdersSchema>;
export type BulkOrdersValues = z.output<typeof bulkOrdersSchema>;

/** Query used by the manual order form to price a draft before committing. */
export const previewDraftSchema = z.object({
  items: z.array(manualOrderLineSchema).max(50),
  couponCode: optionalText(40),
  shippingRateId: optionalText(64),
  paymentMethod: paymentMethodSchema,
  pinCode: z.string().trim().optional(),
  state: optionalText(80),
  customerEmail: optionalEmail,
  customerId: z.string().trim().min(1).nullable().optional(),
});
export type PreviewDraftInput = z.input<typeof previewDraftSchema>;
export type PreviewDraftValues = z.output<typeof previewDraftSchema>;
