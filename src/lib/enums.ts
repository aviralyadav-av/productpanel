/**
 * Every status vocabulary in the marketplace schema, in one place.
 *
 * The schema stores these as plain String columns (blueprint D6) so a workflow
 * can gain a state without a migration. This file is therefore the single
 * source of truth for the allowed values, their display labels and badge tones,
 * and - where a workflow exists - the legal transitions.
 *
 * Anything that writes one of these columns must validate through the Zod
 * schema here first. Anything that moves an entity between states must consult
 * the matching *_TRANSITIONS map (via canTransition* helpers).
 *
 * Convention per vocabulary:
 *   FOO_STATUSES (readonly tuple) -> FooStatus type -> fooStatusSchema (Zod)
 *   -> FOO_STATUS_META (label, tone, description?) -> FOO_TRANSITIONS?
 */
import { z } from "zod";

export type BadgeTone =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info";

export type Meta = { label: string; tone: BadgeTone; description?: string };

/** Generic transition check used by every workflow map below. */
function makeCanTransition<S extends string>(
  map: Record<S, readonly S[]>,
): (from: S, to: S) => boolean {
  return (from, to) => (map[from] as readonly S[] | undefined)?.includes(to) ?? false;
}

// ===========================================================================
// ORDERS
// ===========================================================================

// ---------------------------------------------------------------------------
// Order status (§4.6, §10, C1/C2)
// ---------------------------------------------------------------------------

export const ORDER_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
  "RETURN_REQUESTED",
  "RETURNED",
  "REFUNDED",
  "FAILED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const orderStatusSchema = z.enum(ORDER_STATUSES);

export const ORDER_STATUS_META: Record<OrderStatus, Meta> = {
  PENDING: { label: "Pending", tone: "warning", description: "Placed; stock reserved, awaiting confirmation or payment." },
  CONFIRMED: { label: "Confirmed", tone: "info", description: "Payment confirmed or COD accepted; reservation committed to a sale." },
  PROCESSING: { label: "Processing", tone: "brand", description: "Being prepared or personalised." },
  PACKED: { label: "Packed", tone: "brand", description: "Ready for the courier." },
  SHIPPED: { label: "Shipped", tone: "brand", description: "At least one shipment is on its way." },
  OUT_FOR_DELIVERY: { label: "Out for delivery", tone: "brand", description: "A shipment is with the delivery agent." },
  DELIVERED: { label: "Delivered", tone: "success", description: "Every active line has been delivered." },
  CANCELLED: { label: "Cancelled", tone: "danger", description: "Cancelled before delivery; stock released or restocked." },
  RETURN_REQUESTED: { label: "Return requested", tone: "warning", description: "An RMA is open on this order." },
  RETURNED: { label: "Returned", tone: "warning", description: "Returned goods received and QC passed." },
  REFUNDED: { label: "Refunded", tone: "neutral", description: "Fully refunded." },
  FAILED: { label: "Failed", tone: "danger", description: "Payment never completed; reservation released." },
};

/**
 * Full state machine (§10). SHIPPED/OUT_FOR_DELIVERY/DELIVERED are reached
 * through shipment updates and RETURN_REQUESTED/RETURNED/REFUNDED through the
 * returns/refunds services; see MANUAL_ORDER_TRANSITIONS for what an operator
 * may set directly.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED", "FAILED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["PACKED", "CANCELLED"],
  PACKED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["OUT_FOR_DELIVERY", "DELIVERED", "RETURNED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "SHIPPED", "RETURNED"],
  DELIVERED: ["RETURN_REQUESTED"],
  RETURN_REQUESTED: ["RETURNED", "DELIVERED"],
  RETURNED: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
  FAILED: [],
};

/**
 * What `PUT /orders/:id/status` accepts from an operator (C2). PACKED→SHIPPED
 * creates a shipment for all unshipped lines when none exists.
 */
export const MANUAL_ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED", "FAILED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["PACKED", "CANCELLED"],
  PACKED: ["SHIPPED", "CANCELLED"],
  SHIPPED: [],
  OUT_FOR_DELIVERY: [],
  DELIVERED: [],
  RETURN_REQUESTED: [],
  RETURNED: [],
  CANCELLED: [],
  REFUNDED: [],
  FAILED: [],
};

/** Statuses derived by other services and rejected as manual targets (C2). */
export const DERIVED_ORDER_STATUSES: readonly OrderStatus[] = [
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "RETURN_REQUESTED",
  "RETURNED",
  "REFUNDED",
];

/** Terminal states accept no further transitions. (No implicit restock - C3.) */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ["CANCELLED", "REFUNDED", "FAILED"];

export const canTransition = makeCanTransition(ORDER_TRANSITIONS);
export const canTransitionOrder = canTransition;
export const canManuallyTransitionOrder = makeCanTransition(MANUAL_ORDER_TRANSITIONS);

// ---------------------------------------------------------------------------
// Order payment status (Order.paymentStatus, derived per B6)
// ---------------------------------------------------------------------------

export const PAYMENT_STATUSES = [
  "PENDING",
  "AUTHORIZED",
  "PAID",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "CANCELLED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);

export const PAYMENT_STATUS_META: Record<PaymentStatus, Meta> = {
  PENDING: { label: "Pending", tone: "warning" },
  AUTHORIZED: { label: "Authorised", tone: "info", description: "Authorised but not yet captured." },
  PAID: { label: "Paid", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  PARTIALLY_REFUNDED: { label: "Part refunded", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

// ---------------------------------------------------------------------------
// Order payment method (Order.paymentMethod)
// ---------------------------------------------------------------------------

export const PAYMENT_METHODS = ["COD", "ONLINE", "MANUAL"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

export const PAYMENT_METHOD_META: Record<PaymentMethod, Meta> = {
  COD: { label: "Cash on delivery", tone: "neutral" },
  ONLINE: { label: "Online", tone: "info" },
  MANUAL: { label: "Manual", tone: "neutral", description: "Recorded by an operator." },
};

// ---------------------------------------------------------------------------
// Order source
// ---------------------------------------------------------------------------

export const ORDER_SOURCES = ["STOREFRONT", "MANUAL", "API"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];
export const orderSourceSchema = z.enum(ORDER_SOURCES);

export const ORDER_SOURCE_META: Record<OrderSource, Meta> = {
  STOREFRONT: { label: "Storefront", tone: "info" },
  MANUAL: { label: "Manual", tone: "neutral" },
  API: { label: "API", tone: "neutral" },
};

// ---------------------------------------------------------------------------
// Fulfilment status (Order.fulfillmentStatus, C1)
// ---------------------------------------------------------------------------

export const FULFILLMENT_STATUSES = ["UNFULFILLED", "PARTIAL", "FULFILLED"] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];
export const fulfillmentStatusSchema = z.enum(FULFILLMENT_STATUSES);

export const FULFILLMENT_STATUS_META: Record<FulfillmentStatus, Meta> = {
  UNFULFILLED: { label: "Unfulfilled", tone: "warning" },
  PARTIAL: { label: "Partially fulfilled", tone: "info" },
  FULFILLED: { label: "Fulfilled", tone: "success" },
};

// ---------------------------------------------------------------------------
// Order return status (Order.returnStatus, C4)
// ---------------------------------------------------------------------------

export const ORDER_RETURN_STATUSES = ["NONE", "REQUESTED", "PARTIAL", "FULL"] as const;
export type OrderReturnStatus = (typeof ORDER_RETURN_STATUSES)[number];
export const orderReturnStatusSchema = z.enum(ORDER_RETURN_STATUSES);

export const ORDER_RETURN_STATUS_META: Record<OrderReturnStatus, Meta> = {
  NONE: { label: "No returns", tone: "neutral" },
  REQUESTED: { label: "Return open", tone: "warning" },
  PARTIAL: { label: "Partially returned", tone: "info" },
  FULL: { label: "Fully returned", tone: "neutral" },
};

// ---------------------------------------------------------------------------
// Tax remitted by (Order.taxRemittedBy, B1)
// ---------------------------------------------------------------------------

export const TAX_REMITTERS = ["SELLER", "PLATFORM"] as const;
export type TaxRemitter = (typeof TAX_REMITTERS)[number];
export const taxRemitterSchema = z.enum(TAX_REMITTERS);

// ---------------------------------------------------------------------------
// Order item status (C1)
// ---------------------------------------------------------------------------

export const ORDER_ITEM_STATUSES = ["ACTIVE", "CANCELLED", "RETURNED", "REFUNDED"] as const;
export type OrderItemStatus = (typeof ORDER_ITEM_STATUSES)[number];
export const orderItemStatusSchema = z.enum(ORDER_ITEM_STATUSES);

export const ORDER_ITEM_STATUS_META: Record<OrderItemStatus, Meta> = {
  ACTIVE: { label: "Active", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
  RETURNED: { label: "Returned", tone: "warning" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
};

// ---------------------------------------------------------------------------
// Order address type
// ---------------------------------------------------------------------------

export const ORDER_ADDRESS_TYPES = ["SHIPPING", "BILLING"] as const;
export type OrderAddressType = (typeof ORDER_ADDRESS_TYPES)[number];
export const orderAddressTypeSchema = z.enum(ORDER_ADDRESS_TYPES);

// ---------------------------------------------------------------------------
// Order event type
// ---------------------------------------------------------------------------

export const ORDER_EVENT_TYPES = [
  "STATUS_CHANGE",
  "PAYMENT",
  "SHIPMENT",
  "NOTE",
  "SYSTEM",
  "REFUND",
  "RETURN",
] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];
export const orderEventTypeSchema = z.enum(ORDER_EVENT_TYPES);

export const ORDER_EVENT_TYPE_META: Record<OrderEventType, Meta> = {
  STATUS_CHANGE: { label: "Status change", tone: "brand" },
  PAYMENT: { label: "Payment", tone: "success" },
  SHIPMENT: { label: "Shipment", tone: "info" },
  NOTE: { label: "Note", tone: "neutral" },
  SYSTEM: { label: "System", tone: "neutral" },
  REFUND: { label: "Refund", tone: "warning" },
  RETURN: { label: "Return", tone: "warning" },
};

// ===========================================================================
// PAYMENTS (OrderPayment)
// ===========================================================================

export const PAYMENT_PROVIDERS = [
  "COD",
  "MANUAL",
  "MOCK",
  "RAZORPAY",
  "STRIPE",
  "PAYU",
  "PHONEPE",
] as const;
export type PaymentProviderCode = (typeof PAYMENT_PROVIDERS)[number];
export const paymentProviderSchema = z.enum(PAYMENT_PROVIDERS);

export const PAYMENT_PROVIDER_META: Record<PaymentProviderCode, Meta> = {
  COD: { label: "Cash on delivery", tone: "neutral" },
  MANUAL: { label: "Manual entry", tone: "neutral" },
  MOCK: { label: "Mock gateway", tone: "warning", description: "Test-only provider that always succeeds." },
  RAZORPAY: { label: "Razorpay", tone: "info" },
  STRIPE: { label: "Stripe", tone: "info" },
  PAYU: { label: "PayU", tone: "info" },
  PHONEPE: { label: "PhonePe", tone: "info" },
};

export const PAYMENT_PROVIDER_MODES = ["TEST", "LIVE"] as const;
export type PaymentProviderMode = (typeof PAYMENT_PROVIDER_MODES)[number];
export const paymentProviderModeSchema = z.enum(PAYMENT_PROVIDER_MODES);

export const PAYMENT_TYPES = ["CHARGE", "REFUND", "AUTHORIZATION", "CAPTURE"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];
export const paymentTypeSchema = z.enum(PAYMENT_TYPES);

export const PAYMENT_TYPE_META: Record<PaymentType, Meta> = {
  CHARGE: { label: "Charge", tone: "success" },
  REFUND: { label: "Refund", tone: "warning" },
  AUTHORIZATION: { label: "Authorisation", tone: "info" },
  CAPTURE: { label: "Capture", tone: "success" },
};

/** OrderPayment.method - the instrument, distinct from Order.paymentMethod. */
export const PAYMENT_INSTRUMENTS = [
  "COD",
  "UPI",
  "CARD",
  "NETBANKING",
  "WALLET",
  "BANK_TRANSFER",
  "CASH",
  "OTHER",
] as const;
export type PaymentInstrument = (typeof PAYMENT_INSTRUMENTS)[number];
export const paymentInstrumentSchema = z.enum(PAYMENT_INSTRUMENTS);

export const PAYMENT_INSTRUMENT_META: Record<PaymentInstrument, Meta> = {
  COD: { label: "COD", tone: "neutral" },
  UPI: { label: "UPI", tone: "info" },
  CARD: { label: "Card", tone: "info" },
  NETBANKING: { label: "Net banking", tone: "info" },
  WALLET: { label: "Wallet", tone: "info" },
  BANK_TRANSFER: { label: "Bank transfer", tone: "neutral" },
  CASH: { label: "Cash", tone: "neutral" },
  OTHER: { label: "Other", tone: "neutral" },
};

export const PAYMENT_TRANSACTION_STATUSES = ["PENDING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export type PaymentTransactionStatus = (typeof PAYMENT_TRANSACTION_STATUSES)[number];
export const paymentTransactionStatusSchema = z.enum(PAYMENT_TRANSACTION_STATUSES);

export const PAYMENT_TRANSACTION_STATUS_META: Record<PaymentTransactionStatus, Meta> = {
  PENDING: { label: "Pending", tone: "warning" },
  SUCCEEDED: { label: "Succeeded", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

// ===========================================================================
// SHIPPING
// ===========================================================================

export const SHIPMENT_STATUSES = [
  "PENDING",
  "PACKED",
  "SHIPPED",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED_DELIVERY",
  "RETURNED_TO_ORIGIN",
  "CANCELLED",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export const shipmentStatusSchema = z.enum(SHIPMENT_STATUSES);

export const SHIPMENT_STATUS_META: Record<ShipmentStatus, Meta> = {
  PENDING: { label: "Pending", tone: "neutral" },
  PACKED: { label: "Packed", tone: "info" },
  SHIPPED: { label: "Shipped", tone: "brand" },
  IN_TRANSIT: { label: "In transit", tone: "brand" },
  OUT_FOR_DELIVERY: { label: "Out for delivery", tone: "brand" },
  DELIVERED: { label: "Delivered", tone: "success" },
  FAILED_DELIVERY: { label: "Delivery failed", tone: "warning", description: "Recorded as an event; the shipment stays in its current status." },
  RETURNED_TO_ORIGIN: { label: "Returned to origin", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

/**
 * FAILED_DELIVERY is an event, not a resting state (C2), so it is never a
 * transition target here; RTO and cancellation are the exits from transit.
 */
export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  PENDING: ["PACKED", "SHIPPED", "CANCELLED"],
  PACKED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED_TO_ORIGIN"],
  IN_TRANSIT: ["OUT_FOR_DELIVERY", "DELIVERED", "RETURNED_TO_ORIGIN"],
  OUT_FOR_DELIVERY: ["DELIVERED", "IN_TRANSIT", "RETURNED_TO_ORIGIN"],
  DELIVERED: [],
  FAILED_DELIVERY: [],
  RETURNED_TO_ORIGIN: [],
  CANCELLED: [],
};
export const canTransitionShipment = makeCanTransition(SHIPMENT_TRANSITIONS);

export const SHIPPING_METHODS = ["STANDARD", "EXPRESS", "SAME_DAY", "PICKUP"] as const;
export type ShippingMethod = (typeof SHIPPING_METHODS)[number];
export const shippingMethodSchema = z.enum(SHIPPING_METHODS);

export const SHIPPING_METHOD_META: Record<ShippingMethod, Meta> = {
  STANDARD: { label: "Standard", tone: "neutral" },
  EXPRESS: { label: "Express", tone: "brand" },
  SAME_DAY: { label: "Same day", tone: "info" },
  PICKUP: { label: "Store pickup", tone: "neutral" },
};

// ===========================================================================
// RETURNS & REFUNDS
// ===========================================================================

export const RETURN_REQUEST_STATUSES = [
  "REQUESTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "PICKUP_SCHEDULED",
  "RECEIVED",
  "QC_PASSED",
  "QC_FAILED",
  "REFUND_INITIATED",
  "REFUND_COMPLETED",
  "REPLACEMENT_SHIPPED",
  "CLOSED",
  "CANCELLED",
] as const;
export type ReturnRequestStatus = (typeof RETURN_REQUEST_STATUSES)[number];
export const returnRequestStatusSchema = z.enum(RETURN_REQUEST_STATUSES);

export const RETURN_REQUEST_STATUS_META: Record<ReturnRequestStatus, Meta> = {
  REQUESTED: { label: "Requested", tone: "warning" },
  UNDER_REVIEW: { label: "Under review", tone: "info" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  PICKUP_SCHEDULED: { label: "Pickup scheduled", tone: "brand" },
  RECEIVED: { label: "Received", tone: "brand" },
  QC_PASSED: { label: "QC passed", tone: "success" },
  QC_FAILED: { label: "QC failed", tone: "danger" },
  REFUND_INITIATED: { label: "Refund initiated", tone: "info" },
  REFUND_COMPLETED: { label: "Refund completed", tone: "success" },
  REPLACEMENT_SHIPPED: { label: "Replacement shipped", tone: "brand" },
  CLOSED: { label: "Closed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

/** Return flow (C4). QC_PASSED branches on resolution; QC_FAILED on qcDisposition. */
export const RETURN_REQUEST_TRANSITIONS: Record<ReturnRequestStatus, readonly ReturnRequestStatus[]> = {
  REQUESTED: ["UNDER_REVIEW", "APPROVED", "REJECTED", "CANCELLED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["PICKUP_SCHEDULED", "CANCELLED"],
  REJECTED: ["CLOSED"],
  PICKUP_SCHEDULED: ["RECEIVED", "CANCELLED"],
  RECEIVED: ["QC_PASSED", "QC_FAILED"],
  QC_PASSED: ["REFUND_INITIATED", "REPLACEMENT_SHIPPED"],
  QC_FAILED: ["REFUND_INITIATED", "CLOSED"],
  REFUND_INITIATED: ["REFUND_COMPLETED"],
  REFUND_COMPLETED: ["CLOSED"],
  REPLACEMENT_SHIPPED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};
export const canTransitionReturn = makeCanTransition(RETURN_REQUEST_TRANSITIONS);

/** Open RMAs block earnings from becoming AVAILABLE and count towards Order.returnStatus. */
export const OPEN_RETURN_STATUSES: readonly ReturnRequestStatus[] = [
  "REQUESTED",
  "UNDER_REVIEW",
  "APPROVED",
  "PICKUP_SCHEDULED",
  "RECEIVED",
  "QC_PASSED",
  "QC_FAILED",
  "REFUND_INITIATED",
];

export const RETURN_REASONS = [
  "DAMAGED",
  "DEFECTIVE",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
  "SIZE_ISSUE",
  "CHANGED_MIND",
  "LATE_DELIVERY",
  "OTHER",
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];
export const returnReasonSchema = z.enum(RETURN_REASONS);

export const RETURN_REASON_META: Record<ReturnReason, Meta> = {
  DAMAGED: { label: "Damaged in transit", tone: "danger" },
  DEFECTIVE: { label: "Defective", tone: "danger" },
  WRONG_ITEM: { label: "Wrong item", tone: "warning" },
  NOT_AS_DESCRIBED: { label: "Not as described", tone: "warning" },
  SIZE_ISSUE: { label: "Size issue", tone: "neutral" },
  CHANGED_MIND: { label: "Changed mind", tone: "neutral" },
  LATE_DELIVERY: { label: "Late delivery", tone: "warning" },
  OTHER: { label: "Other", tone: "neutral" },
};

/** Reasons where the seller bears the pickup fee and shipping is refundable (B5, B6). */
export const SELLER_FAULT_RETURN_REASONS: readonly ReturnReason[] = [
  "DAMAGED",
  "DEFECTIVE",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
];

export const RETURN_RESOLUTIONS = ["REFUND", "REPLACEMENT", "STORE_CREDIT"] as const;
export type ReturnResolution = (typeof RETURN_RESOLUTIONS)[number];
export const returnResolutionSchema = z.enum(RETURN_RESOLUTIONS);

export const RETURN_RESOLUTION_META: Record<ReturnResolution, Meta> = {
  REFUND: { label: "Refund", tone: "info" },
  REPLACEMENT: { label: "Replacement", tone: "brand" },
  STORE_CREDIT: { label: "Store credit", tone: "neutral", description: "Out of scope for v1 (B6); kept for data compatibility." },
};

export const QC_DISPOSITIONS = ["RETURN_TO_CUSTOMER", "RESTOCK", "DISPOSE", "PARTIAL_REFUND"] as const;
export type QcDisposition = (typeof QC_DISPOSITIONS)[number];
export const qcDispositionSchema = z.enum(QC_DISPOSITIONS);

export const QC_DISPOSITION_META: Record<QcDisposition, Meta> = {
  RETURN_TO_CUSTOMER: { label: "Return to customer", tone: "neutral" },
  RESTOCK: { label: "Restock", tone: "success", description: "RETURN movement +qty." },
  DISPOSE: { label: "Dispose", tone: "danger", description: "DAMAGE movement, note only (delta 0)." },
  PARTIAL_REFUND: { label: "Partial refund", tone: "warning" },
};

export const REFUND_STATUSES = ["PENDING", "APPROVED", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export const refundStatusSchema = z.enum(REFUND_STATUSES);

export const REFUND_STATUS_META: Record<RefundStatus, Meta> = {
  PENDING: { label: "Pending", tone: "warning" },
  APPROVED: { label: "Approved", tone: "info" },
  PROCESSING: { label: "Processing", tone: "brand" },
  COMPLETED: { label: "Completed", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

/** Refund flow (B6). FAILED may be retried back to PENDING. */
export const REFUND_TRANSITIONS: Record<RefundStatus, readonly RefundStatus[]> = {
  PENDING: ["APPROVED", "CANCELLED"],
  APPROVED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["COMPLETED", "FAILED"],
  FAILED: ["PENDING"],
  COMPLETED: [],
  CANCELLED: [],
};
export const canTransitionRefund = makeCanTransition(REFUND_TRANSITIONS);

/** Refund rows that count against the refundable cap (B6). */
export const COUNTED_REFUND_STATUSES: readonly RefundStatus[] = ["PENDING", "APPROVED", "PROCESSING", "COMPLETED"];

export const REFUND_METHODS = ["ORIGINAL", "BANK_TRANSFER", "STORE_CREDIT", "MANUAL"] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];
export const refundMethodSchema = z.enum(REFUND_METHODS);

export const REFUND_METHOD_META: Record<RefundMethod, Meta> = {
  ORIGINAL: { label: "Original payment", tone: "info" },
  BANK_TRANSFER: { label: "Bank transfer", tone: "neutral" },
  STORE_CREDIT: { label: "Store credit", tone: "neutral" },
  MANUAL: { label: "Manual", tone: "neutral" },
};

// ===========================================================================
// SELLERS & FINANCE
// ===========================================================================

export const SELLER_STATUSES = ["PENDING", "UNDER_REVIEW", "APPROVED", "ACTIVE", "SUSPENDED", "REJECTED"] as const;
export type SellerStatus = (typeof SELLER_STATUSES)[number];
export const sellerStatusSchema = z.enum(SELLER_STATUSES);

export const SELLER_STATUS_META: Record<SellerStatus, Meta> = {
  PENDING: { label: "Pending", tone: "warning", description: "Registered, awaiting review." },
  UNDER_REVIEW: { label: "Under review", tone: "info" },
  APPROVED: { label: "Approved", tone: "success", description: "Approved; activates once KYC and a primary bank account exist." },
  ACTIVE: { label: "Active", tone: "success", description: "Products visible publicly." },
  SUSPENDED: { label: "Suspended", tone: "danger", description: "Products hidden; existing orders still fulfil." },
  REJECTED: { label: "Rejected", tone: "danger" },
};

/** Seller state machine (C5). */
export const SELLER_TRANSITIONS: Record<SellerStatus, readonly SellerStatus[]> = {
  PENDING: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["ACTIVE"],
  ACTIVE: ["SUSPENDED"],
  SUSPENDED: ["ACTIVE"],
  REJECTED: ["UNDER_REVIEW"],
};
export const canTransitionSeller = makeCanTransition(SELLER_TRANSITIONS);

export const SELLER_DOCUMENT_TYPES = ["PAN", "AADHAAR", "GSTIN", "BANK_PROOF", "ADDRESS_PROOF", "OTHER"] as const;
export type SellerDocumentType = (typeof SELLER_DOCUMENT_TYPES)[number];
export const sellerDocumentTypeSchema = z.enum(SELLER_DOCUMENT_TYPES);

export const SELLER_DOCUMENT_TYPE_META: Record<SellerDocumentType, Meta> = {
  PAN: { label: "PAN card", tone: "neutral" },
  AADHAAR: { label: "Aadhaar", tone: "neutral" },
  GSTIN: { label: "GST certificate", tone: "neutral" },
  BANK_PROOF: { label: "Bank proof", tone: "neutral" },
  ADDRESS_PROOF: { label: "Address proof", tone: "neutral" },
  OTHER: { label: "Other", tone: "neutral" },
};

export const SELLER_DOCUMENT_STATUSES = ["PENDING", "VERIFIED", "REJECTED"] as const;
export type SellerDocumentStatus = (typeof SELLER_DOCUMENT_STATUSES)[number];
export const sellerDocumentStatusSchema = z.enum(SELLER_DOCUMENT_STATUSES);

export const SELLER_DOCUMENT_STATUS_META: Record<SellerDocumentStatus, Meta> = {
  PENDING: { label: "Pending", tone: "warning" },
  VERIFIED: { label: "Verified", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};

export const LEDGER_ENTRY_TYPES = [
  "SALE",
  "COMMISSION",
  "CHARGE",
  "PAYOUT",
  "ADJUSTMENT",
  "REFUND_REVERSAL",
  "COMMISSION_TAX",
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];
export const ledgerEntryTypeSchema = z.enum(LEDGER_ENTRY_TYPES);

export const LEDGER_ENTRY_TYPE_META: Record<LedgerEntryType, Meta> = {
  SALE: { label: "Sale", tone: "success", description: "Credit (+)." },
  COMMISSION: { label: "Commission", tone: "warning", description: "Debit (−)." },
  CHARGE: { label: "Charge", tone: "warning", description: "Debit (−)." },
  PAYOUT: { label: "Payout", tone: "info", description: "Debit (−) when a statement is paid." },
  ADJUSTMENT: { label: "Adjustment", tone: "neutral", description: "Signed manual entry (payouts.adjust)." },
  REFUND_REVERSAL: { label: "Refund reversal", tone: "danger", description: "Signed; reverses sale and commission pro rata." },
  COMMISSION_TAX: { label: "Commission tax", tone: "neutral", description: "Reserved (−)." },
};

/** Ledger rows unique per (orderItemId, type) - enforced by a partial index. */
export const PER_ITEM_LEDGER_TYPES: readonly LedgerEntryType[] = ["SALE", "COMMISSION", "CHARGE"];

export const LEDGER_ENTRY_STATUSES = ["PENDING", "AVAILABLE", "SCHEDULED", "PAID", "REVERSED"] as const;
export type LedgerEntryStatus = (typeof LEDGER_ENTRY_STATUSES)[number];
export const ledgerEntryStatusSchema = z.enum(LEDGER_ENTRY_STATUSES);

export const LEDGER_ENTRY_STATUS_META: Record<LedgerEntryStatus, Meta> = {
  PENDING: { label: "Pending", tone: "warning", description: "Inside the payout hold period." },
  AVAILABLE: { label: "Available", tone: "success", description: "Eligible for the next statement." },
  SCHEDULED: { label: "Scheduled", tone: "info", description: "Attached to an open statement." },
  PAID: { label: "Paid", tone: "neutral" },
  REVERSED: { label: "Reversed", tone: "danger", description: "Admin-voided adjustment only." },
};

export const PAYOUT_STATUSES = ["PENDING", "APPROVED", "PROCESSING", "PAID", "FAILED", "CANCELLED"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
export const payoutStatusSchema = z.enum(PAYOUT_STATUSES);

export const PAYOUT_STATUS_META: Record<PayoutStatus, Meta> = {
  PENDING: { label: "Pending", tone: "warning" },
  APPROVED: { label: "Approved", tone: "info" },
  PROCESSING: { label: "Processing", tone: "brand" },
  PAID: { label: "Paid", tone: "success" },
  FAILED: { label: "Failed", tone: "danger", description: "Entries return to AVAILABLE." },
  CANCELLED: { label: "Cancelled", tone: "neutral", description: "Entries return to AVAILABLE." },
};

/** Payout flow (B5). */
export const PAYOUT_TRANSITIONS: Record<PayoutStatus, readonly PayoutStatus[]> = {
  PENDING: ["APPROVED", "CANCELLED"],
  APPROVED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["PAID", "FAILED"],
  PAID: [],
  FAILED: [],
  CANCELLED: [],
};
export const canTransitionPayout = makeCanTransition(PAYOUT_TRANSITIONS);

/** Statuses that count as "open" for the one-open-statement-per-seller rule. */
export const OPEN_PAYOUT_STATUSES: readonly PayoutStatus[] = ["PENDING", "APPROVED", "PROCESSING"];

export const PAYOUT_METHODS = ["BANK_TRANSFER", "UPI", "MANUAL"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];
export const payoutMethodSchema = z.enum(PAYOUT_METHODS);

export const PAYOUT_METHOD_META: Record<PayoutMethod, Meta> = {
  BANK_TRANSFER: { label: "Bank transfer", tone: "neutral" },
  UPI: { label: "UPI", tone: "info" },
  MANUAL: { label: "Manual", tone: "neutral" },
};

export const COMMISSION_SCOPES = ["GLOBAL", "CATEGORY", "SELLER", "PRODUCT"] as const;
export type CommissionScope = (typeof COMMISSION_SCOPES)[number];
export const commissionScopeSchema = z.enum(COMMISSION_SCOPES);

export const COMMISSION_SCOPE_META: Record<CommissionScope, Meta> = {
  GLOBAL: { label: "Global", tone: "neutral", description: "Exactly one active row; the fallback rate." },
  CATEGORY: { label: "Category", tone: "info", description: "Nearest ancestor wins." },
  SELLER: { label: "Seller", tone: "brand", description: "Beats category rules." },
  PRODUCT: { label: "Product", tone: "success", description: "Most specific." },
};

/** Build the CommissionRule.targetKey for a scope (B3). */
export function commissionTargetKey(scope: CommissionScope, targetId?: string | null): string {
  return scope === "GLOBAL" ? "GLOBAL" : `${scope}:${targetId}`;
}

export const DISCOUNT_FUNDERS = ["PLATFORM", "SELLER"] as const;
export type DiscountFunder = (typeof DISCOUNT_FUNDERS)[number];
export const discountFunderSchema = z.enum(DISCOUNT_FUNDERS);

export const MARKETPLACE_CHARGE_TYPES = ["PERCENT_OF_GROSS", "FIXED_PER_ITEM", "FIXED_PER_ORDER"] as const;
export type MarketplaceChargeType = (typeof MARKETPLACE_CHARGE_TYPES)[number];
export const MARKETPLACE_CHARGE_CONDITIONS = ["ALWAYS", "ONLINE_PAYMENT", "COD"] as const;
export type MarketplaceChargeCondition = (typeof MARKETPLACE_CHARGE_CONDITIONS)[number];

/** Shape of the `marketplace.charges` JSON setting (B3). */
export const marketplaceChargeSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(MARKETPLACE_CHARGE_TYPES),
  valueBps: z.number().int().min(0).optional(),
  valuePaise: z.number().int().min(0).optional(),
  appliesWhen: z.enum(MARKETPLACE_CHARGE_CONDITIONS).default("ALWAYS"),
});
export type MarketplaceCharge = z.infer<typeof marketplaceChargeSchema>;

export const PAYOUT_CYCLES = ["WEEKLY", "FORTNIGHTLY", "MONTHLY"] as const;
export type PayoutCycle = (typeof PAYOUT_CYCLES)[number];
export const payoutCycleSchema = z.enum(PAYOUT_CYCLES);

// ===========================================================================
// MARKETING
// ===========================================================================

export const COUPON_TYPES = ["PERCENT", "FIXED", "FREE_SHIPPING"] as const;
export type CouponType = (typeof COUPON_TYPES)[number];
export const couponTypeSchema = z.enum(COUPON_TYPES);

export const COUPON_TYPE_META: Record<CouponType, Meta> = {
  PERCENT: { label: "Percentage", tone: "info", description: "value = percent points, capped by maxDiscountPaise." },
  FIXED: { label: "Fixed amount", tone: "info", description: "value = paise." },
  FREE_SHIPPING: { label: "Free shipping", tone: "brand" },
};

export const COUPON_APPLIES_TO = ["ALL", "CATEGORIES", "PRODUCTS", "SELLERS"] as const;
export type CouponAppliesTo = (typeof COUPON_APPLIES_TO)[number];
export const couponAppliesToSchema = z.enum(COUPON_APPLIES_TO);

export const COUPON_APPLIES_TO_META: Record<CouponAppliesTo, Meta> = {
  ALL: { label: "Whole order", tone: "neutral" },
  CATEGORIES: { label: "Categories", tone: "info" },
  PRODUCTS: { label: "Products", tone: "info" },
  SELLERS: { label: "Sellers", tone: "brand" },
};

/** Derived, never stored (§4.7). */
export const COUPON_STATUSES = ["ACTIVE", "SCHEDULED", "EXPIRED", "DISABLED", "EXHAUSTED"] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

export const COUPON_STATUS_META: Record<CouponStatus, Meta> = {
  ACTIVE: { label: "Active", tone: "success" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  DISABLED: { label: "Disabled", tone: "neutral" },
  EXHAUSTED: { label: "Exhausted", tone: "warning" },
};

export function deriveCouponStatus(
  coupon: {
    isActive: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
    usageLimit: number | null;
    usageCount: number;
  },
  now: Date = new Date(),
): CouponStatus {
  if (!coupon.isActive) return "DISABLED";
  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) return "EXHAUSTED";
  if (coupon.startsAt && coupon.startsAt > now) return "SCHEDULED";
  if (coupon.endsAt && coupon.endsAt < now) return "EXPIRED";
  return "ACTIVE";
}

export const PROMOTION_TYPES = ["SALE", "FLASH_SALE", "CLEARANCE"] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];
export const promotionTypeSchema = z.enum(PROMOTION_TYPES);

export const PROMOTION_TYPE_META: Record<PromotionType, Meta> = {
  SALE: { label: "Sale", tone: "info" },
  FLASH_SALE: { label: "Flash sale", tone: "brand" },
  CLEARANCE: { label: "Clearance", tone: "warning" },
};

export const PROMOTION_DISCOUNT_TYPES = ["PERCENT", "FIXED"] as const;
export type PromotionDiscountType = (typeof PROMOTION_DISCOUNT_TYPES)[number];
export const promotionDiscountTypeSchema = z.enum(PROMOTION_DISCOUNT_TYPES);

/** Promotions share the coupon scope vocabulary. */
export const PROMOTION_APPLIES_TO = COUPON_APPLIES_TO;
export const promotionAppliesToSchema = couponAppliesToSchema;

export const BANNER_PLACEMENTS = [
  "HOME_HERO",
  "HOME_PROMO",
  "HOME_STRIP",
  "CATEGORY_TOP",
  "SIDEBAR",
  "POPUP",
  "ANNOUNCEMENT",
  "CHECKOUT",
] as const;
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];
export const bannerPlacementSchema = z.enum(BANNER_PLACEMENTS);

export const BANNER_PLACEMENT_META: Record<BannerPlacement, Meta> = {
  HOME_HERO: { label: "Homepage hero", tone: "brand", description: "Slides for the hero slider section." },
  HOME_PROMO: { label: "Homepage promo", tone: "info" },
  HOME_STRIP: { label: "Homepage strip", tone: "info" },
  CATEGORY_TOP: { label: "Category top", tone: "neutral" },
  SIDEBAR: { label: "Sidebar", tone: "neutral" },
  POPUP: { label: "Popup", tone: "warning" },
  ANNOUNCEMENT: { label: "Announcement", tone: "neutral" },
  CHECKOUT: { label: "Checkout", tone: "neutral" },
};

/** Shared by Banner, ContentSection and promo sections (E1). */
export const LINK_TYPES = ["NONE", "URL", "CATEGORY", "PRODUCT", "PAGE", "BLOG"] as const;
export type LinkType = (typeof LINK_TYPES)[number];
export const linkTypeSchema = z.enum(LINK_TYPES);

export const LINK_TYPE_META: Record<LinkType, Meta> = {
  NONE: { label: "No link", tone: "neutral" },
  URL: { label: "URL", tone: "neutral" },
  CATEGORY: { label: "Category", tone: "info" },
  PRODUCT: { label: "Product", tone: "info" },
  PAGE: { label: "Page", tone: "info" },
  BLOG: { label: "Blog post", tone: "info" },
};

// ===========================================================================
// CATALOG
// ===========================================================================

export const PRODUCT_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export const productStatusSchema = z.enum(PRODUCT_STATUSES);

export const PRODUCT_STATUS_META: Record<ProductStatus, Meta> = {
  DRAFT: { label: "Draft", tone: "neutral", description: "Not visible on the storefront." },
  PUBLISHED: { label: "Published", tone: "success", description: "Live and purchasable." },
  ARCHIVED: { label: "Archived", tone: "warning", description: "Hidden, but history and orders are preserved." },
};

export const ATTRIBUTE_INPUT_TYPES = ["SELECT", "MULTI_SELECT", "TEXT", "NUMBER", "BOOLEAN", "COLOR"] as const;
export type AttributeInputType = (typeof ATTRIBUTE_INPUT_TYPES)[number];
export const attributeInputTypeSchema = z.enum(ATTRIBUTE_INPUT_TYPES);

export const ATTRIBUTE_INPUT_TYPE_META: Record<AttributeInputType, Meta> = {
  SELECT: { label: "Single select", tone: "info", description: "One predefined value; may define variants." },
  MULTI_SELECT: { label: "Multi select", tone: "info" },
  TEXT: { label: "Text", tone: "neutral" },
  NUMBER: { label: "Number", tone: "neutral", description: "Filterable as a range." },
  BOOLEAN: { label: "Yes / No", tone: "neutral" },
  COLOR: { label: "Colour", tone: "brand", description: "Select with a swatch; may define variants." },
};

/** Input types whose values are AttributeValue rows (valueKey = valueId, A8). */
export const SELECT_INPUT_TYPES: readonly AttributeInputType[] = ["SELECT", "MULTI_SELECT", "COLOR"];
/** Input types allowed as variant axes (A5). */
export const VARIANT_AXIS_INPUT_TYPES: readonly AttributeInputType[] = ["SELECT", "COLOR"];

export const ATTRIBUTE_FILTER_TYPES = ["CHECKBOX", "RADIO", "RANGE", "COLOR_SWATCH", "TOGGLE", "NONE"] as const;
export type AttributeFilterType = (typeof ATTRIBUTE_FILTER_TYPES)[number];
export const attributeFilterTypeSchema = z.enum(ATTRIBUTE_FILTER_TYPES);

export const ATTRIBUTE_FILTER_TYPE_META: Record<AttributeFilterType, Meta> = {
  CHECKBOX: { label: "Checkboxes", tone: "neutral" },
  RADIO: { label: "Radio", tone: "neutral" },
  RANGE: { label: "Range", tone: "neutral" },
  COLOR_SWATCH: { label: "Colour swatches", tone: "brand" },
  TOGGLE: { label: "Toggle", tone: "neutral" },
  NONE: { label: "Not filterable", tone: "neutral" },
};

export const CUSTOMIZATION_OPTION_TYPES = [
  "TEXT",
  "NAME",
  "MESSAGE",
  "ENGRAVING",
  "PHOTO",
  "IMAGE",
  "DESIGN_SELECT",
  "COLOR_SELECT",
  "SIZE_SELECT",
  "INSTRUCTIONS",
  "DROPDOWN",
  "CHECKBOX",
] as const;
export type CustomizationOptionType = (typeof CUSTOMIZATION_OPTION_TYPES)[number];
export const customizationOptionTypeSchema = z.enum(CUSTOMIZATION_OPTION_TYPES);

export const CUSTOMIZATION_OPTION_TYPE_META: Record<CustomizationOptionType, Meta> = {
  TEXT: { label: "Short text", tone: "neutral" },
  NAME: { label: "Name", tone: "neutral" },
  MESSAGE: { label: "Message", tone: "neutral" },
  ENGRAVING: { label: "Engraving text", tone: "neutral" },
  PHOTO: { label: "Photo upload", tone: "info", description: "Uploaded files are PRIVATE media." },
  IMAGE: { label: "Image upload", tone: "info" },
  DESIGN_SELECT: { label: "Design choice", tone: "brand" },
  COLOR_SELECT: { label: "Colour choice", tone: "brand" },
  SIZE_SELECT: { label: "Size choice", tone: "brand" },
  INSTRUCTIONS: { label: "Special instructions", tone: "neutral" },
  DROPDOWN: { label: "Dropdown", tone: "neutral" },
  CHECKBOX: { label: "Checkbox", tone: "neutral" },
};

/** Option types whose answer is one or more uploaded files. */
export const FILE_CUSTOMIZATION_TYPES: readonly CustomizationOptionType[] = ["PHOTO", "IMAGE"];
/** Option types whose answer must come from `choices`. */
export const CHOICE_CUSTOMIZATION_TYPES: readonly CustomizationOptionType[] = [
  "DESIGN_SELECT",
  "COLOR_SELECT",
  "SIZE_SELECT",
  "DROPDOWN",
];

export const BULK_PRODUCT_OPS = [
  "DELETE",
  "PUBLISH",
  "UNPUBLISH",
  "ARCHIVE",
  "SET_CATEGORY",
  "ADJUST_PRICE",
  "SET_STOCK",
  "SET_ATTRIBUTE",
  "SET_FLAGS",
] as const;
export type BulkProductOp = (typeof BULK_PRODUCT_OPS)[number];
export const bulkProductOpSchema = z.enum(BULK_PRODUCT_OPS);

// ===========================================================================
// INVENTORY
// ===========================================================================

export const STOCK_MOVEMENT_TYPES = [
  "PURCHASE",
  "SALE",
  "RETURN",
  "ADJUSTMENT",
  "CORRECTION",
  "DAMAGE",
  "SEED",
  "RESERVE",
  "RELEASE",
  "TRANSFER",
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
export const stockMovementTypeSchema = z.enum(STOCK_MOVEMENT_TYPES);

export const STOCK_MOVEMENT_META: Record<StockMovementType, Meta> = {
  PURCHASE: { label: "Purchase", tone: "success", description: "Stock received from a seller or supplier." },
  SALE: { label: "Sale", tone: "info", description: "Committed to an order (delta −q, reserved −q)." },
  RETURN: { label: "Return", tone: "warning", description: "Restocked from a cancellation, RTO or passed QC." },
  ADJUSTMENT: { label: "Adjustment", tone: "neutral" },
  CORRECTION: { label: "Correction", tone: "neutral" },
  DAMAGE: { label: "Damage", tone: "danger" },
  SEED: { label: "Opening balance", tone: "neutral" },
  RESERVE: { label: "Reserve", tone: "info", description: "Held for a PENDING order (reserved +q)." },
  RELEASE: { label: "Release", tone: "neutral", description: "Reservation dropped (reserved −q)." },
  TRANSFER: { label: "Transfer", tone: "neutral" },
};

/** Movement types an operator may record by hand; the rest are system-only. */
export const MANUAL_STOCK_MOVEMENT_TYPES: readonly StockMovementType[] = [
  "PURCHASE",
  "ADJUSTMENT",
  "CORRECTION",
  "DAMAGE",
  "TRANSFER",
];

export const STOCK_STATES = ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK", "BACKORDER"] as const;
export type StockState = (typeof STOCK_STATES)[number];
export const stockStateSchema = z.enum(STOCK_STATES);

export const STOCK_STATE_META: Record<StockState, Meta> = {
  IN_STOCK: { label: "In stock", tone: "success" },
  LOW_STOCK: { label: "Low stock", tone: "warning" },
  OUT_OF_STOCK: { label: "Out of stock", tone: "danger" },
  BACKORDER: { label: "Backorder", tone: "info", description: "Nothing available, but backorders are accepted." },
};

/** The stockState written by applyStockMovement() and threshold edits (F7). */
export function stockState(
  available: number,
  threshold: number,
  allowBackorder = false,
): StockState {
  if (available <= 0) return allowBackorder ? "BACKORDER" : "OUT_OF_STOCK";
  if (available <= threshold) return "LOW_STOCK";
  return "IN_STOCK";
}

// ===========================================================================
// CUSTOMERS
// ===========================================================================

export const CUSTOMER_STATUSES = ["ACTIVE", "BLOCKED"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
export const customerStatusSchema = z.enum(CUSTOMER_STATUSES);

export const CUSTOMER_STATUS_META: Record<CustomerStatus, Meta> = {
  ACTIVE: { label: "Active", tone: "success" },
  BLOCKED: { label: "Blocked", tone: "danger" },
};

export const ADDRESS_TYPES = ["SHIPPING", "BILLING", "BOTH"] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];
export const addressTypeSchema = z.enum(ADDRESS_TYPES);

export const CART_STATUSES = ["ACTIVE", "CONVERTED", "ABANDONED"] as const;
export type CartStatus = (typeof CART_STATUSES)[number];
export const cartStatusSchema = z.enum(CART_STATUSES);

export const CART_STATUS_META: Record<CartStatus, Meta> = {
  ACTIVE: { label: "Active", tone: "info" },
  CONVERTED: { label: "Converted", tone: "success" },
  ABANDONED: { label: "Abandoned", tone: "neutral" },
};

/** Derived customer segments (C7); thresholds come from settings. */
export const CUSTOMER_SEGMENTS = ["NEW", "RETURNING", "VIP", "HIGH_VALUE", "INACTIVE"] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];
export const customerSegmentSchema = z.enum(CUSTOMER_SEGMENTS);

export const CUSTOMER_SEGMENT_META: Record<CustomerSegment, Meta> = {
  NEW: { label: "New", tone: "info" },
  RETURNING: { label: "Returning", tone: "success" },
  VIP: { label: "VIP", tone: "brand" },
  HIGH_VALUE: { label: "High value", tone: "brand" },
  INACTIVE: { label: "Inactive", tone: "neutral" },
};

// ===========================================================================
// REVIEWS, INQUIRIES, NEWSLETTER
// ===========================================================================

export const REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const reviewStatusSchema = z.enum(REVIEW_STATUSES);

export const REVIEW_STATUS_META: Record<ReviewStatus, Meta> = {
  PENDING: { label: "Pending", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};

export const INQUIRY_STATUSES = ["NEW", "OPEN", "REPLIED", "RESOLVED", "SPAM"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];
export const inquiryStatusSchema = z.enum(INQUIRY_STATUSES);

export const INQUIRY_STATUS_META: Record<InquiryStatus, Meta> = {
  NEW: { label: "New", tone: "brand" },
  OPEN: { label: "Open", tone: "info" },
  REPLIED: { label: "Replied", tone: "success" },
  RESOLVED: { label: "Resolved", tone: "neutral" },
  SPAM: { label: "Spam", tone: "danger" },
};

export const INQUIRY_TYPES = ["GENERAL", "ORDER", "SELLER", "COMPLAINT", "PARTNERSHIP", "OTHER"] as const;
export type InquiryType = (typeof INQUIRY_TYPES)[number];
export const inquiryTypeSchema = z.enum(INQUIRY_TYPES);

export const INQUIRY_TYPE_META: Record<InquiryType, Meta> = {
  GENERAL: { label: "General", tone: "neutral" },
  ORDER: { label: "Order", tone: "info" },
  SELLER: { label: "Seller", tone: "brand" },
  COMPLAINT: { label: "Complaint", tone: "danger" },
  PARTNERSHIP: { label: "Partnership", tone: "info" },
  OTHER: { label: "Other", tone: "neutral" },
};

export const INQUIRY_PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export type InquiryPriority = (typeof INQUIRY_PRIORITIES)[number];
export const inquiryPrioritySchema = z.enum(INQUIRY_PRIORITIES);

export const INQUIRY_PRIORITY_META: Record<InquiryPriority, Meta> = {
  LOW: { label: "Low", tone: "neutral" },
  NORMAL: { label: "Normal", tone: "info" },
  HIGH: { label: "High", tone: "danger" },
};

export const NEWSLETTER_STATUSES = ["SUBSCRIBED", "UNSUBSCRIBED", "BOUNCED"] as const;
export type NewsletterStatus = (typeof NEWSLETTER_STATUSES)[number];
export const newsletterStatusSchema = z.enum(NEWSLETTER_STATUSES);

export const NEWSLETTER_STATUS_META: Record<NewsletterStatus, Meta> = {
  SUBSCRIBED: { label: "Subscribed", tone: "success" },
  UNSUBSCRIBED: { label: "Unsubscribed", tone: "neutral" },
  BOUNCED: { label: "Bounced", tone: "danger" },
};

// ===========================================================================
// CONTENT
// ===========================================================================

export const BLOG_STATUSES = ["DRAFT", "PUBLISHED", "SCHEDULED", "ARCHIVED"] as const;
export type BlogStatus = (typeof BLOG_STATUSES)[number];
export const blogStatusSchema = z.enum(BLOG_STATUSES);

export const BLOG_STATUS_META: Record<BlogStatus, Meta> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  PUBLISHED: { label: "Published", tone: "success" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  ARCHIVED: { label: "Archived", tone: "warning" },
};

export const CMS_PAGE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type CmsPageStatus = (typeof CMS_PAGE_STATUSES)[number];
export const cmsPageStatusSchema = z.enum(CMS_PAGE_STATUSES);

export const CMS_PAGE_STATUS_META: Record<CmsPageStatus, Meta> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  PUBLISHED: { label: "Published", tone: "success" },
  ARCHIVED: { label: "Archived", tone: "warning" },
};

export const CMS_PAGE_TEMPLATES = ["DEFAULT", "ABOUT", "CONTACT", "FAQ", "POLICY"] as const;
export type CmsPageTemplate = (typeof CMS_PAGE_TEMPLATES)[number];
export const cmsPageTemplateSchema = z.enum(CMS_PAGE_TEMPLATES);

export const CMS_PAGE_TEMPLATE_META: Record<CmsPageTemplate, Meta> = {
  DEFAULT: { label: "Default", tone: "neutral" },
  ABOUT: { label: "About", tone: "info" },
  CONTACT: { label: "Contact", tone: "info", description: "Renders the contact form under the content." },
  FAQ: { label: "FAQ", tone: "info", description: "Renders the FAQ groups under the content." },
  POLICY: { label: "Policy", tone: "neutral" },
};

/** System pages (E5): slug locked, cannot be deleted. */
export const SYSTEM_CMS_PAGE_SLUGS = [
  "about-us",
  "contact-us",
  "faqs",
  "privacy-policy",
  "terms-and-conditions",
  "return-policy",
  "shipping-policy",
  "seller-terms",
  "seller-guidelines",
] as const;
export type SystemCmsPageSlug = (typeof SYSTEM_CMS_PAGE_SLUGS)[number];

export const NAVIGATION_MENU_SLUGS = ["main", "footer-1", "footer-2", "footer-3", "mobile"] as const;
export type NavigationMenuSlug = (typeof NAVIGATION_MENU_SLUGS)[number];
export const navigationMenuSlugSchema = z.enum(NAVIGATION_MENU_SLUGS);

export const NAVIGATION_ITEM_TYPES = ["CATEGORY", "PRODUCT", "PAGE", "BLOG", "URL", "HOME"] as const;
export type NavigationItemType = (typeof NAVIGATION_ITEM_TYPES)[number];
export const navigationItemTypeSchema = z.enum(NAVIGATION_ITEM_TYPES);

export const NAVIGATION_ITEM_TYPE_META: Record<NavigationItemType, Meta> = {
  CATEGORY: { label: "Category", tone: "info" },
  PRODUCT: { label: "Product", tone: "info" },
  PAGE: { label: "Page", tone: "info" },
  BLOG: { label: "Blog", tone: "info" },
  URL: { label: "URL", tone: "neutral" },
  HOME: { label: "Home", tone: "neutral" },
};

/** Homepage section registry types (E1). */
export const CONTENT_SECTION_TYPES = [
  "hero_slider",
  "promo_banners",
  "featured_categories",
  "new_arrivals",
  "best_sellers",
  "trending",
  "featured_products",
  "product_collection",
  "seller_highlights",
  "testimonials",
  "product_reviews",
  "promo_section",
  "newsletter",
  "trust_badges",
  "announcement_bar",
  "rich_text",
  "footer",
] as const;
export type ContentSectionType = (typeof CONTENT_SECTION_TYPES)[number];
export const contentSectionTypeSchema = z.enum(CONTENT_SECTION_TYPES);

// ===========================================================================
// MEDIA
// ===========================================================================

export const MEDIA_KINDS = ["image", "video", "document"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const mediaKindSchema = z.enum(MEDIA_KINDS);

export const MEDIA_KIND_META: Record<MediaKind, Meta> = {
  image: { label: "Image", tone: "info" },
  video: { label: "Video", tone: "brand" },
  document: { label: "Document", tone: "neutral" },
};

export const MEDIA_VISIBILITIES = ["PUBLIC", "PRIVATE"] as const;
export type MediaVisibility = (typeof MEDIA_VISIBILITIES)[number];
export const mediaVisibilitySchema = z.enum(MEDIA_VISIBILITIES);

export const MEDIA_VISIBILITY_META: Record<MediaVisibility, Meta> = {
  PUBLIC: { label: "Public", tone: "success", description: "Served by /media/[...key]." },
  PRIVATE: { label: "Private", tone: "warning", description: "Only via /api/admin/media/:id/file, audited." },
};

export const STORAGE_PROVIDERS = ["local", "s3", "external"] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];
export const storageProviderSchema = z.enum(STORAGE_PROVIDERS);

// ===========================================================================
// NOTIFICATIONS, EMAIL, JOBS
// ===========================================================================

export const NOTIFICATION_TYPES = [
  "NEW_ORDER",
  "ORDER_CANCELLED",
  "PAYMENT_FAILED",
  "NEW_SELLER",
  "SELLER_APPROVAL_REQUIRED",
  "LOW_STOCK",
  "OUT_OF_STOCK",
  "RETURN_REQUESTED",
  "REFUND_REQUESTED",
  "NEW_REVIEW",
  "NEW_INQUIRY",
  "PAYOUT_DUE",
  "CONTENT_EXPIRING",
  "SYSTEM",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

/**
 * Label, default tone and the permission a user must hold to receive the
 * notification (E3). SYSTEM goes to everyone.
 */
export const NOTIFICATION_TYPE_META: Record<NotificationType, Meta & { permission: string | null }> = {
  NEW_ORDER: { label: "New order", tone: "success", permission: "orders.view" },
  ORDER_CANCELLED: { label: "Order cancelled", tone: "danger", permission: "orders.view" },
  PAYMENT_FAILED: { label: "Payment failed", tone: "danger", permission: "payments.view" },
  NEW_SELLER: { label: "New seller", tone: "info", permission: "sellers.view" },
  SELLER_APPROVAL_REQUIRED: { label: "Seller approval required", tone: "warning", permission: "sellers.approve" },
  LOW_STOCK: { label: "Low stock", tone: "warning", permission: "inventory.view" },
  OUT_OF_STOCK: { label: "Out of stock", tone: "danger", permission: "inventory.view" },
  RETURN_REQUESTED: { label: "Return requested", tone: "warning", permission: "returns.view" },
  REFUND_REQUESTED: { label: "Refund requested", tone: "warning", permission: "refunds.view" },
  NEW_REVIEW: { label: "New review", tone: "info", permission: "reviews.moderate" },
  NEW_INQUIRY: { label: "New inquiry", tone: "info", permission: "inquiries.view" },
  PAYOUT_DUE: { label: "Payout due", tone: "info", permission: "payouts.approve" },
  CONTENT_EXPIRING: { label: "Content expiring", tone: "warning", permission: "homepage.view" },
  SYSTEM: { label: "System", tone: "neutral", permission: null },
};

export const NOTIFICATION_SEVERITIES = ["info", "warning", "critical"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];
export const notificationSeveritySchema = z.enum(NOTIFICATION_SEVERITIES);

export const NOTIFICATION_SEVERITY_META: Record<NotificationSeverity, Meta> = {
  info: { label: "Info", tone: "info" },
  warning: { label: "Warning", tone: "warning" },
  critical: { label: "Critical", tone: "danger" },
};

/** EmailTemplate.key values (§4.9 + E3). */
export const EMAIL_TEMPLATE_KEYS = [
  "welcome",
  "order_confirmation",
  "payment_confirmation",
  "order_shipped",
  "order_delivered",
  "order_cancelled",
  "return_approved",
  "refund_processed",
  "seller_registration_received",
  "seller_approved",
  "seller_rejected",
  "seller_password_reset",
  "customer_password_reset",
  "password_reset",
  "admin_password_reset",
  "admin_invite",
  "contact_ack",
  "newsletter_welcome",
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];
export const emailTemplateKeySchema = z.enum(EMAIL_TEMPLATE_KEYS);

export const EMAIL_OUTBOX_STATUSES = ["QUEUED", "SENDING", "SENT", "FAILED", "CANCELLED"] as const;
export type EmailOutboxStatus = (typeof EMAIL_OUTBOX_STATUSES)[number];
export const emailOutboxStatusSchema = z.enum(EMAIL_OUTBOX_STATUSES);

export const EMAIL_OUTBOX_STATUS_META: Record<EmailOutboxStatus, Meta> = {
  QUEUED: { label: "Queued", tone: "info" },
  SENDING: { label: "Sending", tone: "brand" },
  SENT: { label: "Sent", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export const EMAIL_TRANSPORTS = ["smtp", "console"] as const;
export type EmailTransport = (typeof EMAIL_TRANSPORTS)[number];
export const emailTransportSchema = z.enum(EMAIL_TRANSPORTS);

export const JOB_STATUSES = ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const jobStatusSchema = z.enum(JOB_STATUSES);

export const JOB_STATUS_META: Record<JobStatus, Meta> = {
  PENDING: { label: "Pending", tone: "info" },
  RUNNING: { label: "Running", tone: "brand" },
  COMPLETED: { label: "Completed", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

/** Job.type values (§10 + amendments). */
export const JOB_TYPES = [
  "email.send",
  "earnings.mark_available",
  "stock.check_low",
  "report.export",
  "promotions.expire",
  "content.expire",
  "payout.generate",
  "pricing.refresh",
  "catalog.recompute_subtree",
  "orders.expire_unpaid",
  "orders.cancel_unconfirmed_cod",
  "uploads.purge_pending",
  "rate_limit.purge",
  "email.retry_failed",
  "orders.after_payment",
  "catalog.recompute_facets",
] as const;
export type JobType = (typeof JOB_TYPES)[number];
export const jobTypeSchema = z.enum(JOB_TYPES);

// ===========================================================================
// REPORTS & SETTINGS
// ===========================================================================

/** Report keys (E4). Each report also declares `requires` permissions (D14). */
export const REPORT_KEYS = [
  "sales",
  "orders",
  "products",
  "categories",
  "sellers",
  "customers",
  "revenue",
  "commissions",
  "payouts",
  "inventory",
  "refunds",
  "coupons",
  "tax",
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];
export const reportKeySchema = z.enum(REPORT_KEYS);

export const REPORT_META: Record<ReportKey, { label: string; description: string; requires: readonly string[] }> = {
  sales: { label: "Sales", description: "Revenue and units by day.", requires: ["orders.view"] },
  orders: { label: "Orders", description: "Order counts by status and source.", requires: ["orders.view"] },
  products: { label: "Products", description: "Units and revenue per product.", requires: ["products.view"] },
  categories: { label: "Categories", description: "Revenue per category, rolled up the tree.", requires: ["categories.view"] },
  sellers: { label: "Sellers", description: "Gross sales, commission and payables per seller.", requires: ["sellers.view"] },
  customers: { label: "Customers", description: "Acquisition and segments.", requires: ["customers.view"] },
  revenue: { label: "Revenue", description: "Revenue net of refunds, shipping and COD fees.", requires: ["orders.view"] },
  commissions: { label: "Commissions", description: "Commission earned by rule and scope.", requires: ["commissions.view"] },
  payouts: { label: "Payouts", description: "Statements by status and period.", requires: ["payouts.view"] },
  inventory: { label: "Inventory", description: "Stock levels, valuation and low-stock items.", requires: ["inventory.view"] },
  refunds: { label: "Refunds", description: "Refund volume by method and reason.", requires: ["refunds.view"] },
  coupons: { label: "Coupons", description: "Usage and discount granted per coupon.", requires: ["coupons.view"] },
  tax: { label: "Tax", description: "Taxable value and tax by HSN and rate.", requires: ["orders.view"] },
};

export const EXPORT_FORMATS = ["csv", "xlsx", "print"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const exportFormatSchema = z.enum(EXPORT_FORMATS);

export const SETTING_TYPES = ["string", "number", "boolean", "json", "money", "secret"] as const;
export type SettingType = (typeof SETTING_TYPES)[number];
export const settingTypeSchema = z.enum(SETTING_TYPES);

export const SETTING_TYPE_META: Record<SettingType, Meta> = {
  string: { label: "Text", tone: "neutral" },
  number: { label: "Number", tone: "neutral" },
  boolean: { label: "On / off", tone: "neutral" },
  json: { label: "JSON", tone: "neutral" },
  money: { label: "Money (paise)", tone: "neutral" },
  secret: { label: "Secret", tone: "warning", description: "Encrypted at rest; never exposed publicly." },
};
