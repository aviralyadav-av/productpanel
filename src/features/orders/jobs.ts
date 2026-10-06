import { SYSTEM_ACTOR } from "@/lib/audit";
import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { registerJobHandler } from "@/lib/queue";
import { readSettingBoolean, readSettingNumber } from "@/features/finance/settings-reader";
import { emitEvent } from "@/features/notifications/service";

import { contactFor, orderUrlFor, settleStockChanges } from "./shared";
import { transitionOrder } from "./transitions";

/**
 * Background work for orders (blueprint §14.B6, D15, E3). Registered by
 * src/lib/queue/register-all.ts. No `server-only` / `next/*` imports: the
 * worker runs these as plain tsx.
 *
 *   orders.after_payment          gateway settled an attempt → confirm / notify
 *   orders.expire_unpaid          unpaid ONLINE orders past their reservation → FAILED
 *   orders.cancel_unconfirmed_cod COD orders not confirmed in time → CANCELLED
 */

export type AfterPaymentPayload = { orderId: string; paymentId: string; status: string };

const BATCH = 100;

export async function afterPaymentJob(payload: AfterPaymentPayload): Promise<{ action: string }> {
  const order = await db.order.findUnique({
    where: { id: payload.orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      guestEmail: true,
      customer: { select: { email: true, fullName: true } },
      addresses: { select: { type: true, fullName: true, email: true } },
    },
  });
  const payment = await db.orderPayment.findUnique({
    where: { id: payload.paymentId },
    select: { id: true, provider: true, providerPaymentId: true, amountPaise: true, failureMessage: true, status: true },
  });
  if (!order || !payment) return { action: "missing" };

  if (payload.status === "SUCCEEDED" && payment.status === "SUCCEEDED") {
    let action = "already_confirmed";
    if (order.status === "PENDING") {
      const autoConfirm = await readSettingBoolean(undefined, "orders.auto_confirm_prepaid");
      if (autoConfirm) {
        const result = await transitionOrder({ orderId: order.id, toStatus: "CONFIRMED", actor: SYSTEM_ACTOR, note: `Payment ${payment.providerPaymentId ?? payment.id} succeeded` });
        await settleStockChanges(result.stockChanges);
        action = "confirmed";
      } else {
        action = "paid_awaiting_confirmation";
      }
    }
    const contact = contactFor(order);
    if (contact.email) {
      await emitEvent("payment.succeeded", {
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: contact.name,
        customerEmail: contact.email,
        amountText: formatPaise(payment.amountPaise),
        transactionId: payment.providerPaymentId ?? payment.id,
        orderUrl: await orderUrlFor(undefined, order.orderNumber),
      });
    }
    return { action };
  }

  if (payload.status === "FAILED") {
    // The order stays PENDING (B6); settle already wrote the timeline event.
    await emitEvent("payment.failed", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      amountText: formatPaise(payment.amountPaise),
      provider: payment.provider,
      failureMessage: payment.failureMessage,
    });
    return { action: "failed_notified" };
  }

  return { action: "ignored" };
}

/** B6: ONLINE orders whose reservation expired → FAILED, stock released. */
export async function expireUnpaidOrdersJob(now: Date = new Date()): Promise<{ scanned: number; failed: number; errors: number }> {
  const rows = await db.order.findMany({
    where: { status: "PENDING", paymentMethod: "ONLINE", reservationExpiresAt: { lte: now } },
    select: { id: true },
    orderBy: { reservationExpiresAt: "asc" },
    take: BATCH,
  });
  let failed = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const result = await transitionOrder({ orderId: row.id, toStatus: "FAILED", actor: SYSTEM_ACTOR, reason: "Payment window expired", cancelledBy: "system" });
      await settleStockChanges(result.stockChanges);
      failed += 1;
    } catch (error) {
      errors += 1;
      console.error("EXPIRE UNPAID FAILED", row.id, error);
    }
  }
  return { scanned: rows.length, failed, errors };
}

/** D15: COD orders not confirmed within orders.cod_confirm_hours → CANCELLED. */
export async function cancelUnconfirmedCodJob(now: Date = new Date()): Promise<{ scanned: number; cancelled: number; errors: number }> {
  const hours = (await readSettingNumber(undefined, "orders.cod_confirm_hours")) || 48;
  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const rows = await db.order.findMany({
    where: { status: "PENDING", paymentMethod: "COD", placedAt: { lte: cutoff } },
    select: { id: true },
    orderBy: { placedAt: "asc" },
    take: BATCH,
  });
  let cancelled = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const result = await transitionOrder({
        orderId: row.id,
        toStatus: "CANCELLED",
        actor: SYSTEM_ACTOR,
        reason: `Cash-on-delivery order not confirmed within ${hours} hours`,
        cancelledBy: "system",
      });
      await settleStockChanges(result.stockChanges);
      cancelled += 1;
    } catch (error) {
      errors += 1;
      console.error("CANCEL UNCONFIRMED COD FAILED", row.id, error);
    }
  }
  return { scanned: rows.length, cancelled, errors };
}

export function registerOrdersJobHandlers(): void {
  registerJobHandler<AfterPaymentPayload>("orders.after_payment", ({ payload }) => afterPaymentJob(payload));
  registerJobHandler("orders.expire_unpaid", () => expireUnpaidOrdersJob());
  registerJobHandler("orders.cancel_unconfirmed_cod", () => cancelUnconfirmedCodJob());
}
