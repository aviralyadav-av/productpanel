import type { Prisma } from "@prisma/client";

import { ApiError, forbiddenError, notFound, validationError } from "@/lib/api/errors";
import { SYSTEM_ACTOR, writeAudit } from "@/lib/audit";
import { hashToken, randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { commitReservation, reserveStock, type StockChange } from "@/features/inventory/service";
import { nextNumber } from "@/features/finance/service";
import { readSettingJson, readSettingNumber, readSettingString } from "@/features/finance/settings-reader";
import { CouponUsageError, recordCouponUsage } from "@/features/coupons/service";
import { consumeUploadTokens } from "@/features/products/customization-uploads";
import { snapshotCustomization } from "@/features/products/customization";
import { emitEvent } from "@/features/notifications/service";

import { buildOrderDraft, type DraftLineRequest, type OrderDraft } from "./draft";
import { createPaymentAttempt, resolveOnlineProvider, type PaymentAttempt } from "./payments";
import type { AddressValues, ManualOrderValues, StorefrontOrderValues } from "./schemas";
import { addOrderEvent, orderItemsHtml, orderUrlFor, runOrderTx, settleStockChanges, type Db, type OrderActor } from "./shared";

export { transitionOrder, bulkTransitionOrders, cancelOrderItem } from "./transitions";
export { addOrderNote, updateOrderAddress, resendOrderConfirmation } from "./notes";
export { createShipment, updateShipmentStatus, rtoReceived, unshippedQuantities } from "./shipments";
export { recordManualPayment, createPaymentAttempt } from "./payments";
export { recomputeOrderDerivedStatus, recomputeOrderPaymentStatus, applyRefundToOrder, recomputeCustomerCounters } from "./derived";
export { buildOrderDraft } from "./draft";
export { settleStockChanges } from "./shared";

/**
 * Order creation (blueprint §10 createStorefrontOrder / createManualOrder,
 * §11.8, §11.9, §11.32, §14.B6, C3, D1, D15).
 *
 * Both entry points share `persistOrder`: the same pricing core, the same
 * stock moves, the same snapshot columns. They differ only in who is asking
 * (a shopper the website vouches for vs an operator), the abuse controls that
 * apply, and whether the order starts life PENDING (awaiting payment or COD
 * confirmation) or CONFIRMED (a keyed COD/manual order is a sale at once).
 */

export type CreateOrderResult = {
  orderId: string;
  orderNumber: string;
  status: string;
  totalPaise: number;
  paymentMethod: string;
  customerId: string | null;
  /** Plaintext tracking token - returned exactly once (D1). */
  accessToken: string;
  payment: PaymentAttempt | null;
  paymentError: string | null;
  stockChanges: StockChange[];
};

type Blocklist = { emails?: string[]; phones?: string[]; pincodes?: string[] };

async function assertNotBlocklisted(tx: Db, input: { email: string; phones: (string | null | undefined)[]; pincodes: string[] }): Promise<void> {
  const list = (await readSettingJson<Blocklist>(tx, "checkout.blocklist", {}));
  const emails = new Set((list.emails ?? []).map((value) => value.trim().toLowerCase()));
  const phones = new Set((list.phones ?? []).map((value) => value.replace(/\D/g, "")));
  const pincodes = new Set((list.pincodes ?? []).map((value) => value.trim()));
  const hit =
    emails.has(input.email.toLowerCase()) ||
    input.phones.some((phone) => phone && phones.has(phone.replace(/\D/g, ""))) ||
    input.pincodes.some((pin) => pincodes.has(pin));
  // One uniform message: a blocklisted caller learns nothing about which rule fired.
  if (hit) throw new ApiError(422, "VALIDATION_ERROR", "We cannot accept this order.");
}

/** D15 caps: open PENDING orders per email, orders per IP per day. */
async function assertCheckoutCaps(tx: Db, input: { email: string; ip?: string | null }): Promise<void> {
  const [maxOpen, maxPerIp] = await Promise.all([readSettingNumber(tx, "orders.max_open_per_email"), readSettingNumber(tx, "orders.max_per_ip_per_day")]);
  if (maxOpen > 0) {
    const open = await tx.order.count({
      where: { status: "PENDING", OR: [{ guestEmail: input.email }, { customer: { email: input.email } }] },
    });
    if (open >= maxOpen) throw new ApiError(429, "RATE_LIMITED", "You already have orders awaiting payment. Complete or cancel them before placing another.");
  }
  if (maxPerIp > 0 && input.ip) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await tx.order.count({ where: { ipAddress: input.ip, placedAt: { gte: since } } });
    if (count >= maxPerIp) throw new ApiError(429, "RATE_LIMITED", "Too many orders from this connection today.");
  }
}

/** Cloudflare Turnstile, only when the secret is configured (D15). */
async function verifyTurnstile(secret: string, token: string | undefined, ip?: string | null): Promise<void> {
  if (!token) throw validationError({ turnstileToken: "Please complete the verification challenge." });
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip ?? undefined }),
      signal: AbortSignal.timeout(5000),
    });
    const body = (await response.json()) as { success?: boolean };
    if (!body.success) throw validationError({ turnstileToken: "Verification failed. Please try again." });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw validationError({ turnstileToken: "Verification could not be completed. Please try again." });
  }
}

/**
 * §11.32 / D15: a guest checkout links to the customer record by email, but
 * never to an account that has a password unless the website authenticated
 * the shopper (trusted integration key) - otherwise the order is guestEmail
 * only and the account holder's history stays private.
 */
async function resolveStorefrontCustomer(
  tx: Db,
  input: { email: string; name?: string | null; phone?: string | null; trusted: boolean },
): Promise<{ customerId: string | null; guestEmail: string | null }> {
  const existing = await tx.customer.findFirst({ where: { email: input.email, deletedAt: null }, select: { id: true, status: true, passwordHash: true } });
  if (existing) {
    if (existing.status === "BLOCKED") throw forbiddenError("This account cannot place orders. Please contact support.");
    if (existing.passwordHash && !input.trusted) return { customerId: null, guestEmail: input.email };
    return { customerId: existing.id, guestEmail: null };
  }
  const created = await tx.customer.create({
    data: { email: input.email, fullName: input.name ?? null, phone: input.phone ?? null },
    select: { id: true },
  });
  return { customerId: created.id, guestEmail: null };
}

type PersistInput = {
  tx: Db;
  draft: OrderDraft;
  source: "STOREFRONT" | "MANUAL";
  paymentMethod: "COD" | "ONLINE" | "MANUAL";
  initialStatus: "PENDING" | "CONFIRMED";
  customerId: string | null;
  guestEmail: string | null;
  shippingAddress: AddressValues;
  billingAddress: AddressValues;
  customerNote?: string | null;
  internalNote?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  createdById?: string | null;
  actor: OrderActor;
};

async function persistOrder(input: PersistInput): Promise<{ orderId: string; orderNumber: string; accessToken: string; stockChanges: StockChange[] }> {
  const { tx, draft, actor } = input;
  const now = new Date();
  const accessToken = randomToken();
  const { seq, number } = await nextNumber(tx, "Order");

  const reservationMinutes = input.paymentMethod === "ONLINE" ? (await readSettingNumber(tx, "checkout.payment_timeout_minutes")) || 20 : 0;

  const order = await tx.order.create({
    data: {
      seq,
      orderNumber: number,
      customerId: input.customerId,
      guestEmail: input.guestEmail,
      status: input.initialStatus,
      paymentStatus: "PENDING",
      paymentMethod: input.paymentMethod,
      source: input.source,
      subtotalPaise: draft.totals.subtotalPaise,
      discountPaise: draft.totals.discountPaise,
      couponDiscountPaise: draft.totals.couponDiscountPaise,
      shippingPaise: draft.totals.shippingPaise,
      codFeePaise: draft.totals.codFeePaise,
      taxPaise: draft.totals.taxPaise,
      totalPaise: draft.totals.totalPaise,
      pricesIncludeTax: draft.pricesIncludeTax,
      taxRemittedBy: draft.taxRemittedBy,
      couponId: draft.coupon?.id ?? null,
      couponCode: draft.coupon?.code ?? null,
      shippingRateId: draft.shipping.rateId,
      shippingMethodName: draft.shipping.methodName,
      customerNote: input.customerNote ?? null,
      accessTokenHash: hashToken(accessToken),
      reservationExpiresAt: input.initialStatus === "PENDING" && input.paymentMethod === "ONLINE" ? new Date(now.getTime() + reservationMinutes * 60_000) : null,
      placedAt: now,
      confirmedAt: input.initialStatus === "CONFIRMED" ? now : null,
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      createdById: input.source === "MANUAL" ? input.createdById ?? null : null,
      addresses: {
        create: [
          { type: "SHIPPING", ...addressData(input.shippingAddress) },
          { type: "BILLING", ...addressData(input.billingAddress) },
        ],
      },
    },
    select: { id: true, orderNumber: true },
  });

  // Lines: snapshot + stock. RESERVE for every line; a CONFIRMED manual order
  // commits the reservation in the same transaction (C3 "RESERVE+SALE").
  const stockChanges: StockChange[] = [];
  for (const line of draft.lines) {
    const files = draft.files[line.key];
    const filesByToken: Record<string, { mediaAssetId: string; url: string }> = {};
    if (files?.uploadTokens.length) {
      const consumed = await consumeUploadTokens(tx, files.uploadTokens, { visibility: "PRIVATE", folderPath: "customizations", uploadedById: input.createdById ?? null, now });
      for (const item of consumed) filesByToken[item.token] = { mediaAssetId: item.mediaAssetId, url: item.url };
    }
    if (files?.mediaAssetIds.length) {
      const assets = await tx.mediaAsset.findMany({ where: { id: { in: files.mediaAssetIds } }, select: { id: true, url: true } });
      for (const asset of assets) filesByToken[asset.id] = { mediaAssetId: asset.id, url: asset.url };
    }
    const customization = files && files.normalized.length > 0 ? snapshotCustomization(files.normalized, filesByToken) : null;

    await tx.orderItem.create({
      data: {
        orderId: order.id,
        productId: line.productId,
        variantId: line.variantId,
        sellerId: line.sellerId,
        categoryId: line.categoryId,
        titleSnapshot: line.titleSnapshot,
        variantSnapshot: line.variantSnapshot,
        skuSnapshot: line.skuSnapshot,
        sellerNameSnapshot: line.sellerNameSnapshot,
        categoryPathSnapshot: line.categoryPathSnapshot,
        hsnCodeSnapshot: line.hsnCodeSnapshot,
        brandSnapshot: line.brandSnapshot,
        costPaiseSnapshot: line.costPaiseSnapshot,
        imageUrl: line.imageUrl,
        attributesSnapshot: line.attributesSnapshot as Prisma.InputJsonValue,
        customization: customization ? (customization as unknown as Prisma.InputJsonValue) : undefined,
        listPricePaise: line.listPricePaise,
        unitPricePaise: line.unitPricePaise,
        customizationPaise: line.customizationPaise,
        quantity: line.quantity,
        discountPaise: line.discountPaise,
        sellerFundedDiscountPaise: line.sellerFundedDiscountPaise,
        platformFundedDiscountPaise: line.platformFundedDiscountPaise,
        taxRateBps: line.taxRateBps,
        taxPaise: line.taxPaise,
        lineTotalPaise: line.lineTotalPaise,
        commissionBps: line.commissionBps,
        commissionFixedPaise: line.commissionFixedPaise,
        commissionRuleId: line.commissionRuleId,
        commissionPaise: line.commissionPaise,
        chargesPaise: line.chargesPaise,
        sellerPayablePaise: line.sellerPayablePaise,
        status: "ACTIVE",
        reservedQty: input.initialStatus === "PENDING" ? line.quantity : 0,
      },
    });

    if (line.variantId) {
      stockChanges.push(await reserveStock(tx, { variantId: line.variantId, quantity: line.quantity, orderId: order.id, actorId: actor.id }));
      if (input.initialStatus === "CONFIRMED") {
        stockChanges.push(await commitReservation(tx, { variantId: line.variantId, quantity: line.quantity, orderId: order.id, actorId: actor.id }));
      }
    }
  }

  // Coupon redemption counted in the order tx (§11.8, F8).
  if (draft.coupon) {
    try {
      await recordCouponUsage(tx, { couponId: draft.coupon.id, orderId: order.id, customerId: input.customerId ?? undefined, discountPaise: draft.totals.couponDiscountPaise });
    } catch (error) {
      if (error instanceof CouponUsageError && error.code === "ALREADY_RECORDED") {
        // idempotent
      } else if (error instanceof CouponUsageError) {
        throw validationError({ couponCode: error.message });
      } else {
        throw error;
      }
    }
  }

  await addOrderEvent(tx, {
    orderId: order.id,
    type: "SYSTEM",
    message: input.source === "MANUAL" ? `Order entered manually by ${actor.email}` : "Order placed on the storefront",
    metadata: { source: input.source, items: draft.lines.length, couponCode: draft.coupon?.code ?? null, warnings: draft.warnings.map((warning) => warning.code) },
    actorId: actor.id,
  });
  if (input.initialStatus === "CONFIRMED") {
    await addOrderEvent(tx, { orderId: order.id, type: "STATUS_CHANGE", fromStatus: "PENDING", toStatus: "CONFIRMED", message: "Confirmed on entry (manual order)", actorId: actor.id });
  }
  for (const [key, reason] of Object.entries(draft.overrides)) {
    const line = draft.lines.find((row) => row.key === key);
    if (line) {
      await addOrderEvent(tx, {
        orderId: order.id,
        type: "NOTE",
        isInternal: true,
        message: `Price override on ${line.titleSnapshot}: ${formatPaise(line.unitPricePaise)} instead of ${formatPaise(line.listPricePaise)} - ${reason}`,
        actorId: actor.id,
      });
    }
  }
  if (input.internalNote) {
    await addOrderEvent(tx, { orderId: order.id, type: "NOTE", isInternal: true, message: input.internalNote, actorId: actor.id });
  }

  // E3: NEW_ORDER notification + order_confirmation email (with the D1 link).
  const contact = { name: input.shippingAddress.fullName, email: input.guestEmail ?? input.shippingAddress.email ?? "" };
  if (input.customerId) {
    const customer = await tx.customer.findUnique({ where: { id: input.customerId }, select: { email: true, fullName: true } });
    if (customer) contact.email = customer.email;
    if (customer?.fullName) contact.name = customer.fullName;
  }
  await emitEvent(
    "order.created",
    {
      orderId: order.id,
      orderNumber: order.orderNumber,
      totalText: formatPaise(draft.totals.totalPaise),
      paymentMethod: input.paymentMethod,
      itemCount: draft.lines.reduce((sum, line) => sum + line.quantity, 0),
      customerName: contact.name,
      customerEmail: contact.email,
      orderUrl: await orderUrlFor(tx, order.orderNumber, accessToken),
      orderItemsHtml: orderItemsHtml(draft.lines),
    },
    tx,
  );

  return { orderId: order.id, orderNumber: order.orderNumber, accessToken, stockChanges };
}

function addressData(address: AddressValues) {
  return {
    fullName: address.fullName,
    phone: address.phone,
    email: address.email ?? null,
    line1: address.line1,
    line2: address.line2 ?? null,
    landmark: address.landmark ?? null,
    city: address.city,
    state: address.state,
    pinCode: address.pinCode,
    country: address.country,
  };
}

function toDraftRequests(items: ReadonlyArray<{ productId: string; variantId?: string | null; quantity: number; customization?: unknown; unitPriceOverridePaise?: number | null; overrideReason?: string }>): DraftLineRequest[] {
  return items.map((item, index) => ({
    key: String(index),
    productId: item.productId,
    variantId: item.variantId ?? null,
    quantity: item.quantity,
    customization: (item.customization as DraftLineRequest["customization"]) ?? null,
    unitPriceOverridePaise: item.unitPriceOverridePaise ?? null,
    overrideReason: item.overrideReason ?? null,
  }));
}

/** After the order is committed, open the gateway attempt for ONLINE orders. */
async function attachPaymentAttempt(orderId: string, paymentMethod: string, providerCode: string | null | undefined, actorId: string | null): Promise<{ payment: PaymentAttempt | null; paymentError: string | null }> {
  if (paymentMethod !== "ONLINE") return { payment: null, paymentError: null };
  try {
    return { payment: await createPaymentAttempt({ orderId, providerCode, actorId }), paymentError: null };
  } catch (error) {
    console.error("PAYMENT ATTEMPT FAILED", orderId, error);
    return { payment: null, paymentError: "The payment could not be started. Use retry-payment to try again." };
  }
}

// ---------------------------------------------------------------------------
// Storefront checkout (POST /api/v1/orders)
// ---------------------------------------------------------------------------

export async function createStorefrontOrder(
  input: StorefrontOrderValues & { ip?: string | null; userAgent?: string | null; trustedIntegration?: boolean },
): Promise<CreateOrderResult> {
  const turnstileSecret = await readSettingString(undefined, "checkout.turnstile_secret");
  if (turnstileSecret) await verifyTurnstile(turnstileSecret, input.turnstileToken, input.ip);
  // Fail before writing anything when online payment is impossible.
  if (input.paymentMethod === "ONLINE") await resolveOnlineProvider(input.paymentProvider);

  const result = await runOrderTx(async (tx) => {
    const email = input.customer.email;
    await assertNotBlocklisted(tx, {
      email,
      phones: [input.customer.phone, input.shippingAddress.phone, input.billingAddress?.phone],
      pincodes: [input.shippingAddress.pinCode, ...(input.billingAddress ? [input.billingAddress.pinCode] : [])],
    });
    await assertCheckoutCaps(tx, { email, ip: input.ip });

    const customer = await resolveStorefrontCustomer(tx, { email, name: input.customer.name, phone: input.customer.phone, trusted: Boolean(input.trustedIntegration) });

    const draft = await buildOrderDraft({
      tx,
      source: "STOREFRONT",
      items: toDraftRequests(input.items),
      paymentMethod: input.paymentMethod,
      couponCode: input.couponCode,
      shippingRateId: input.shippingRateId,
      destination: { pinCode: input.shippingAddress.pinCode, state: input.shippingAddress.state },
      customer: { email, customerId: customer.customerId },
    });
    if (draft.couponRejection) throw validationError({ couponCode: draft.couponRejection.message });

    const shippingAddress = { ...input.shippingAddress, email: input.shippingAddress.email ?? email };
    const persisted = await persistOrder({
      tx,
      draft,
      source: "STOREFRONT",
      paymentMethod: input.paymentMethod,
      initialStatus: "PENDING",
      customerId: customer.customerId,
      guestEmail: customer.guestEmail,
      shippingAddress,
      billingAddress: input.billingAddress ?? shippingAddress,
      customerNote: input.customerNote,
      ip: input.ip,
      userAgent: input.userAgent,
      actor: SYSTEM_ACTOR,
    });
    return { ...persisted, customerId: customer.customerId, totalPaise: draft.totals.totalPaise };
  });

  await settleStockChanges(result.stockChanges);
  const attempt = await attachPaymentAttempt(result.orderId, input.paymentMethod, input.paymentProvider, null);

  return {
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    status: "PENDING",
    totalPaise: result.totalPaise,
    paymentMethod: input.paymentMethod,
    customerId: result.customerId,
    accessToken: result.accessToken,
    stockChanges: result.stockChanges,
    ...attempt,
  };
}

// ---------------------------------------------------------------------------
// Manual order (admin, orders.create)
// ---------------------------------------------------------------------------

export async function createManualOrder(actor: OrderActor, input: ManualOrderValues, meta: { ip?: string | null } = {}): Promise<CreateOrderResult> {
  if (input.paymentMethod === "ONLINE") await resolveOnlineProvider(input.paymentProvider);

  const result = await runOrderTx(async (tx) => {
    // Customer: an existing record, or find-or-create by email.
    let customerId: string;
    let email: string;
    if (input.customerId) {
      const existing = await tx.customer.findFirst({ where: { id: input.customerId, deletedAt: null }, select: { id: true, email: true } });
      if (!existing) throw notFound("Customer");
      customerId = existing.id;
      email = existing.email;
    } else if (input.customer) {
      email = input.customer.email;
      const existing = await tx.customer.findFirst({ where: { email, deletedAt: null }, select: { id: true } });
      customerId =
        existing?.id ??
        (
          await tx.customer.create({
            data: { email, fullName: input.customer.name ?? null, phone: input.customer.phone ?? null },
            select: { id: true },
          })
        ).id;
    } else {
      throw validationError({ customerId: "Pick a customer." });
    }

    const draft = await buildOrderDraft({
      tx,
      source: "MANUAL",
      items: toDraftRequests(input.items),
      paymentMethod: input.paymentMethod,
      couponCode: input.couponCode,
      shippingRateId: input.shippingRateId,
      destination: { pinCode: input.shippingAddress.pinCode, state: input.shippingAddress.state },
      customer: { email, customerId },
    });
    if (draft.couponRejection) throw validationError({ couponCode: draft.couponRejection.message });

    // C3: a keyed COD/manual order is confirmed on entry; ONLINE waits for payment.
    const initialStatus = input.paymentMethod === "ONLINE" ? "PENDING" : "CONFIRMED";
    const shippingAddress = { ...input.shippingAddress, email: input.shippingAddress.email ?? email };
    const persisted = await persistOrder({
      tx,
      draft,
      source: "MANUAL",
      paymentMethod: input.paymentMethod,
      initialStatus,
      customerId,
      guestEmail: null,
      shippingAddress,
      billingAddress: input.billingSameAsShipping || !input.billingAddress ? shippingAddress : input.billingAddress,
      customerNote: input.customerNote,
      internalNote: input.internalNote,
      ip: meta.ip,
      createdById: actor.id,
      actor,
    });

    await writeAudit(tx, {
      actor,
      action: "order.create",
      entityType: "Order",
      entityId: persisted.orderId,
      entityLabel: persisted.orderNumber,
      summary: `Keyed manual order ${persisted.orderNumber} (${formatPaise(draft.totals.totalPaise)}, ${input.paymentMethod})`,
      diff: { items: input.items.length, paymentMethod: input.paymentMethod, totalPaise: draft.totals.totalPaise, couponCode: draft.coupon?.code ?? null, overrides: Object.keys(draft.overrides).length },
      ip: meta.ip ?? null,
    });

    return { ...persisted, customerId, totalPaise: draft.totals.totalPaise, status: initialStatus };
  });

  await settleStockChanges(result.stockChanges);
  const attempt = await attachPaymentAttempt(result.orderId, input.paymentMethod, input.paymentProvider, actor.id);

  return {
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    status: result.status,
    totalPaise: result.totalPaise,
    paymentMethod: input.paymentMethod,
    customerId: result.customerId,
    accessToken: result.accessToken,
    stockChanges: result.stockChanges,
    ...attempt,
  };
}

/** Draft pricing for the manual order form (no writes; rolled back). */
export async function previewManualOrderDraft(input: {
  items: ManualOrderValues["items"];
  paymentMethod: "COD" | "ONLINE" | "MANUAL";
  couponCode?: string | null;
  shippingRateId?: string | null;
  destination: { pinCode: string; state?: string | null } | null;
  customer: { email?: string | null; customerId?: string | null };
}): Promise<OrderDraft> {
  if (input.items.length === 0) throw validationError({ items: "Add at least one item." });
  return buildOrderDraft({
    tx: db,
    source: "MANUAL",
    items: toDraftRequests(input.items),
    paymentMethod: input.paymentMethod,
    couponCode: input.couponCode,
    shippingRateId: input.shippingRateId,
    destination: input.destination,
    customer: input.customer,
  });
}
