/**
 * The schema stores these as plain String columns so it runs unchanged on both
 * SQLite and Postgres. This file is the single source of truth for the allowed
 * values, the display labels, and the badge tone each one maps to.
 *
 * Anything that writes one of these columns must validate through the Zod
 * schema here first.
 */
import { z } from "zod";

export type BadgeTone =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info";

// ---------------------------------------------------------------------------
// Roles - exactly two, permanently.
// ---------------------------------------------------------------------------

export const ROLES = ["ADMIN", "USER"] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);

// ---------------------------------------------------------------------------
// Product status
// ---------------------------------------------------------------------------

export const PRODUCT_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export const productStatusSchema = z.enum(PRODUCT_STATUSES);

export const PRODUCT_STATUS_META: Record<
  ProductStatus,
  { label: string; tone: BadgeTone; description: string }
> = {
  DRAFT: {
    label: "Draft",
    tone: "neutral",
    description: "Not visible on the storefront.",
  },
  PUBLISHED: {
    label: "Published",
    tone: "success",
    description: "Live and purchasable.",
  },
  ARCHIVED: {
    label: "Archived",
    tone: "warning",
    description: "Hidden, but history and orders are preserved.",
  },
};

// ---------------------------------------------------------------------------
// Order status
//
// The storefront today only ever writes the string "ORDER PLACED". PLACED is
// its equivalent, and the public serializer maps back to the display string so
// OrderReceipt.jsx and MyOrders.jsx keep rendering unchanged after cutover.
// ---------------------------------------------------------------------------

export const ORDER_STATUSES = [
  "PLACED",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const orderStatusSchema = z.enum(ORDER_STATUSES);

export const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; tone: BadgeTone; storefrontLabel: string }
> = {
  PLACED: { label: "Placed", tone: "info", storefrontLabel: "ORDER PLACED" },
  CONFIRMED: {
    label: "Confirmed",
    tone: "info",
    storefrontLabel: "ORDER CONFIRMED",
  },
  PROCESSING: {
    label: "Processing",
    tone: "brand",
    storefrontLabel: "PROCESSING",
  },
  SHIPPED: { label: "Shipped", tone: "brand", storefrontLabel: "SHIPPED" },
  DELIVERED: {
    label: "Delivered",
    tone: "success",
    storefrontLabel: "DELIVERED",
  },
  CANCELLED: {
    label: "Cancelled",
    tone: "danger",
    storefrontLabel: "CANCELLED",
  },
  RETURNED: { label: "Returned", tone: "warning", storefrontLabel: "RETURNED" },
};

/**
 * The order state machine. A transition not listed here is not reachable from
 * the UI and is rejected by the server.
 *
 * Deliberately absent: OUT_FOR_DELIVERY (needs a courier webhook this store
 * does not have) and any automatic transition (there is no payment gateway to
 * trigger one).
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PLACED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "RETURNED"],
  DELIVERED: ["RETURNED"],
  CANCELLED: [],
  RETURNED: [],
};

/** Terminal states restock inventory and accept no further transitions. */
export const TERMINAL_ORDER_STATUSES: OrderStatus[] = ["CANCELLED", "RETURNED"];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Payment
//
// There is no payment gateway integrated anywhere in this project. PAID is a
// bookkeeping fact an operator records by hand, and REFUNDED is a manual note,
// not an API call.
// ---------------------------------------------------------------------------

export const PAYMENT_STATUSES = [
  "PENDING",
  "PAID",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);

export const PAYMENT_STATUS_META: Record<
  PaymentStatus,
  { label: string; tone: BadgeTone }
> = {
  PENDING: { label: "Pending", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  PARTIALLY_REFUNDED: { label: "Part refunded", tone: "neutral" },
};

export const PAYMENT_METHODS = ["COD", "ONLINE"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

export const ORDER_SOURCES = ["STOREFRONT", "MANUAL"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export const STOCK_MOVEMENT_TYPES = [
  "PURCHASE",
  "SALE",
  "RETURN",
  "ADJUSTMENT",
  "CORRECTION",
  "DAMAGE",
  "SEED",
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
export const stockMovementTypeSchema = z.enum(STOCK_MOVEMENT_TYPES);

export const STOCK_MOVEMENT_META: Record<
  StockMovementType,
  { label: string; tone: BadgeTone }
> = {
  PURCHASE: { label: "Purchase", tone: "success" },
  SALE: { label: "Sale", tone: "info" },
  RETURN: { label: "Return", tone: "warning" },
  ADJUSTMENT: { label: "Adjustment", tone: "neutral" },
  CORRECTION: { label: "Correction", tone: "neutral" },
  DAMAGE: { label: "Damage", tone: "danger" },
  SEED: { label: "Initial", tone: "neutral" },
};

export type StockState = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export const STOCK_STATE_META: Record<
  StockState,
  { label: string; tone: BadgeTone }
> = {
  IN_STOCK: { label: "In stock", tone: "success" },
  LOW_STOCK: { label: "Low stock", tone: "warning" },
  OUT_OF_STOCK: { label: "Out of stock", tone: "danger" },
};

export function stockState(available: number, threshold: number): StockState {
  if (available <= 0) return "OUT_OF_STOCK";
  if (available <= threshold) return "LOW_STOCK";
  return "IN_STOCK";
}

// ---------------------------------------------------------------------------
// Reviews, customers, content
// ---------------------------------------------------------------------------

export const REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const reviewStatusSchema = z.enum(REVIEW_STATUSES);

export const REVIEW_STATUS_META: Record<
  ReviewStatus,
  { label: string; tone: BadgeTone }
> = {
  PENDING: { label: "Pending", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};

export const CUSTOMER_STATUSES = ["ACTIVE", "BLOCKED"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const CUSTOMER_STATUS_META: Record<
  CustomerStatus,
  { label: string; tone: BadgeTone }
> = {
  ACTIVE: { label: "Active", tone: "success" },
  BLOCKED: { label: "Blocked", tone: "danger" },
};

export const CMS_PAGE_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export type CmsPageStatus = (typeof CMS_PAGE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const NOTIFICATION_SEVERITIES = [
  "info",
  "warning",
  "critical",
] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_TYPES = [
  "NEW_ORDER",
  "LOW_STOCK",
  "OUT_OF_STOCK",
  "NEW_REVIEW",
  "ORDER_CANCELLED",
  "CONTENT_EXPIRING",
  "SYSTEM",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
