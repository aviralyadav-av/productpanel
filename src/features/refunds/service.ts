import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { badRequest, conflict, notFound, validationError } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { canTransitionRefund, REFUND_METHOD_META, REFUND_STATUS_META, type RefundMethod, type RefundStatus } from "@/lib/enums";
import { formatPaise } from "@/lib/money";
import { getPaymentProvider, PaymentProviderError, type RefundResult } from "@/lib/payments";
import { nextNumber, refundableRemaining, reverseEarningsForRefund } from "@/features/finance/service";
import { readSettingBoolean, readSettingNumber } from "@/features/finance/settings-reader";
import { emitEvent } from "@/features/notifications/service";
import { applyRefundToOrder, recomputeOrderDerivedStatus } from "@/features/orders/derived";
import { addOrderEvent, contactFor, lockOrder } from "@/features/orders/shared";
import { advanceReturnAfterRefund } from "@/features/returns/events";

import { returnRefundCap, type ReturnCapBreakdown } from "./cap";
import { isGatewayProvider, type CreateRefundValues, type RefundTransitionValues } from "./schemas";

/**
 * REFUND lifecycle (blueprint §14.B6, B4, §11.11, §11.12, D13).
 *
 * A refund is money leaving the platform, so every rule that guards it lives
 * here and nowhere else:
 *
 *  - the cap (`refundCapFor`) is recomputed inside the transaction, because a
 *    second refund created a millisecond earlier moves it;
 *  - the method is chosen from the payment that actually happened - cash
 *    collected at the door cannot go back down a card rail (§11.12);
 *  - the gateway call happens OUTSIDE the transaction (a 30 s HTTP timeout
 *    must never hold row locks on an order), between two short transactions
 *    that record PROCESSING and then the outcome;
 *  - COMPLETED is the only status that touches the seller ledger
 *    (`reverseEarningsForRefund`) and `Order.refundedPaise`.
 *
 * No `server-only` and no `next/*` import: the job worker, the check script
 * and node:test all call these functions directly.
 */

export type Db = Prisma.TransactionClient;
export type RefundActor = AuditActor;

const REFUND_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;

function runRefundTx<T>(body: (tx: Db) => Promise<T>): Promise<T> {
  return db.$transaction(body, REFUND_TX_OPTIONS);
}

function actorId(actor: RefundActor): string | null {
  return actor.id || null;
}

// ---------------------------------------------------------------------------
// The cap (B6)
// ---------------------------------------------------------------------------

export type RefundCap = {
  /** What a refund created right now may be at most, in paise. */
  capPaise: number;
  /** paid − Σ counted refunds on the order. */
  orderRemainingPaise: number;
  /** Present only for an RMA-linked refund: the per-line arithmetic. */
  breakdown: ReturnCapBreakdown | null;
  /** Sentences the screens show under the amount field. */
  notes: string[];
};

/**
 * B6 in one function. An order-level refund is capped by what was actually
 * paid minus every refund that is still alive (PENDING/APPROVED/PROCESSING
 * count, so two operators cannot each refund the full amount). An RMA-linked
 * refund is additionally capped by that line's share, plus shipping only when
 * the reason or a full return earns it, minus the pickup fee the customer
 * carries (B5).
 */
export async function refundCapFor(
  tx: Db,
  input: { orderId: string; returnRequestId?: string | null },
): Promise<RefundCap> {
  const orderRemainingPaise = await refundableRemaining(tx, input.orderId);

  if (!input.returnRequestId) {
    return {
      capPaise: orderRemainingPaise,
      orderRemainingPaise,
      breakdown: null,
      notes: [
        "Capped by what the customer actually paid, less every refund already pending or settled.",
        "The COD fee is never refunded after dispatch.",
      ],
    };
  }

  const rma = await tx.returnRequest.findUnique({
    where: { id: input.returnRequestId },
    select: {
      orderId: true,
      quantity: true,
      reason: true,
      orderItem: { select: { id: true, quantity: true, lineTotalPaise: true, refundedPaise: true } },
      order: { select: { shippingPaise: true } },
    },
  });
  if (!rma) throw notFound("Return request");
  if (rma.orderId !== input.orderId) throw badRequest("That RMA belongs to a different order.");

  const [pickupFeePaise, customerPaysPickup, siblings] = await Promise.all([
    readSettingNumber(tx, "returns.pickup_fee_paise"),
    readSettingBoolean(tx, "returns.customer_pays_pickup"),
    tx.orderItem.findMany({
      where: { orderId: rma.orderId, status: { not: "CANCELLED" } },
      select: { id: true, quantity: true, returnedQty: true },
    }),
  ]);

  // "Every line returned" has to count the units THIS RMA covers, because the
  // shipping rule is applied when the refund is created, which may be before
  // returnedQty is incremented at QC_PASSED.
  const allLinesReturned =
    siblings.length > 0 &&
    siblings.every((line) => {
      const pending = line.id === rma.orderItem.id ? rma.quantity : 0;
      return line.returnedQty + pending >= line.quantity;
    });

  const breakdown = returnRefundCap({
    lineTotalPaise: rma.orderItem.lineTotalPaise,
    itemQuantity: rma.orderItem.quantity,
    returnQuantity: rma.quantity,
    itemRefundedPaise: rma.orderItem.refundedPaise,
    shippingPaise: rma.order.shippingPaise,
    allLinesReturned,
    reason: rma.reason,
    pickupFeePaise,
    customerPaysPickup,
    orderRemainingPaise,
  });

  return {
    capPaise: breakdown.capPaise,
    orderRemainingPaise,
    breakdown,
    notes: breakdown.notes,
  };
}

// ---------------------------------------------------------------------------
// Method + source payment (B6, §11.12)
// ---------------------------------------------------------------------------

export type RefundRoute = {
  method: RefundMethod;
  provider: string | null;
  sourcePaymentId: string | null;
  /** True when the provider can be asked to move the money back online. */
  online: boolean;
};

/**
 * Which rail the money goes back on. The most recent successful charge wins:
 * that is the instrument the customer will recognise on their statement. A
 * COD or MANUAL charge has no rail, so the refund is a bank transfer keyed by
 * an operator (§11.12) - offering ORIGINAL there would create refunds that can
 * never be processed.
 */
export async function resolveRefundRoute(
  tx: Db,
  orderId: string,
  requested?: RefundMethod | null,
): Promise<RefundRoute> {
  const payments = await tx.orderPayment.findMany({
    where: { orderId, status: "SUCCEEDED", type: { in: ["CHARGE", "CAPTURE"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, provider: true },
  });
  const gateway = payments.find((payment) => isGatewayProvider(payment.provider)) ?? null;

  if (requested && requested !== "ORIGINAL") {
    return { method: requested, provider: gateway?.provider ?? null, sourcePaymentId: gateway?.id ?? null, online: false };
  }
  if (gateway) {
    return { method: "ORIGINAL", provider: gateway.provider, sourcePaymentId: gateway.id, online: true };
  }
  // Asked for ORIGINAL on an order with no gateway charge: fall back rather
  // than fail, and say so in the event message.
  return { method: "BANK_TRANSFER", provider: null, sourcePaymentId: payments[0]?.id ?? null, online: false };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type RefundSummary = {
  id: string;
  refundNumber: string;
  orderId: string;
  orderNumber: string;
  amountPaise: number;
  method: RefundMethod;
  status: RefundStatus;
  provider: string | null;
};

/**
 * Create a PENDING refund inside the caller's transaction. Used by the
 * "create refund" dialog and by the returns service at REFUND_INITIATED, so
 * both paths validate the cap the same way and both raise `refund.pending`.
 */
export async function createRefundInTx(
  tx: Db,
  input: {
    orderId: string;
    amountPaise: number;
    reason: string;
    notes?: string | null;
    method?: RefundMethod | null;
    returnRequestId?: string | null;
    actor: RefundActor;
  },
): Promise<RefundSummary> {
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, orderNumber: true, paymentMethod: true },
  });
  if (!order) throw notFound("Order");

  if (input.amountPaise <= 0) throw validationError({ amountPaise: "Enter an amount greater than zero." });

  if (input.returnRequestId) {
    const existing = await tx.refund.findFirst({
      where: { returnRequestId: input.returnRequestId, status: { notIn: ["CANCELLED", "FAILED"] } },
      select: { refundNumber: true },
    });
    // Refund.returnRequestId is @unique, so a second live refund on the same
    // RMA is impossible anyway - this turns the constraint error into a
    // sentence an operator can act on.
    if (existing) throw conflict(`Refund ${existing.refundNumber} already settles this RMA.`);
  }

  const cap = await refundCapFor(tx, { orderId: input.orderId, returnRequestId: input.returnRequestId ?? null });
  if (input.amountPaise > cap.capPaise) {
    throw validationError(
      { amountPaise: `At most ${formatPaise(cap.capPaise)} can be refunded.` },
      `The refundable amount is ${formatPaise(cap.capPaise)}.`,
    );
  }

  const route = await resolveRefundRoute(tx, input.orderId, input.method ?? null);
  const { number } = await nextNumber(tx, "Refund");

  const refund = await tx.refund.create({
    data: {
      refundNumber: number,
      orderId: input.orderId,
      returnRequestId: input.returnRequestId ?? null,
      orderPaymentId: route.sourcePaymentId,
      amountPaise: input.amountPaise,
      reason: input.reason,
      notes: input.notes ?? null,
      method: route.method,
      status: "PENDING",
      provider: route.online ? route.provider : null,
      initiatedById: actorId(input.actor),
    },
    select: { id: true, refundNumber: true, amountPaise: true, method: true, status: true, provider: true },
  });

  await addOrderEvent(tx, {
    orderId: input.orderId,
    type: "REFUND",
    message: `Refund ${refund.refundNumber} of ${formatPaise(refund.amountPaise)} created (${REFUND_METHOD_META[route.method].label.toLowerCase()}) — awaiting approval`,
    metadata: { refundId: refund.id, method: route.method, returnRequestId: input.returnRequestId ?? null },
    actorId: actorId(input.actor),
  });
  await writeAudit(tx, {
    actor: input.actor,
    action: "refund.create",
    entityType: "Refund",
    entityId: refund.id,
    entityLabel: refund.refundNumber,
    summary: `Created refund ${refund.refundNumber} of ${formatPaise(refund.amountPaise)} on ${order.orderNumber}`,
    diff: { amountPaise: refund.amountPaise, method: route.method, reason: input.reason, returnRequestId: input.returnRequestId ?? null },
  });

  // The cap counts PENDING refunds, and the payment status may already need
  // to move (a fully-refunded order is not "paid" for long).
  await applyRefundToOrder(tx, refund.id);

  await emitEvent(
    "refund.pending",
    {
      refundId: refund.id,
      refundNumber: refund.refundNumber,
      orderNumber: order.orderNumber,
      amountText: formatPaise(refund.amountPaise),
      method: REFUND_METHOD_META[route.method].label,
    },
    tx,
  );

  return {
    id: refund.id,
    refundNumber: refund.refundNumber,
    orderId: input.orderId,
    orderNumber: order.orderNumber,
    amountPaise: refund.amountPaise,
    method: refund.method as RefundMethod,
    status: refund.status as RefundStatus,
    provider: refund.provider,
  };
}

/** "Create refund" from an order or from /admin/refunds. */
export function createRefund(input: {
  values: CreateRefundValues;
  actor: RefundActor;
  ip?: string | null;
}): Promise<RefundSummary> {
  return runRefundTx(async (tx) => {
    if (!(await lockOrder(tx, input.values.orderId))) throw notFound("Order");
    return createRefundInTx(tx, {
      orderId: input.values.orderId,
      amountPaise: input.values.amountPaise,
      reason: input.values.reason,
      notes: input.values.notes ?? null,
      method: input.values.method,
      returnRequestId: input.values.returnRequestId ?? null,
      actor: input.actor,
    });
  });
}

// ---------------------------------------------------------------------------
// Transitions (B6)
// ---------------------------------------------------------------------------

export type RefundTransitionResult = {
  refundId: string;
  refundNumber: string;
  orderId: string;
  orderNumber: string;
  fromStatus: RefundStatus;
  toStatus: RefundStatus;
  providerRefundId: string | null;
  /** Set when the gateway answered but the money is still in flight. */
  gatewayPending: boolean;
};

const REFUND_LOAD = {
  id: true,
  refundNumber: true,
  orderId: true,
  status: true,
  method: true,
  provider: true,
  providerRefundId: true,
  amountPaise: true,
  reason: true,
  notes: true,
  returnRequestId: true,
  orderPaymentId: true,
  order: { select: { orderNumber: true } },
} as const;

async function loadRefund(tx: Db, refundId: string) {
  const refund = await tx.refund.findUnique({ where: { id: refundId }, select: REFUND_LOAD });
  if (!refund) throw notFound("Refund");
  return refund;
}

function assertTransition(from: string, to: RefundStatus): void {
  if (from === to) throw conflict(`This refund is already ${REFUND_STATUS_META[to].label.toLowerCase()}.`);
  if (!canTransitionRefund(from as RefundStatus, to)) {
    throw conflict(
      `A ${REFUND_STATUS_META[from as RefundStatus]?.label.toLowerCase() ?? from} refund cannot move to ${REFUND_STATUS_META[to].label.toLowerCase()}.`,
    );
  }
}

/** Append a line to Refund.notes rather than overwriting an operator's history. */
function appendNote(existing: string | null, line: string): string {
  return existing && existing.trim() ? `${existing.trim()}\n${line}` : line;
}

export function transitionRefund(input: {
  refundId: string;
  actor: RefundActor;
  values: RefundTransitionValues;
  ip?: string | null;
}): Promise<RefundTransitionResult> {
  switch (input.values.toStatus) {
    case "PROCESSING":
      return processRefund(input);
    case "COMPLETED":
      return completeRefund(input);
    default:
      return simpleTransition(input);
  }
}

/** APPROVED, FAILED, CANCELLED and the FAILED→PENDING retry: one short tx. */
async function simpleTransition(input: {
  refundId: string;
  actor: RefundActor;
  values: RefundTransitionValues;
  ip?: string | null;
}): Promise<RefundTransitionResult> {
  const { refundId, actor, values } = input;
  return runRefundTx(async (tx) => {
    const refund = await loadRefund(tx, refundId);
    if (!(await lockOrder(tx, refund.orderId))) throw notFound("Order");
    assertTransition(refund.status, values.toStatus);

    if (values.toStatus === "FAILED" && !values.failureReason) {
      throw validationError({ failureReason: "Say why the refund failed." });
    }

    const now = new Date();
    const data: Prisma.RefundUpdateInput = { status: values.toStatus };
    if (values.toStatus === "APPROVED") data.approvedBy = actor.id ? { connect: { id: actor.id } } : undefined;
    if (values.toStatus === "FAILED") data.failureReason = values.failureReason ?? null;
    if (values.toStatus === "PENDING") {
      // Retry after a failure: clear the previous outcome so the next attempt
      // is not read as "failed but pending".
      data.failureReason = null;
      data.processedAt = null;
    }
    if (values.note) data.notes = appendNote(refund.notes, `${now.toISOString()} · ${values.note}`);

    await tx.refund.update({ where: { id: refund.id }, data });

    const message = messageFor(values.toStatus, refund.refundNumber, refund.amountPaise, values);
    await addOrderEvent(tx, {
      orderId: refund.orderId,
      type: "REFUND",
      message,
      metadata: { refundId: refund.id, toStatus: values.toStatus },
      actorId: actorId(actor),
    });
    await writeAudit(tx, {
      actor,
      action: auditActionFor(values.toStatus),
      entityType: "Refund",
      entityId: refund.id,
      entityLabel: refund.refundNumber,
      summary: `${message} on ${refund.order.orderNumber}`,
      diff: diffOf({ status: refund.status }, { status: values.toStatus, failureReason: values.failureReason ?? null }),
      ip: input.ip ?? null,
    });

    // CANCELLED frees the cap again; every other status here leaves the money
    // untouched, but the recompute is cheap and keeps one code path.
    await applyRefundToOrder(tx, refund.id);

    return {
      refundId: refund.id,
      refundNumber: refund.refundNumber,
      orderId: refund.orderId,
      orderNumber: refund.order.orderNumber,
      fromStatus: refund.status as RefundStatus,
      toStatus: values.toStatus,
      providerRefundId: refund.providerRefundId,
      gatewayPending: false,
    };
  });
}

function auditActionFor(status: RefundStatus): string {
  switch (status) {
    case "APPROVED":
      return "refund.approve";
    case "PROCESSING":
      return "refund.process";
    case "COMPLETED":
      return "refund.complete";
    case "FAILED":
      return "refund.fail";
    case "CANCELLED":
      return "refund.cancel";
    default:
      return "refund.status_change";
  }
}

function messageFor(status: RefundStatus, number: string, amountPaise: number, values: RefundTransitionValues): string {
  const money = formatPaise(amountPaise);
  switch (status) {
    case "APPROVED":
      return `Refund ${number} of ${money} approved`;
    case "PROCESSING":
      return `Refund ${number} of ${money} sent for processing${values.reference ? ` · ref ${values.reference}` : ""}`;
    case "COMPLETED":
      return `Refund ${number} of ${money} completed${values.reference ? ` · ref ${values.reference}` : ""}`;
    case "FAILED":
      return `Refund ${number} failed: ${values.failureReason ?? "no reason given"}`;
    case "CANCELLED":
      return `Refund ${number} cancelled`;
    case "PENDING":
      return `Refund ${number} sent back to pending for another attempt`;
    default:
      return `Refund ${number} moved to ${status}`;
  }
}

/**
 * APPROVED → PROCESSING. For an ORIGINAL refund on a gateway payment this
 * asks the provider to move the money; the HTTP call sits BETWEEN two
 * transactions so a slow gateway cannot hold a lock on the order. Providers
 * that settle instantly come back COMPLETED and the completion runs straight
 * away; the asynchronous ones stay PROCESSING until their webhook or an
 * operator confirms.
 */
async function processRefund(input: {
  refundId: string;
  actor: RefundActor;
  values: RefundTransitionValues;
  ip?: string | null;
}): Promise<RefundTransitionResult> {
  const { refundId, actor, values } = input;

  const prepared = await runRefundTx(async (tx) => {
    const refund = await loadRefund(tx, refundId);
    if (!(await lockOrder(tx, refund.orderId))) throw notFound("Order");
    assertTransition(refund.status, "PROCESSING");

    const online = refund.method === "ORIGINAL" && isGatewayProvider(refund.provider) && refund.orderPaymentId;
    if (refund.method !== "ORIGINAL" && !values.reference) {
      throw validationError({ reference: "Record the bank or wallet reference for this transfer." });
    }

    const now = new Date();
    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: "PROCESSING",
        processedAt: now,
        notes: values.reference ? appendNote(refund.notes, `${now.toISOString()} · reference ${values.reference}`) : refund.notes,
      },
    });

    const message = messageFor("PROCESSING", refund.refundNumber, refund.amountPaise, values);
    await addOrderEvent(tx, {
      orderId: refund.orderId,
      type: "REFUND",
      message,
      metadata: { refundId: refund.id, online: Boolean(online) },
      actorId: actorId(actor),
    });
    await writeAudit(tx, {
      actor,
      action: "refund.process",
      entityType: "Refund",
      entityId: refund.id,
      entityLabel: refund.refundNumber,
      summary: `${message} on ${refund.order.orderNumber}`,
      diff: { method: refund.method, provider: refund.provider, reference: values.reference ?? null },
      ip: input.ip ?? null,
    });

    const payment = refund.orderPaymentId
      ? await tx.orderPayment.findUnique({
          where: { id: refund.orderPaymentId },
          select: { id: true, orderId: true, provider: true, providerOrderId: true, providerPaymentId: true, amountPaise: true, currency: true, status: true },
        })
      : null;

    return { refund, payment, online: Boolean(online) && Boolean(payment) };
  });

  const base: RefundTransitionResult = {
    refundId: prepared.refund.id,
    refundNumber: prepared.refund.refundNumber,
    orderId: prepared.refund.orderId,
    orderNumber: prepared.refund.order.orderNumber,
    fromStatus: prepared.refund.status as RefundStatus,
    toStatus: "PROCESSING",
    providerRefundId: prepared.refund.providerRefundId,
    gatewayPending: false,
  };

  if (!prepared.online || !prepared.payment) return base;

  // ---- the network call, outside every transaction --------------------------
  let result: RefundResult;
  try {
    const provider = await getPaymentProvider(prepared.payment.provider, { requireEnabled: false });
    result = await provider.refund({
      payment: prepared.payment,
      amountPaise: prepared.refund.amountPaise,
      reason: prepared.refund.reason,
    });
  } catch (error) {
    const reason =
      error instanceof PaymentProviderError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : "The gateway refused the refund.";
    await simpleTransition({
      refundId,
      actor,
      values: { toStatus: "FAILED", failureReason: reason.slice(0, 500), reference: undefined, note: undefined },
      ip: input.ip,
    });
    return { ...base, toStatus: "FAILED" };
  }

  if (result.status === "FAILED") {
    await simpleTransition({
      refundId,
      actor,
      values: { toStatus: "FAILED", failureReason: "The gateway reported the refund as failed.", reference: undefined, note: undefined },
      ip: input.ip,
    });
    return { ...base, toStatus: "FAILED", providerRefundId: result.providerRefundId };
  }

  await db.refund.update({ where: { id: refundId }, data: { providerRefundId: result.providerRefundId } });

  if (result.status === "COMPLETED") {
    return completeRefund({
      refundId,
      actor,
      values: { toStatus: "COMPLETED", reference: result.providerRefundId, failureReason: undefined, note: undefined },
      ip: input.ip,
    });
  }

  return { ...base, providerRefundId: result.providerRefundId, gatewayPending: true };
}

/**
 * PROCESSING → COMPLETED. The only status that moves money in our books:
 * the seller ledger is reversed (B4), a REFUND echo row records the gateway
 * settlement so /admin/payments shows both legs of the transaction, the
 * order's payment status is re-derived (B6) and the RMA, if any, follows.
 */
async function completeRefund(input: {
  refundId: string;
  actor: RefundActor;
  values: RefundTransitionValues;
  ip?: string | null;
}): Promise<RefundTransitionResult> {
  const { refundId, actor, values } = input;
  const outcome = await runRefundTx(async (tx) => {
    const refund = await loadRefund(tx, refundId);
    if (!(await lockOrder(tx, refund.orderId))) throw notFound("Order");
    assertTransition(refund.status, "COMPLETED");

    const now = new Date();
    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: "COMPLETED",
        completedAt: now,
        processedAt: refund.status === "PROCESSING" ? undefined : now,
        providerRefundId: refund.providerRefundId ?? (isGatewayProvider(refund.provider) ? values.reference ?? null : null),
        notes: values.reference ? appendNote(refund.notes, `${now.toISOString()} · settled, reference ${values.reference}`) : refund.notes,
      },
    });

    // B4: reverse the seller's earnings for the refunded units. Idempotent -
    // it keys off the refund number already present in the ledger.
    const reversal = await reverseEarningsForRefund(tx, refund.id);

    // The REFUND echo row (B6): /admin/payments must be able to show a
    // gateway refund next to the charge it reverses. Manual and bank-transfer
    // refunds get one too, with provider MANUAL, so the transaction list is
    // complete whichever rail was used.
    const source = refund.orderPaymentId
      ? await tx.orderPayment.findUnique({ where: { id: refund.orderPaymentId }, select: { provider: true, method: true, providerOrderId: true } })
      : null;
    const echoExists = await tx.orderPayment.count({ where: { refundId: refund.id, type: "REFUND" } });
    if (echoExists === 0) {
      await tx.orderPayment.create({
        data: {
          orderId: refund.orderId,
          provider: isGatewayProvider(refund.provider) ? refund.provider! : source?.provider ?? "MANUAL",
          providerOrderId: source?.providerOrderId ?? null,
          providerPaymentId: refund.providerRefundId ?? values.reference ?? null,
          method: refund.method === "ORIGINAL" ? source?.method ?? "OTHER" : refund.method === "BANK_TRANSFER" ? "BANK_TRANSFER" : "OTHER",
          type: "REFUND",
          status: "SUCCEEDED",
          amountPaise: refund.amountPaise,
          refundId: refund.id,
          capturedAt: now,
        },
      });
    }

    // The RMA follows the refund (C4) BEFORE the order is re-derived, so the
    // now-closed return no longer counts as open.
    const advanced = await advanceReturnAfterRefund(tx, refund.id, actor);
    const applied = await applyRefundToOrder(tx, refund.id);

    const message = messageFor("COMPLETED", refund.refundNumber, refund.amountPaise, values);
    await addOrderEvent(tx, {
      orderId: refund.orderId,
      type: "REFUND",
      message,
      metadata: { refundId: refund.id, reversalEntries: reversal.entriesCreated, rma: advanced?.rmaNumber ?? null },
      actorId: actorId(actor),
    });
    await writeAudit(tx, {
      actor,
      action: "refund.complete",
      entityType: "Refund",
      entityId: refund.id,
      entityLabel: refund.refundNumber,
      summary: `${message} on ${refund.order.orderNumber}`,
      diff: {
        amountPaise: refund.amountPaise,
        method: refund.method,
        reference: values.reference ?? null,
        ledgerEntries: reversal.entriesCreated,
        paymentStatus: applied.payment.paymentStatus,
      },
      ip: input.ip ?? null,
    });

    const order = await tx.order.findUniqueOrThrow({
      where: { id: refund.orderId },
      select: {
        id: true,
        orderNumber: true,
        guestEmail: true,
        customer: { select: { email: true, fullName: true } },
        addresses: { select: { type: true, fullName: true, email: true } },
      },
    });
    const contact = contactFor(order);
    if (contact.email) {
      await emitEvent(
        "refund.completed",
        {
          refundId: refund.id,
          refundNumber: refund.refundNumber,
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: contact.name,
          customerEmail: contact.email,
          amountText: formatPaise(refund.amountPaise),
          method: REFUND_METHOD_META[refund.method as RefundMethod].label,
        },
        tx,
      );
    }

    return {
      refundId: refund.id,
      refundNumber: refund.refundNumber,
      orderId: refund.orderId,
      orderNumber: refund.order.orderNumber,
      fromStatus: refund.status as RefundStatus,
      toStatus: "COMPLETED" as RefundStatus,
      providerRefundId: refund.providerRefundId,
      gatewayPending: false,
    };
  });

  return outcome;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function addRefundNote(input: {
  refundId: string;
  message: string;
  actor: RefundActor;
  ip?: string | null;
}): Promise<{ refundId: string }> {
  return runRefundTx(async (tx) => {
    const refund = await loadRefund(tx, input.refundId);
    const line = `${new Date().toISOString()} · ${input.actor.email}: ${input.message}`;
    await tx.refund.update({ where: { id: refund.id }, data: { notes: appendNote(refund.notes, line) } });
    await addOrderEvent(tx, {
      orderId: refund.orderId,
      type: "REFUND",
      message: `Note on refund ${refund.refundNumber}: ${input.message}`,
      isInternal: true,
      metadata: { refundId: refund.id },
      actorId: actorId(input.actor),
    });
    await writeAudit(tx, {
      actor: input.actor,
      action: "refund.note",
      entityType: "Refund",
      entityId: refund.id,
      entityLabel: refund.refundNumber,
      summary: `Note on refund ${refund.refundNumber}`,
      diff: { length: input.message.length },
      ip: input.ip ?? null,
    });
    return { refundId: refund.id };
  });
}

/**
 * Re-derive the order after a refund write made outside this module (a
 * webhook, a script). Exported so nobody has to reach into orders/derived.
 */
export function syncOrderAfterRefund(tx: Db, orderId: string) {
  return recomputeOrderDerivedStatus(tx, orderId);
}
