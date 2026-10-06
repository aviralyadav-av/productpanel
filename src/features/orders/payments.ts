import { conflict, notFound, validationError } from "@/lib/api/errors";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { getPaymentProvider, listEnabledProviders, PaymentProviderError, type PaymentProvider } from "@/lib/payments";
import { readSettingBoolean } from "@/features/finance/settings-reader";

import { recomputeOrderPaymentStatus } from "./derived";
import type { RecordManualPaymentValues } from "./schemas";
import { addOrderEvent, lockOrder, runOrderTx, type OrderActor } from "./shared";

/**
 * Payments the ORDERS module writes itself (blueprint §14.B6).
 *
 * Gateway results are settled ONLY by `settlePaymentEvent` in src/lib/payments;
 * this file covers the two paths that never touch a gateway callback - cash
 * or bank transfers an operator records by hand, and creating the PENDING
 * attempt row an online checkout (or a retry) needs before the storefront
 * opens the gateway widget.
 */

export type PaymentAttempt = {
  paymentId: string;
  provider: string;
  providerOrderId: string;
  clientParams: Record<string, unknown>;
  amountPaise: number;
};

/**
 * Resolve the gateway for an ONLINE order: the requested code when enabled,
 * else the first enabled online provider. Throws a 422 the storefront can
 * show when nothing is enabled (a deployment problem, not a customer one).
 */
export async function resolveOnlineProvider(requested?: string | null): Promise<PaymentProvider> {
  try {
    if (requested) {
      const provider = await getPaymentProvider(requested);
      if (!provider.supportsOnline) throw validationError({ paymentProvider: "That provider does not support online payment." });
      return provider;
    }
    const enabled = (await listEnabledProviders()).filter((row) => row.supportsOnline);
    if (enabled.length === 0) throw validationError({ paymentMethod: "Online payment is not available right now. Please choose cash on delivery." });
    return getPaymentProvider(enabled[0].code);
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      throw validationError({ paymentProvider: "That payment provider is not available." });
    }
    throw error;
  }
}

/**
 * Create a PENDING attempt for an ONLINE order that is still PENDING. Each
 * retry is a new row; earlier open attempts are closed so a late callback for
 * an abandoned widget cannot double-charge (settle matches by providerOrderId
 * and only flips PENDING rows).
 */
export async function createPaymentAttempt(input: { orderId: string; providerCode?: string | null; actorId?: string | null }): Promise<PaymentAttempt> {
  const order = await db.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentMethod: true,
      paymentStatus: true,
      totalPaise: true,
      currency: true,
      guestEmail: true,
      customer: { select: { email: true, fullName: true, phone: true } },
      addresses: { where: { type: "SHIPPING" }, select: { fullName: true, phone: true, email: true } },
    },
  });
  if (!order) throw notFound("Order");
  if (order.paymentMethod !== "ONLINE") throw conflict("This order is not paid online.");
  if (order.status !== "PENDING" || order.paymentStatus === "PAID") throw conflict("This order no longer needs a payment.");

  const provider = await resolveOnlineProvider(input.providerCode);
  const shipping = order.addresses[0];
  const created = await provider.createPayment({
    order: { id: order.id, orderNumber: order.orderNumber },
    amountPaise: order.totalPaise,
    currency: order.currency,
    customer: {
      email: order.customer?.email ?? shipping?.email ?? order.guestEmail,
      name: order.customer?.fullName ?? shipping?.fullName,
      phone: order.customer?.phone ?? shipping?.phone,
    },
  });

  const payment = await runOrderTx(async (tx) => {
    await tx.orderPayment.updateMany({ where: { orderId: order.id, status: "PENDING", type: "CHARGE" }, data: { status: "CANCELLED" } });
    const row = await tx.orderPayment.create({
      data: {
        orderId: order.id,
        provider: provider.code,
        providerOrderId: created.providerOrderId,
        method: "OTHER",
        type: "CHARGE",
        status: "PENDING",
        amountPaise: order.totalPaise,
        currency: order.currency,
      },
      select: { id: true },
    });
    await addOrderEvent(tx, {
      orderId: order.id,
      type: "PAYMENT",
      message: `Payment attempt started with ${provider.displayName} (${created.providerOrderId})`,
      metadata: { provider: provider.code, providerOrderId: created.providerOrderId, paymentId: row.id },
      actorId: input.actorId ?? null,
    });
    return row;
  });

  return {
    paymentId: payment.id,
    provider: provider.code,
    providerOrderId: created.providerOrderId,
    clientParams: created.clientParams,
    amountPaise: order.totalPaise,
  };
}

export type ManualPaymentResult = {
  paymentId: string;
  orderId: string;
  paymentStatus: string;
  paidPaise: number;
  /** True when the payment completed a PENDING order (caller confirms it). */
  shouldConfirm: boolean;
};

/**
 * Record cash / bank transfer / UPI received outside a gateway. Requires
 * payments.manage (checked by the caller). Over-payment is rejected - a
 * refund is the right tool for money that should go back.
 */
export function recordManualPayment(input: { orderId: string; actor: OrderActor; values: RecordManualPaymentValues; ip?: string | null }): Promise<ManualPaymentResult> {
  return runOrderTx(async (tx) => {
    if (!(await lockOrder(tx, input.orderId))) throw notFound("Order");
    const order = await tx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      select: { id: true, orderNumber: true, status: true, paymentMethod: true, totalPaise: true, currency: true },
    });
    if (["CANCELLED", "FAILED"].includes(order.status)) throw conflict("Payments cannot be recorded on a cancelled or failed order.");

    const paidSoFar = await tx.orderPayment.aggregate({
      where: { orderId: order.id, status: "SUCCEEDED", type: { in: ["CHARGE", "CAPTURE"] } },
      _sum: { amountPaise: true },
    });
    const outstanding = order.totalPaise - (paidSoFar._sum.amountPaise ?? 0);
    if (outstanding <= 0) throw conflict("This order is already fully paid.");
    if (input.values.amountPaise > outstanding) {
      throw validationError({ amountPaise: `Only ${formatPaise(outstanding)} is outstanding.` });
    }

    // Cash on a COD order is the COD provider; anything else is MANUAL (B6).
    const provider = order.paymentMethod === "COD" && input.values.method === "CASH" ? "COD" : "MANUAL";
    const now = new Date();
    const payment = await tx.orderPayment.create({
      data: {
        orderId: order.id,
        provider,
        providerPaymentId: input.values.reference ?? null,
        method: input.values.method,
        type: "CHARGE",
        status: "SUCCEEDED",
        amountPaise: input.values.amountPaise,
        currency: order.currency,
        capturedAt: now,
        rawPayload: { note: input.values.note ?? null, recordedBy: input.actor.email },
      },
      select: { id: true },
    });

    const recompute = await recomputeOrderPaymentStatus(tx, order.id);

    await addOrderEvent(tx, {
      orderId: order.id,
      type: "PAYMENT",
      message: `${formatPaise(input.values.amountPaise)} received by ${input.values.method.toLowerCase().replace("_", " ")}${input.values.reference ? ` (ref ${input.values.reference})` : ""}${input.values.note ? ` - ${input.values.note}` : ""}`,
      metadata: { paymentId: payment.id, provider, method: input.values.method, amountPaise: input.values.amountPaise },
      actorId: input.actor.id,
    });
    await writeAudit(tx, {
      actor: input.actor,
      action: "order.payment_record",
      entityType: "Order",
      entityId: order.id,
      entityLabel: order.orderNumber,
      summary: `Recorded ${formatPaise(input.values.amountPaise)} (${input.values.method}) on ${order.orderNumber}`,
      diff: { amountPaise: input.values.amountPaise, method: input.values.method, reference: input.values.reference ?? null, paymentStatus: recompute.paymentStatus },
      ip: input.ip ?? null,
    });

    const autoConfirm = await readSettingBoolean(tx, "orders.auto_confirm_prepaid");
    return {
      paymentId: payment.id,
      orderId: order.id,
      paymentStatus: recompute.paymentStatus,
      paidPaise: recompute.paidPaise,
      shouldConfirm: order.status === "PENDING" && recompute.paymentStatus === "PAID" && autoConfirm,
    };
  });
}
