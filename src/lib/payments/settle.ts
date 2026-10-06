import type { Prisma } from "@prisma/client";

import { SYSTEM_ACTOR, writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { JOB_TYPES, type JobType, type PaymentProviderCode } from "@/lib/enums";
import { enqueue } from "@/lib/queue";
import { derivePaymentStatus } from "@/features/finance/math";
import type { ProviderWebhookEvent } from "./types";

/**
 * The one transition that moves a gateway result onto an order (blueprint
 * §14.B6, D5). Both the webhook and the browser /verify callback end here, so
 * they cannot disagree and a payment confirmed by both is settled exactly once.
 *
 * Runs in a single transaction: OrderPayment status, Order.paymentStatus
 * (re-derived from every payment row, never toggled), the PAYMENT timeline
 * event, the audit row and the follow-up job commit together or not at all.
 * The HTTP layer replies 2xx only after this returns.
 */

/**
 * Handled by the orders module (confirm the order, commit reservation, emails).
 * Not in JOB_TYPES yet - enums.ts is frozen this wave - so the enqueue is
 * skipped with a warning until the enum gains the value. See followUps.
 */
export const AFTER_PAYMENT_JOB = "orders.after_payment" as JobType;

export type SettleSource = "webhook" | "client";

export type SettleInput = {
  provider: PaymentProviderCode;
  event: ProviderWebhookEvent;
  source: SettleSource;
  ip?: string | null;
  /** WebhookEvent.id to stamp processedAt on, inside the same tx. */
  webhookEventId?: string | null;
};

export type SettleResult =
  | {
      ok: true;
      changed: boolean;
      orderId: string;
      orderNumber: string;
      paymentId: string;
      paymentStatus: string;
      orderPaymentStatus: string;
    }
  | {
      ok: false;
      reason: "unknown_order" | "amount_mismatch" | "currency_mismatch" | "conflict" | "ignored";
      message: string;
    };

const SETTLEABLE = new Set(["SUCCEEDED", "FAILED"]);

function jobTypeKnown(type: string): boolean {
  return (JOB_TYPES as readonly string[]).includes(type);
}

async function recomputeOrderPaymentStatus(tx: Prisma.TransactionClient, orderId: string): Promise<string> {
  const [order, paid, authorised, refunded] = await Promise.all([
    tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { totalPaise: true, status: true } }),
    tx.orderPayment.aggregate({
      where: { orderId, status: "SUCCEEDED", type: { in: ["CHARGE", "CAPTURE"] } },
      _sum: { amountPaise: true },
    }),
    tx.orderPayment.count({ where: { orderId, status: "SUCCEEDED", type: "AUTHORIZATION" } }),
    tx.refund.aggregate({ where: { orderId, status: "COMPLETED" }, _sum: { amountPaise: true } }),
  ]);

  const paidPaise = paid._sum.amountPaise ?? 0;
  const refundedPaise = refunded._sum.amountPaise ?? 0;
  const paymentStatus = derivePaymentStatus({
    paidPaise,
    refundedPaise,
    totalPaise: order.totalPaise,
    orderStatus: order.status,
    hasAuthorization: authorised > 0 && paidPaise < order.totalPaise,
  });

  await tx.order.update({
    where: { id: orderId },
    data: { paymentStatus, refundedPaise },
  });
  return paymentStatus;
}

/**
 * Apply a normalised provider event. Only SUCCEEDED/FAILED change state;
 * PENDING/REFUNDED/IGNORED events are recorded by the caller and dropped here
 * (refund echoes are the refunds module's job via `Refund.providerRefundId`).
 */
export async function settlePaymentEvent(input: SettleInput): Promise<SettleResult> {
  const { event, provider, source } = input;

  if (!SETTLEABLE.has(event.status) || !event.providerOrderId) {
    return { ok: false, reason: "ignored", message: `Event ${event.type} (${event.status}) needs no settlement.` };
  }

  return db.$transaction(async (tx) => {
    // D5: the order is found ONLY through our own providerOrderId. Prefer the
    // open attempt; fall back to any row so a late webhook for an already
    // settled attempt is recognised as a no-op rather than an unknown order.
    const payment =
      (await tx.orderPayment.findFirst({
        where: { provider, providerOrderId: event.providerOrderId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      })) ??
      (await tx.orderPayment.findFirst({
        where: { provider, providerOrderId: event.providerOrderId },
        orderBy: { createdAt: "desc" },
      }));

    if (!payment) {
      return { ok: false, reason: "unknown_order", message: "No payment attempt matches that provider order id." };
    }

    if (event.amountPaise !== null && event.amountPaise !== payment.amountPaise) {
      return {
        ok: false,
        reason: "amount_mismatch",
        message: `Event amount ${event.amountPaise} does not match the payment attempt (${payment.amountPaise}).`,
      };
    }
    if (event.currency && event.currency.toUpperCase() !== payment.currency.toUpperCase()) {
      return { ok: false, reason: "currency_mismatch", message: "Event currency does not match the payment attempt." };
    }

    const order = await tx.order.findUniqueOrThrow({
      where: { id: payment.orderId },
      select: { id: true, orderNumber: true, paymentStatus: true },
    });

    // Idempotency: the same outcome twice (webhook after /verify, or a replay
    // whose WebhookEvent insert did not dedupe) is a success with no change.
    const samePaymentId =
      !event.providerPaymentId || !payment.providerPaymentId || payment.providerPaymentId === event.providerPaymentId;
    if (payment.status === event.status && samePaymentId) {
      if (input.webhookEventId) {
        await tx.webhookEvent.update({ where: { id: input.webhookEventId }, data: { processedAt: new Date() } });
      }
      return {
        ok: true,
        changed: false,
        orderId: order.id,
        orderNumber: order.orderNumber,
        paymentId: payment.id,
        paymentStatus: order.paymentStatus,
        orderPaymentStatus: payment.status,
      };
    }

    // A SUCCEEDED attempt never regresses: a stray "failed" after a capture
    // (Razorpay can emit both for retried checkouts) is a conflict, not a
    // reversal - reversals are refunds.
    if (payment.status === "SUCCEEDED" && event.status !== "SUCCEEDED") {
      return { ok: false, reason: "conflict", message: "Payment already succeeded; ignoring a later failure event." };
    }
    if (payment.status === "SUCCEEDED" && !samePaymentId) {
      return { ok: false, reason: "conflict", message: "Payment already succeeded with a different gateway payment id." };
    }

    // (provider, providerPaymentId) is unique: if another attempt row already
    // carries this gateway payment id, this event was settled through it.
    if (event.providerPaymentId) {
      const holder = await tx.orderPayment.findUnique({
        where: { provider_providerPaymentId: { provider, providerPaymentId: event.providerPaymentId } },
        select: { id: true, status: true, orderId: true },
      });
      if (holder && holder.id !== payment.id) {
        if (input.webhookEventId) {
          await tx.webhookEvent.update({ where: { id: input.webhookEventId }, data: { processedAt: new Date() } });
        }
        return {
          ok: true,
          changed: false,
          orderId: order.id,
          orderNumber: order.orderNumber,
          paymentId: holder.id,
          paymentStatus: order.paymentStatus,
          orderPaymentStatus: holder.status,
        };
      }
    }

    const succeeded = event.status === "SUCCEEDED";
    const now = new Date();
    await tx.orderPayment.update({
      where: { id: payment.id },
      data: {
        status: event.status,
        providerPaymentId: event.providerPaymentId ?? payment.providerPaymentId,
        capturedAt: succeeded ? now : payment.capturedAt,
        failureCode: succeeded ? null : event.failureCode ?? null,
        failureMessage: succeeded ? null : event.failureMessage ?? null,
        rawPayload: (event.raw ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    const paymentStatus = await recomputeOrderPaymentStatus(tx, order.id);

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "PAYMENT",
        message: succeeded
          ? `Payment of ${(payment.amountPaise / 100).toFixed(2)} ${payment.currency} succeeded via ${provider}.`
          : `Payment attempt via ${provider} failed${event.failureMessage ? `: ${event.failureMessage}` : "."}`,
        isInternal: false,
        metadata: {
          provider,
          source,
          providerOrderId: event.providerOrderId,
          providerPaymentId: event.providerPaymentId,
          amountPaise: payment.amountPaise,
          eventType: event.type,
        },
        actorId: null,
      },
    });

    await writeAudit(tx, {
      actor: SYSTEM_ACTOR,
      action: succeeded ? "payment.succeeded" : "payment.failed",
      entityType: "OrderPayment",
      entityId: payment.id,
      entityLabel: order.orderNumber,
      summary: `${provider} ${source}: payment ${event.status.toLowerCase()} for order ${order.orderNumber} (${payment.amountPaise} paise).`,
      diff: {
        from: { status: payment.status, paymentStatus: order.paymentStatus },
        to: { status: event.status, paymentStatus },
      },
      ip: input.ip ?? null,
      userAgent: null,
    });

    if (input.webhookEventId) {
      await tx.webhookEvent.update({ where: { id: input.webhookEventId }, data: { processedAt: now } });
    }

    if (jobTypeKnown(AFTER_PAYMENT_JOB)) {
      await enqueue(
        AFTER_PAYMENT_JOB,
        { orderId: order.id, paymentId: payment.id, status: event.status },
        { tx, dedupeKey: `${AFTER_PAYMENT_JOB}:${payment.id}:${event.status}`, priority: 10 },
      );
    } else {
      console.warn(`[payments] "${AFTER_PAYMENT_JOB}" is not in JOB_TYPES yet; order ${order.orderNumber} needs the orders module to react to payment ${payment.id}.`);
    }

    return {
      ok: true,
      changed: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      paymentId: payment.id,
      paymentStatus,
      orderPaymentStatus: event.status,
    };
  });
}
