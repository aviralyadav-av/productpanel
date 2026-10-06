import "server-only";

import { db } from "@/lib/db";
import { readSettingStrings } from "@/features/finance/settings-reader";
import type { OrderCustomizationEntry, OrderDetailItem, OrderDetailShipment } from "./detail-types";

import { summariseSellerSplit, type SellerSplit } from "./pricing";

export type * from "./detail-types";

/**
 * Everything /admin/orders/[id] and /[id]/invoice need, in two queries.
 *
 * The detail page is the one screen where an operator answers a customer on
 * the phone, so it loads the whole story at once - lines with their frozen
 * customisation answers, payments, shipments and their events, returns,
 * refunds, the money split per seller, the timeline and the audit trail -
 * rather than lazy-loading tabs the operator would have to click through
 * while the customer waits.
 */

export type OrderDetail = Awaited<ReturnType<typeof getOrderDetail>>;

/** Shaped once so the page, the REST detail endpoint and the invoice agree. */
export async function getOrderDetail(id: string) {
  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      fulfillmentStatus: true,
      returnStatus: true,
      source: true,
      currency: true,
      subtotalPaise: true,
      discountPaise: true,
      couponDiscountPaise: true,
      shippingPaise: true,
      codFeePaise: true,
      taxPaise: true,
      totalPaise: true,
      refundedPaise: true,
      returnedPaise: true,
      pricesIncludeTax: true,
      taxRemittedBy: true,
      couponId: true,
      couponCode: true,
      shippingRateId: true,
      shippingMethodName: true,
      customerNote: true,
      reservationExpiresAt: true,
      placedAt: true,
      confirmedAt: true,
      packedAt: true,
      shippedAt: true,
      deliveredAt: true,
      cancelledAt: true,
      cancelReason: true,
      guestEmail: true,
      customerId: true,
      createdAt: true,
      updatedAt: true,
      customer: { select: { id: true, fullName: true, email: true, phone: true, status: true, orderCount: true, totalSpentPaise: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      coupon: { select: { id: true, code: true, type: true, fundedBy: true } },
      addresses: {
        select: {
          type: true,
          fullName: true,
          phone: true,
          email: true,
          line1: true,
          line2: true,
          landmark: true,
          city: true,
          state: true,
          pinCode: true,
          country: true,
        },
      },
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          productId: true,
          variantId: true,
          sellerId: true,
          titleSnapshot: true,
          variantSnapshot: true,
          skuSnapshot: true,
          sellerNameSnapshot: true,
          hsnCodeSnapshot: true,
          imageUrl: true,
          attributesSnapshot: true,
          customization: true,
          listPricePaise: true,
          unitPricePaise: true,
          customizationPaise: true,
          quantity: true,
          discountPaise: true,
          sellerFundedDiscountPaise: true,
          platformFundedDiscountPaise: true,
          taxRateBps: true,
          taxPaise: true,
          lineTotalPaise: true,
          commissionBps: true,
          commissionPaise: true,
          chargesPaise: true,
          sellerPayablePaise: true,
          status: true,
          reservedQty: true,
          returnedQty: true,
          refundedPaise: true,
          shippedAt: true,
          deliveredAt: true,
          product: { select: { slug: true } },
          seller: { select: { slug: true, displayName: true } },
          shipmentItems: { where: { shipment: { status: { not: "CANCELLED" } } }, select: { quantity: true } },
        },
      },
      payments: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          provider: true,
          providerOrderId: true,
          providerPaymentId: true,
          method: true,
          type: true,
          status: true,
          amountPaise: true,
          failureCode: true,
          failureMessage: true,
          capturedAt: true,
          createdAt: true,
        },
      },
      shipments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          shipmentNumber: true,
          status: true,
          partnerId: true,
          carrierName: true,
          trackingNumber: true,
          trackingUrl: true,
          weightGrams: true,
          costPaise: true,
          estimatedDeliveryAt: true,
          shippedAt: true,
          deliveredAt: true,
          note: true,
          createdAt: true,
          updatedAt: true,
          items: { select: { orderItemId: true, quantity: true, orderItem: { select: { titleSnapshot: true, variantSnapshot: true } } } },
          events: { orderBy: { occurredAt: "desc" }, select: { id: true, status: true, location: true, message: true, occurredAt: true } },
        },
      },
      returnRequests: {
        orderBy: { requestedAt: "desc" },
        select: { id: true, rmaNumber: true, status: true, quantity: true, reason: true, orderItemId: true, requestedAt: true, resolution: true },
      },
      refunds: {
        orderBy: { createdAt: "desc" },
        select: { id: true, refundNumber: true, status: true, amountPaise: true, method: true, reason: true, createdAt: true, completedAt: true },
      },
      couponUsages: { select: { id: true, discountPaise: true, createdAt: true } },
      events: {
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          type: true,
          fromStatus: true,
          toStatus: true,
          message: true,
          isInternal: true,
          createdAt: true,
          actor: { select: { name: true, email: true } },
        },
      },
    },
  });

  if (!order) return null;

  const items: OrderDetailItem[] = order.items.map((item) => {
    const shipped = item.shipmentItems.reduce((sum, row) => sum + row.quantity, 0);
    return {
      id: item.id,
      productId: item.productId,
      productSlug: item.product?.slug ?? null,
      variantId: item.variantId,
      sellerId: item.sellerId,
      sellerSlug: item.seller?.slug ?? null,
      sellerName: item.sellerNameSnapshot ?? item.seller?.displayName ?? null,
      titleSnapshot: item.titleSnapshot,
      variantSnapshot: item.variantSnapshot,
      skuSnapshot: item.skuSnapshot,
      hsnCodeSnapshot: item.hsnCodeSnapshot,
      imageUrl: item.imageUrl,
      attributesSnapshot: Array.isArray(item.attributesSnapshot)
        ? (item.attributesSnapshot as Array<{ code: string; name: string; value: string; label: string }>)
        : [],
      customization: Array.isArray(item.customization) ? (item.customization as unknown as OrderCustomizationEntry[]) : [],
      listPricePaise: item.listPricePaise,
      unitPricePaise: item.unitPricePaise,
      customizationPaise: item.customizationPaise,
      quantity: item.quantity,
      discountPaise: item.discountPaise,
      sellerFundedDiscountPaise: item.sellerFundedDiscountPaise,
      platformFundedDiscountPaise: item.platformFundedDiscountPaise,
      taxRateBps: item.taxRateBps,
      taxPaise: item.taxPaise,
      lineTotalPaise: item.lineTotalPaise,
      commissionBps: item.commissionBps,
      commissionPaise: item.commissionPaise,
      chargesPaise: item.chargesPaise,
      sellerPayablePaise: item.sellerPayablePaise,
      status: item.status,
      reservedQty: item.reservedQty,
      returnedQty: item.returnedQty,
      refundedPaise: item.refundedPaise,
      shippedAt: item.shippedAt,
      deliveredAt: item.deliveredAt,
      unshippedQty: item.status === "ACTIVE" ? Math.max(0, item.quantity - shipped) : 0,
    };
  });

  const shipments: OrderDetailShipment[] = order.shipments.map((shipment) => ({
    id: shipment.id,
    shipmentNumber: shipment.shipmentNumber,
    status: shipment.status,
    partnerId: shipment.partnerId,
    carrierName: shipment.carrierName,
    trackingNumber: shipment.trackingNumber,
    trackingUrl: shipment.trackingUrl,
    weightGrams: shipment.weightGrams,
    costPaise: shipment.costPaise,
    estimatedDeliveryAt: shipment.estimatedDeliveryAt,
    shippedAt: shipment.shippedAt,
    deliveredAt: shipment.deliveredAt,
    note: shipment.note,
    createdAt: shipment.createdAt,
    updatedAt: shipment.updatedAt,
    items: shipment.items.map((row) => ({
      orderItemId: row.orderItemId,
      quantity: row.quantity,
      title: row.orderItem.titleSnapshot,
      variant: row.orderItem.variantSnapshot,
    })),
    events: shipment.events,
  }));

  const paidPaise = order.payments
    .filter((payment) => payment.status === "SUCCEEDED" && (payment.type === "CHARGE" || payment.type === "CAPTURE"))
    .reduce((sum, payment) => sum + payment.amountPaise, 0);

  const sellerSplit: SellerSplit[] = summariseSellerSplit(
    order.items.map((item) => ({
      sellerId: item.sellerId,
      sellerNameSnapshot: item.sellerNameSnapshot,
      status: item.status,
      unitPricePaise: item.unitPricePaise,
      customizationPaise: item.customizationPaise,
      quantity: item.quantity,
      sellerFundedDiscountPaise: item.sellerFundedDiscountPaise,
      taxPaise: item.taxPaise,
      commissionPaise: item.commissionPaise,
      chargesPaise: item.chargesPaise,
      sellerPayablePaise: item.sellerPayablePaise,
    })),
  );

  const shippingAddress = order.addresses.find((address) => address.type === "SHIPPING") ?? null;
  const billingAddress = order.addresses.find((address) => address.type === "BILLING") ?? null;

  return {
    ...order,
    items,
    shipments,
    shippingAddress,
    billingAddress,
    sellerSplit,
    paidPaise,
    balanceDuePaise: Math.max(0, order.totalPaise - paidPaise),
    customerEmail: order.customer?.email ?? order.guestEmail ?? shippingAddress?.email ?? "",
    customerName: order.customer?.fullName ?? shippingAddress?.fullName ?? "Guest",
    isGuest: order.customerId === null,
  };
}

/** The Activity card: AuditLog rows for this order and its shipments. */
export async function listOrderActivity(orderId: string, shipmentIds: readonly string[], take = 50) {
  return db.auditLog.findMany({
    where: {
      OR: [
        { entityType: "Order", entityId: orderId },
        ...(shipmentIds.length ? [{ entityType: "Shipment", entityId: { in: [...shipmentIds] } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, action: true, summary: true, actorEmail: true, createdAt: true, diff: true },
  });
}

const STORE_KEYS = [
  "store.name",
  "store.tagline",
  "store.address",
  "store.contact_email",
  "store.contact_phone",
  "store.currency",
  "storefront.base_url",
] as const;

export type StoreIdentity = Record<(typeof STORE_KEYS)[number], string>;

/**
 * Seller/store identity for the invoice header. Read straight from Setting so
 * an admin editing the address sees it on the next print, and nothing about
 * the business is hard-coded in src/.
 */
export async function getStoreIdentity(): Promise<StoreIdentity> {
  const values = await readSettingStrings(undefined, STORE_KEYS);
  return values as StoreIdentity;
}

/** Packing slips for /admin/orders/print?ids=… (max 100 per sheet). */
export async function getPackingSlips(ids: readonly string[]) {
  if (ids.length === 0) return [];
  return db.order.findMany({
    where: { id: { in: [...ids] } },
    orderBy: { placedAt: "asc" },
    take: 100,
    select: {
      id: true,
      orderNumber: true,
      placedAt: true,
      paymentMethod: true,
      paymentStatus: true,
      totalPaise: true,
      customerNote: true,
      shippingMethodName: true,
      addresses: {
        select: { type: true, fullName: true, phone: true, line1: true, line2: true, landmark: true, city: true, state: true, pinCode: true, country: true },
      },
      items: {
        where: { status: "ACTIVE" },
        orderBy: { id: "asc" },
        select: { id: true, titleSnapshot: true, variantSnapshot: true, skuSnapshot: true, quantity: true, customization: true, sellerNameSnapshot: true },
      },
    },
  });
}
