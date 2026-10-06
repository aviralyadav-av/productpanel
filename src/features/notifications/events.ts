import type {
  EmailTemplateKey,
  NotificationSeverity,
  NotificationType,
} from "@/lib/enums";
import type { EmailVars } from "@/features/email/render";

/**
 * The event → notification → email matrix (blueprint E3) AS DATA.
 *
 * Every business event the platform reacts to is one row here. A row says
 * which admin notification it raises (and who may receive it), which customer/
 * seller email template it sends, and how to build the title, body, link and
 * template variables from the event payload. `emitEvent()` in ./service.ts
 * reads this table; nothing else in the codebase hardcodes "send the shipped
 * email" - which is what lets an operator disable a template, or a future
 * event gain an email, without touching the order flow.
 *
 * `EmailTemplate.variables` is seeded from the `emailVars` keys documented
 * here (prisma/seed/modules/templates.ts mirrors this list), so the template
 * editor can warn about a `{{var}}` no event supplies.
 */

export type EventRecipient = { email: string; name?: string | null };

/** Payload shapes, one per event key. Money arrives pre-formatted (formatPaise). */
export type NotificationEventPayloads = {
  "order.created": {
    orderId: string;
    orderNumber: string;
    totalText: string;
    paymentMethod: string;
    itemCount: number;
    customerName: string;
    customerEmail: string;
    orderUrl: string;
    /** Pre-built `<table>` of lines; inserted raw (name ends in _html). */
    orderItemsHtml: string;
  };
  "payment.succeeded": {
    orderId: string;
    orderNumber: string;
    customerName: string;
    customerEmail: string;
    amountText: string;
    transactionId: string;
    orderUrl: string;
  };
  "payment.failed": {
    orderId: string;
    orderNumber: string;
    amountText: string;
    provider: string;
    failureMessage?: string | null;
  };
  "shipment.shipped": {
    orderId: string;
    orderNumber: string;
    shipmentId: string;
    customerName: string;
    customerEmail: string;
    carrier: string;
    trackingNumber: string;
    trackingUrl: string;
    eta: string;
    orderUrl: string;
  };
  "shipment.delivered": {
    orderId: string;
    orderNumber: string;
    shipmentId: string;
    customerName: string;
    customerEmail: string;
    orderUrl: string;
    reviewUrl: string;
  };
  "order.cancelled": {
    orderId: string;
    orderNumber: string;
    customerName: string;
    customerEmail: string;
    cancelReason: string;
    orderUrl: string;
    cancelledBy: "customer" | "admin" | "system";
  };
  "return.requested": {
    returnRequestId: string;
    rmaNumber: string;
    orderNumber: string;
    reason: string;
    quantity: number;
  };
  "return.approved": {
    returnRequestId: string;
    rmaNumber: string;
    orderId: string;
    orderNumber: string;
    customerName: string;
    customerEmail: string;
    pickupDate: string;
    orderUrl: string;
  };
  "refund.pending": {
    refundId: string;
    refundNumber: string;
    orderNumber: string;
    amountText: string;
    method: string;
  };
  "refund.completed": {
    refundId: string;
    refundNumber: string;
    orderId: string;
    orderNumber: string;
    customerName: string;
    customerEmail: string;
    amountText: string;
    method: string;
  };
  "seller.registered": {
    sellerId: string;
    sellerName: string;
    sellerEmail: string;
    city?: string | null;
  };
  "seller.approved": {
    sellerId: string;
    sellerName: string;
    sellerEmail: string;
    sellerUrl: string;
  };
  "seller.rejected": {
    sellerId: string;
    sellerName: string;
    sellerEmail: string;
    reason: string;
  };
  "stock.low": {
    variantId: string;
    productId: string;
    productTitle: string;
    variantName: string;
    sku?: string | null;
    available: number;
    threshold: number;
  };
  "stock.out": {
    variantId: string;
    productId: string;
    productTitle: string;
    variantName: string;
    sku?: string | null;
    available: number;
  };
  "review.created": {
    reviewId: string;
    productId?: string | null;
    productTitle: string;
    rating?: number | null;
    authorName: string;
  };
  "inquiry.created": {
    inquiryId: string;
    name: string;
    email: string;
    subject: string;
    type: string;
  };
  "payout.generated": {
    payoutId: string;
    payoutNumber: string;
    sellerId: string;
    sellerName: string;
    netText: string;
  };
  "customer.created": {
    customerId: string;
    customerName: string;
    customerEmail: string;
  };
  "admin.password_reset": {
    userId: string;
    name: string;
    email: string;
    resetUrl: string;
    expiresMinutes: number;
  };
  "admin.invite": {
    userId: string;
    name: string;
    email: string;
    inviterName: string;
    roleName: string;
    inviteUrl: string;
    expiresHours: number;
  };
  "newsletter.subscribed": {
    subscriberId: string;
    email: string;
    name?: string | null;
    unsubscribeUrl: string;
  };
  "seller.password_reset": {
    sellerId: string;
    sellerName: string;
    sellerEmail: string;
    resetUrl: string;
    expiresMinutes: number;
  };
  "customer.password_reset": {
    customerId: string;
    customerName: string;
    customerEmail: string;
    resetUrl: string;
    expiresMinutes: number;
  };
  "content.expiring": {
    sectionId: string;
    title: string;
    unpublishAt: string;
  };
};

export type NotificationEventKey = keyof NotificationEventPayloads;

export type NotificationEventDefinition<P> = {
  /** Admin in-app notification to raise; omit for customer-only events. */
  notificationType?: NotificationType;
  /**
   * Permission a user must hold to receive it. Defaults to
   * NOTIFICATION_TYPE_META[notificationType].permission; super-admins always
   * qualify.
   */
  permission?: string;
  severity: NotificationSeverity;
  /** Customer/seller email to queue, addressed to `recipient(payload)`. */
  emailTemplateKey?: EmailTemplateKey;
  recipient?: (payload: P) => EventRecipient | null;
  emailVars?: (payload: P) => EmailVars;
  title: (payload: P) => string;
  body?: (payload: P) => string | undefined;
  href?: (payload: P) => string | undefined;
  /** Drives Notification.entityType/entityId and the email dedupe key. */
  entity?: (payload: P) => { type: string; id: string } | undefined;
};

type Matrix = {
  [K in NotificationEventKey]: NotificationEventDefinition<NotificationEventPayloads[K]>;
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export const NOTIFICATION_EVENTS: Matrix = {
  "order.created": {
    notificationType: "NEW_ORDER",
    severity: "info",
    title: (p) => `New order ${p.orderNumber}`,
    body: (p) => `${plural(p.itemCount, "item")} · ${p.totalText} · ${p.paymentMethod} · ${p.customerName}`,
    href: (p) => `/admin/orders/${p.orderId}`,
    entity: (p) => ({ type: "Order", id: p.orderId }),
    emailTemplateKey: "order_confirmation",
    recipient: (p) => ({ email: p.customerEmail, name: p.customerName }),
    emailVars: (p) => ({
      customer_name: p.customerName,
      order_id: p.orderNumber,
      order_total: p.totalText,
      order_items_html: p.orderItemsHtml,
      order_url: p.orderUrl,
      payment_method: p.paymentMethod,
    }),
  },
  "payment.succeeded": {
    severity: "info",
    title: (p) => `Payment received for ${p.orderNumber}`,
    entity: (p) => ({ type: "Order", id: p.orderId }),
    emailTemplateKey: "payment_confirmation",
    recipient: (p) => ({ email: p.customerEmail, name: p.customerName }),
    emailVars: (p) => ({
      customer_name: p.customerName,
      order_id: p.orderNumber,
      amount: p.amountText,
      transaction_id: p.transactionId,
      order_url: p.orderUrl,
    }),
  },
  "payment.failed": {
    notificationType: "PAYMENT_FAILED",
    severity: "warning",
    title: (p) => `Payment failed on ${p.orderNumber}`,
    body: (p) => [p.amountText, p.provider, p.failureMessage].filter(Boolean).join(" · "),
    href: (p) => `/admin/orders/${p.orderId}`,
    entity: (p) => ({ type: "Order", id: p.orderId }),
  },
  "shipment.shipped": {
    severity: "info",
    title: (p) => `Order ${p.orderNumber} shipped`,
    entity: (p) => ({ type: "Shipment", id: p.shipmentId }),
    emailTemplateKey: "order_shipped",
    recipient: (p) => ({ email: p.customerEmail, name: p.customerName }),
    emailVars: (p) => ({
      customer_name: p.customerName,
      order_id: p.orderNumber,
      carrier: p.carrier,
      tracking_number: p.trackingNumber,
      tracking_url: p.trackingUrl,
      eta: p.eta,
      order_url: p.orderUrl,
    }),
  },
  "shipment.delivered": {
    severity: "info",
    title: (p) => `Order ${p.orderNumber} delivered`,
    entity: (p) => ({ type: "Shipment", id: p.shipmentId }),
    emailTemplateKey: "order_delivered",
    recipient: (p) => ({ email: p.customerEmail, name: p.customerName }),
    emailVars: (p) => ({
      customer_name: p.customerName,
      order_id: p.orderNumber,
      order_url: p.orderUrl,
      review_url: p.reviewUrl,
    }),
  },
  "order.cancelled": {
    notificationType: "ORDER_CANCELLED",
    severity: "warning",
    title: (p) => `Order ${p.orderNumber} cancelled`,
    body: (p) => `${p.cancelReason} (by ${p.cancelledBy})`,
    href: (p) => `/admin/orders/${p.orderId}`,
    entity: (p) => ({ type: "Order", id: p.orderId }),
    emailTemplateKey: "order_cancelled",
    recipient: (p) => ({ email: p.customerEmail, name: p.customerName }),
    emailVars: (p) => ({
      customer_name: p.customerName,
      order_id: p.orderNumber,
      cancel_reason: p.cancelReason,
      order_url: p.orderUrl,
    }),
  },
  "return.requested": {
    notificationType: "RETURN_REQUESTED",
    severity: "warning",
    title: (p) => `Return ${p.rmaNumber} requested on ${p.orderNumber}`,
    body: (p) => `${plural(p.quantity, "unit")} · ${p.reason}`,
    href: (p) => `/admin/returns/${p.returnRequestId}`,
    entity: (p) => ({ type: "ReturnRequest", id: p.returnRequestId }),
  },
  "return.approved": {
    severity: "info",
    title: (p) => `Return ${p.rmaNumber} approved`,
    entity: (p) => ({ type: "ReturnRequest", id: p.returnRequestId }),
    emailTemplateKey: "return_approved",
    recipient: (p) => ({ email: p.customerEmail, name: p.customerName }),
    emailVars: (p) => ({
      customer_name: p.customerName,
      order_id: p.orderNumber,
      rma_number: p.rmaNumber,
      pickup_date: p.pickupDate,
      order_url: p.orderUrl,
    }),
  },
  "refund.pending": {
    notificationType: "REFUND_REQUESTED",
    severity: "warning",
    title: (p) => `Refund ${p.refundNumber} awaiting approval`,
    body: (p) => `${p.amountText} on ${p.orderNumber} via ${p.method}`,
    href: (p) => `/admin/refunds/${p.refundId}`,
    entity: (p) => ({ type: "Refund", id: p.refundId }),
  },
  "refund.completed": {
    severity: "info",
    title: (p) => `Refund ${p.refundNumber} completed`,
    entity: (p) => ({ type: "Refund", id: p.refundId }),
    emailTemplateKey: "refund_processed",
    recipient: (p) => ({ email: p.customerEmail, name: p.customerName }),
    emailVars: (p) => ({
      customer_name: p.customerName,
      order_id: p.orderNumber,
      refund_amount: p.amountText,
      refund_method: p.method,
      refund_number: p.refundNumber,
    }),
  },
  "seller.registered": {
    // Raises NEW_SELLER; the service also raises SELLER_APPROVAL_REQUIRED for
    // the approvers (see emitEvent's companion list).
    notificationType: "NEW_SELLER",
    severity: "info",
    title: (p) => `New seller registration: ${p.sellerName}`,
    body: (p) => [p.sellerEmail, p.city].filter(Boolean).join(" · "),
    href: (p) => `/admin/sellers/${p.sellerId}`,
    entity: (p) => ({ type: "Seller", id: p.sellerId }),
    emailTemplateKey: "seller_registration_received",
    recipient: (p) => ({ email: p.sellerEmail, name: p.sellerName }),
    emailVars: (p) => ({ seller_name: p.sellerName }),
  },
  "seller.approved": {
    severity: "info",
    title: (p) => `Seller ${p.sellerName} approved`,
    entity: (p) => ({ type: "Seller", id: p.sellerId }),
    emailTemplateKey: "seller_approved",
    recipient: (p) => ({ email: p.sellerEmail, name: p.sellerName }),
    emailVars: (p) => ({ seller_name: p.sellerName, seller_url: p.sellerUrl }),
  },
  "seller.rejected": {
    severity: "info",
    title: (p) => `Seller ${p.sellerName} rejected`,
    entity: (p) => ({ type: "Seller", id: p.sellerId }),
    emailTemplateKey: "seller_rejected",
    recipient: (p) => ({ email: p.sellerEmail, name: p.sellerName }),
    emailVars: (p) => ({ seller_name: p.sellerName, reason: p.reason }),
  },
  "stock.low": {
    notificationType: "LOW_STOCK",
    severity: "warning",
    title: (p) => `Low stock: ${p.productTitle} (${p.variantName})`,
    body: (p) => `${p.available} available, threshold ${p.threshold}${p.sku ? ` · ${p.sku}` : ""}`,
    href: (p) => `/admin/inventory?q=${encodeURIComponent(p.sku ?? p.productTitle)}`,
    entity: (p) => ({ type: "ProductVariant", id: p.variantId }),
  },
  "stock.out": {
    notificationType: "OUT_OF_STOCK",
    severity: "critical",
    title: (p) => `Out of stock: ${p.productTitle} (${p.variantName})`,
    body: (p) => `${p.available} available${p.sku ? ` · ${p.sku}` : ""}`,
    href: (p) => `/admin/inventory?q=${encodeURIComponent(p.sku ?? p.productTitle)}`,
    entity: (p) => ({ type: "ProductVariant", id: p.variantId }),
  },
  "review.created": {
    notificationType: "NEW_REVIEW",
    severity: "info",
    title: (p) => `New review on ${p.productTitle}`,
    body: (p) => [p.rating ? `${p.rating}/5` : null, p.authorName].filter(Boolean).join(" · "),
    href: () => `/admin/reviews?status=PENDING`,
    entity: (p) => ({ type: "Review", id: p.reviewId }),
  },
  "inquiry.created": {
    notificationType: "NEW_INQUIRY",
    severity: "info",
    title: (p) => `New inquiry: ${p.subject}`,
    body: (p) => `${p.name} <${p.email}> · ${p.type}`,
    href: (p) => `/admin/inquiries/${p.inquiryId}`,
    entity: (p) => ({ type: "ContactInquiry", id: p.inquiryId }),
    emailTemplateKey: "contact_ack",
    recipient: (p) => ({ email: p.email, name: p.name }),
    emailVars: (p) => ({ name: p.name, subject: p.subject, ticket_id: p.inquiryId }),
  },
  "payout.generated": {
    notificationType: "PAYOUT_DUE",
    severity: "info",
    title: (p) => `Payout ${p.payoutNumber} ready for approval`,
    body: (p) => `${p.sellerName} · ${p.netText}`,
    href: (p) => `/admin/payouts/${p.payoutId}`,
    entity: (p) => ({ type: "SellerPayout", id: p.payoutId }),
  },
  "customer.created": {
    severity: "info",
    title: (p) => `Welcome ${p.customerName}`,
    entity: (p) => ({ type: "Customer", id: p.customerId }),
    emailTemplateKey: "welcome",
    recipient: (p) => ({ email: p.customerEmail, name: p.customerName }),
    emailVars: (p) => ({ customer_name: p.customerName }),
  },
  "admin.password_reset": {
    severity: "info",
    title: (p) => `Password reset for ${p.email}`,
    // No entity: every reset request must produce its own email, never dedupe.
    emailTemplateKey: "admin_password_reset",
    recipient: (p) => ({ email: p.email, name: p.name }),
    emailVars: (p) => ({
      name: p.name,
      reset_url: p.resetUrl,
      expires_minutes: p.expiresMinutes,
    }),
  },
  "admin.invite": {
    severity: "info",
    title: (p) => `Invitation for ${p.email}`,
    emailTemplateKey: "admin_invite",
    recipient: (p) => ({ email: p.email, name: p.name }),
    emailVars: (p) => ({
      name: p.name,
      inviter_name: p.inviterName,
      role_name: p.roleName,
      invite_url: p.inviteUrl,
      expires_hours: p.expiresHours,
    }),
  },
  "newsletter.subscribed": {
    severity: "info",
    title: (p) => `Newsletter subscription: ${p.email}`,
    entity: (p) => ({ type: "NewsletterSubscriber", id: p.subscriberId }),
    emailTemplateKey: "newsletter_welcome",
    recipient: (p) => ({ email: p.email, name: p.name }),
    emailVars: (p) => ({ name: p.name ?? "", unsubscribe_url: p.unsubscribeUrl }),
  },
  "seller.password_reset": {
    severity: "info",
    title: (p) => `Seller password reset for ${p.sellerEmail}`,
    emailTemplateKey: "seller_password_reset",
    recipient: (p) => ({ email: p.sellerEmail, name: p.sellerName }),
    emailVars: (p) => ({
      seller_name: p.sellerName,
      reset_url: p.resetUrl,
      expires_minutes: p.expiresMinutes,
    }),
  },
  "customer.password_reset": {
    severity: "info",
    title: (p) => `Customer password reset for ${p.customerEmail}`,
    emailTemplateKey: "customer_password_reset",
    recipient: (p) => ({ email: p.customerEmail, name: p.customerName }),
    emailVars: (p) => ({
      customer_name: p.customerName,
      reset_url: p.resetUrl,
      expires_minutes: p.expiresMinutes,
    }),
  },
  "content.expiring": {
    notificationType: "CONTENT_EXPIRING",
    severity: "warning",
    title: (p) => `"${p.title}" unpublishes soon`,
    body: (p) => `Scheduled to leave the homepage at ${p.unpublishAt}`,
    href: () => `/admin/homepage`,
    entity: (p) => ({ type: "ContentSection", id: p.sectionId }),
  },
};

/**
 * Events that raise a SECOND admin notification type to a different audience.
 * A new seller informs sellers.view (NEW_SELLER) and asks sellers.approve to
 * act (SELLER_APPROVAL_REQUIRED); one row cannot express two permissions.
 */
export const COMPANION_NOTIFICATIONS: Partial<
  Record<NotificationEventKey, { notificationType: NotificationType; severity: NotificationSeverity }>
> = {
  "seller.registered": { notificationType: "SELLER_APPROVAL_REQUIRED", severity: "warning" },
};

export const NOTIFICATION_EVENT_KEYS = Object.keys(NOTIFICATION_EVENTS) as NotificationEventKey[];

/** Keys of the vars an event supplies to its template - what the seed writes to EmailTemplate.variables. */
export function eventEmailVariableNames(key: NotificationEventKey): string[] {
  const definition = NOTIFICATION_EVENTS[key] as NotificationEventDefinition<unknown>;
  if (!definition.emailVars) return [];
  // Probe with a proxy that returns "" for every property so the var builder
  // runs without a real payload.
  const probe = new Proxy({}, { get: () => "" }) as never;
  return Object.keys(definition.emailVars(probe));
}
