import { constantTimeEqual, hashToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { paiseToRupees } from "@/lib/money";

/**
 * The public face of an order (blueprint §5.3, §14.D1, D11).
 *
 * `getPublicOrder` is the ONLY place an order is shaped for the customer
 * website, and it builds the object field by field rather than spreading a
 * Prisma row: a column added to Order later must be opted in here, not leaked
 * by accident. Money is rupees (A10). Internal notes, the customer id, the IP
 * the order came from, commission and payable figures never appear.
 *
 * The token is compared in constant time against the stored hash, and an
 * order whose token does not match is reported exactly as an unknown order
 * number - so the endpoint cannot be used to discover which numbers exist.
 */

export type PublicOrderItem = {
  title: string;
  variant: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  customization: Array<{ label: string; value: string }>;
};

export type PublicOrder = {
  number: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  placedAt: Date;
  items: PublicOrderItem[];
  totals: {
    subtotal: number;
    discount: number;
    couponDiscount: number;
    shipping: number;
    codFee: number;
    tax: number;
    total: number;
    refunded: number;
  };
  couponCode: string | null;
  shippingAddress: {
    fullName: string;
    line1: string;
    line2: string | null;
    landmark: string | null;
    city: string;
    state: string;
    pinCode: string;
    country: string;
  } | null;
  shipments: Array<{
    carrier: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    status: string;
    shippedAt: Date | null;
    deliveredAt: Date | null;
    estimatedDeliveryAt: Date | null;
    events: Array<{ status: string; location: string | null; message: string | null; at: Date }>;
  }>;
  events: Array<{ type: string; message: string; at: Date }>;
};

type CustomizationEntry = { label?: unknown; value?: unknown };

/** Only the text answers travel: file URLs are PRIVATE media (D6). */
function publicCustomization(raw: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ label: string; value: string }> = [];
  for (const entry of raw as CustomizationEntry[]) {
    if (!entry || typeof entry !== "object") continue;
    const label = typeof entry.label === "string" ? entry.label : null;
    const value = typeof entry.value === "string" ? entry.value : null;
    if (label && value) out.push({ label, value });
  }
  return out;
}

export type PublicOrderRecord = { id: string; status: string; paymentMethod: string; paymentStatus: string; totalPaise: number };

/**
 * Resolve an order from its number + plaintext token. Returns null for an
 * unknown number AND for a wrong token: the caller turns both into the same
 * 404 (D1).
 */
export async function resolveOrderByToken(orderNumber: string, token: string | null): Promise<PublicOrderRecord | null> {
  if (!token) return null;
  const order = await db.order.findUnique({
    where: { orderNumber },
    select: { id: true, status: true, paymentMethod: true, paymentStatus: true, totalPaise: true, accessTokenHash: true },
  });
  if (!order?.accessTokenHash) return null;
  if (!constantTimeEqual(order.accessTokenHash, hashToken(token))) return null;
  return { id: order.id, status: order.status, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus, totalPaise: order.totalPaise };
}

export async function getPublicOrder(orderId: string): Promise<PublicOrder | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      orderNumber: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      placedAt: true,
      subtotalPaise: true,
      discountPaise: true,
      couponDiscountPaise: true,
      couponCode: true,
      shippingPaise: true,
      codFeePaise: true,
      taxPaise: true,
      totalPaise: true,
      refundedPaise: true,
      addresses: {
        where: { type: "SHIPPING" },
        take: 1,
        select: { fullName: true, line1: true, line2: true, landmark: true, city: true, state: true, pinCode: true, country: true },
      },
      items: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { id: "asc" },
        select: { titleSnapshot: true, variantSnapshot: true, quantity: true, unitPricePaise: true, customizationPaise: true, lineTotalPaise: true, customization: true },
      },
      shipments: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { createdAt: "asc" },
        select: {
          carrierName: true,
          trackingNumber: true,
          trackingUrl: true,
          status: true,
          shippedAt: true,
          deliveredAt: true,
          estimatedDeliveryAt: true,
          events: { orderBy: { occurredAt: "asc" }, select: { status: true, location: true, message: true, occurredAt: true } },
        },
      },
      events: {
        where: { isInternal: false },
        orderBy: { createdAt: "asc" },
        take: 100,
        select: { type: true, message: true, createdAt: true },
      },
    },
  });
  if (!order) return null;

  const address = order.addresses[0] ?? null;

  return {
    number: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    placedAt: order.placedAt,
    items: order.items.map((item) => ({
      title: item.titleSnapshot,
      variant: item.variantSnapshot,
      quantity: item.quantity,
      unitPrice: paiseToRupees(item.unitPricePaise + item.customizationPaise),
      lineTotal: paiseToRupees(item.lineTotalPaise),
      customization: publicCustomization(item.customization),
    })),
    totals: {
      subtotal: paiseToRupees(order.subtotalPaise),
      discount: paiseToRupees(order.discountPaise),
      couponDiscount: paiseToRupees(order.couponDiscountPaise),
      shipping: paiseToRupees(order.shippingPaise),
      codFee: paiseToRupees(order.codFeePaise),
      tax: paiseToRupees(order.taxPaise),
      total: paiseToRupees(order.totalPaise),
      refunded: paiseToRupees(order.refundedPaise),
    },
    couponCode: order.couponCode,
    shippingAddress: address,
    shipments: order.shipments.map((shipment) => ({
      carrier: shipment.carrierName,
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
      status: shipment.status,
      shippedAt: shipment.shippedAt,
      deliveredAt: shipment.deliveredAt,
      estimatedDeliveryAt: shipment.estimatedDeliveryAt,
      events: shipment.events.map((event) => ({ status: event.status, location: event.location, message: event.message, at: event.occurredAt })),
    })),
    events: order.events.map((event) => ({ type: event.type, message: event.message, at: event.createdAt })),
  };
}
