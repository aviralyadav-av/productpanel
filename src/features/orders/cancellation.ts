import { formatPaise } from "@/lib/money";
import { releaseStock, restock, type StockChange } from "@/features/inventory/service";
import { refundableRemaining } from "@/features/finance/service";
import { releaseCouponUsage } from "@/features/coupons/service";
import { emitEvent } from "@/features/notifications/service";

import { recomputeOrderPaymentStatus } from "./derived";
import { addOrderEvent, contactFor, createCancellationRefund, orderUrlFor, type Db, type OrderActor } from "./shared";

/**
 * Cancelling an order (blueprint §14.C2, C3, B6) - shared by the manual
 * transition, the expiry/COD jobs, RTO receipt and "every line cancelled".
 *
 *   PENDING → CANCELLED|FAILED           RELEASE reservedDelta −q
 *   CONFIRMED|PROCESSING|PACKED → CANCELLED   RETURN delta +q (ORDER_CANCELLED)
 *
 * Then: open payment attempts are closed, the coupon redemption is handed
 * back, a PENDING Refund is created for whatever was paid (COD cash and
 * manual payments go back by bank transfer; gateway payments to the original
 * instrument) and the customer is told.
 */

export type CancellationLine = {
  id: string;
  variantId: string | null;
  quantity: number;
  reservedQty: number;
  status: string;
  shippedAt: Date | null;
};

export type CancellationInput = {
  orderId: string;
  toStatus: "CANCELLED" | "FAILED";
  reason: string;
  note?: string | null;
  actor: OrderActor;
  cancelledBy: "customer" | "admin" | "system";
  /** Restrict the stock/line effects to these lines (RTO of one shipment). */
  lineIds?: readonly string[];
  /** RTO: the shipped units come back to the shelf even though they shipped. */
  restockShipped?: boolean;
};

export type CancellationResult = {
  stockChanges: StockChange[];
  refund: { id: string; refundNumber: string; amountPaise: number } | null;
};

export async function applyCancellation(tx: Db, input: CancellationInput): Promise<CancellationResult> {
  const now = new Date();
  const order = await tx.order.findUniqueOrThrow({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      couponId: true,
      guestEmail: true,
      customer: { select: { email: true, fullName: true } },
      addresses: { select: { type: true, fullName: true, email: true } },
      items: { select: { id: true, variantId: true, quantity: true, reservedQty: true, status: true, shippedAt: true } },
    },
  });

  const wasPending = order.status === "PENDING";
  const stockChanges: StockChange[] = [];
  const lines = order.items.filter(
    (item) => item.status === "ACTIVE" && (!input.lineIds || input.lineIds.includes(item.id)) && (input.restockShipped || item.shippedAt === null),
  );

  for (const line of lines) {
    if (line.variantId) {
      if (wasPending) {
        if (line.reservedQty > 0) {
          stockChanges.push(
            await releaseStock(tx, { variantId: line.variantId, quantity: line.reservedQty, orderId: order.id, actorId: input.actor.id, note: input.reason }),
          );
        }
      } else {
        stockChanges.push(
          await restock(tx, {
            variantId: line.variantId,
            quantity: line.quantity,
            orderId: order.id,
            actorId: input.actor.id,
            reason: input.restockShipped ? "RTO" : "ORDER_CANCELLED",
            note: input.reason,
          }),
        );
      }
    }
    await tx.orderItem.update({ where: { id: line.id }, data: { status: "CANCELLED", reservedQty: 0 } });
  }

  // Open payment attempts can no longer succeed against a cancelled order.
  await tx.orderPayment.updateMany({ where: { orderId: order.id, status: "PENDING" }, data: { status: "CANCELLED" } });

  if (order.couponId) await releaseCouponUsage(tx, { couponId: order.couponId, orderId: order.id });

  await tx.order.update({
    where: { id: order.id },
    data: {
      status: input.toStatus,
      cancelledAt: now,
      cancelReason: input.reason,
      reservationExpiresAt: null,
      fulfillmentStatus: "UNFULFILLED",
    },
  });

  await addOrderEvent(tx, {
    orderId: order.id,
    type: "STATUS_CHANGE",
    fromStatus: order.status,
    toStatus: input.toStatus,
    message:
      input.toStatus === "FAILED"
        ? `Order failed - ${input.reason}`
        : `Order cancelled - ${input.reason}${input.note ? ` (${input.note})` : ""}`,
    metadata: { reason: input.reason, note: input.note ?? null, cancelledBy: input.cancelledBy, lines: lines.length },
    actorId: input.actor.id,
  });

  const payment = await recomputeOrderPaymentStatus(tx, order.id);

  let refund: CancellationResult["refund"] = null;
  if (input.toStatus === "CANCELLED" && payment.paidPaise > 0) {
    const remaining = await refundableRemaining(tx, order.id);
    refund = await createCancellationRefund(tx, {
      orderId: order.id,
      amountPaise: remaining,
      reason: input.reason === "RTO" ? "Returned to origin" : `Order cancelled: ${input.reason}`,
      actorId: input.actor.id,
    });
  }

  if (input.toStatus === "CANCELLED") {
    const contact = contactFor(order);
    if (contact.email) {
      await emitEvent(
        "order.cancelled",
        {
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: contact.name,
          customerEmail: contact.email,
          cancelReason: refund ? `${input.reason}. A refund of ${formatPaise(refund.amountPaise)} is being arranged.` : input.reason,
          orderUrl: await orderUrlFor(tx, order.orderNumber),
          cancelledBy: input.cancelledBy,
        },
        tx,
      );
    }
  }

  return { stockChanges, refund };
}
