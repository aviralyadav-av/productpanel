import type { Prisma, PrismaClient } from "@prisma/client";

import { derivePaymentStatus, roundHalfUp } from "@/features/finance/math";
import {
  generatePayout,
  markEarningsAvailable,
  nextNumber,
  recomputeSellerBalance,
  reverseEarningsForRefund,
  transitionPayout,
} from "@/features/finance/service";
import type { SeedContext } from "./context";
import { formatInr } from "../lib/money";
import { addDays, addHours, addMinutes, createRng, daysAgo } from "../lib/rng";
import { demoId, mediaId, mediaUrlOf, state, transaction, type Tx } from "../lib/state";

/**
 * Returns, refunds, ledger availability, payouts, counters and sequences
 * (blueprint §12, §14.B4-B6, C4, C7, C8).
 *
 * Ten RMAs walk the C4 state machine to different resting points; six refunds
 * cover RMA-linked and order-level cases in several statuses. COMPLETED
 * refunds reverse earnings through `reverseEarningsForRefund`; the QC_PASSED
 * restock movement is applied by demo-stock.ts. Then the hold expires for older
 * deliveries (`markEarningsAvailable`), one seller is paid out end to end
 * (PENDING → APPROVED → PROCESSING → PAID) and another has a statement
 * waiting, counters are recomputed and every sequence is moved past the
 * highest seq so live inserts never collide with demo numbers.
 */

type Candidate = {
  id: string;
  quantity: number;
  lineTotalPaise: number;
  variantId: string | null;
  sellerId: string | null;
  deliveredAt: Date;
  titleSnapshot: string;
  order: {
    id: string;
    orderNumber: string;
    customerId: string | null;
    paymentMethod: string;
    totalPaise: number;
    shippingPaise: number;
    itemCount: number;
    payments: Array<{ id: string; providerPaymentId: string | null }>;
  };
};

type Terminal =
  | "REQUESTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "PICKUP_SCHEDULED"
  | "RECEIVED"
  | "REFUND_INITIATED"
  | "REFUND_COMPLETED"
  | "REJECTED"
  | "QC_FAILED"
  | "CANCELLED";

type RmaSpec = {
  n: number;
  terminal: Terminal;
  reason: string;
  detail: string;
  requestedResolution: "REFUND" | "REPLACEMENT";
  /** Days the line must have been delivered for the whole path to fit before now. */
  minAgeDays: number;
  paymentMethod?: "COD" | "ONLINE";
  singleLine?: boolean;
  withImages?: boolean;
  refund?: { n: number; status: "PENDING" | "COMPLETED" };
};

const RMAS: RmaSpec[] = [
  { n: 1, terminal: "REQUESTED", reason: "SIZE_ISSUE", detail: "The M is too tight across the chest; I would like to return it.", requestedResolution: "REFUND", minAgeDays: 2 },
  { n: 2, terminal: "UNDER_REVIEW", reason: "NOT_AS_DESCRIBED", detail: "The colour is much darker than the photos.", requestedResolution: "REFUND", minAgeDays: 3, withImages: true },
  { n: 3, terminal: "APPROVED", reason: "CHANGED_MIND", detail: "Ordered two by mistake.", requestedResolution: "REFUND", minAgeDays: 4 },
  { n: 4, terminal: "PICKUP_SCHEDULED", reason: "DAMAGED", detail: "Arrived with a crack along the rim.", requestedResolution: "REFUND", minAgeDays: 6, withImages: true },
  { n: 5, terminal: "RECEIVED", reason: "DEFECTIVE", detail: "The clasp does not close.", requestedResolution: "REPLACEMENT", minAgeDays: 8 },
  { n: 6, terminal: "REFUND_INITIATED", reason: "WRONG_ITEM", detail: "Received the blue one instead of red.", requestedResolution: "REFUND", minAgeDays: 10, singleLine: true, refund: { n: 1, status: "PENDING" } },
  { n: 7, terminal: "REFUND_COMPLETED", reason: "DAMAGED", detail: "Frame glass shattered in transit.", requestedResolution: "REFUND", minAgeDays: 14, paymentMethod: "ONLINE", singleLine: true, withImages: true, refund: { n: 2, status: "COMPLETED" } },
  { n: 8, terminal: "REFUND_COMPLETED", reason: "NOT_AS_DESCRIBED", detail: "Much smaller than the listed dimensions.", requestedResolution: "REFUND", minAgeDays: 14, paymentMethod: "COD", singleLine: true, refund: { n: 3, status: "COMPLETED" } },
  { n: 9, terminal: "REJECTED", reason: "CHANGED_MIND", detail: "Do not need it any more.", requestedResolution: "REFUND", minAgeDays: 12 },
  { n: 10, terminal: "QC_FAILED", reason: "CHANGED_MIND", detail: "Did not like the finish.", requestedResolution: "REFUND", minAgeDays: 16 },
];

/** Ordered path to each resting status (C4), as [status, days after requestedAt]. */
function pathTo(terminal: Terminal): Array<[string, number]> {
  const base: Array<[string, number]> = [["REQUESTED", 0]];
  switch (terminal) {
    case "REQUESTED":
      return base;
    case "UNDER_REVIEW":
      return [...base, ["UNDER_REVIEW", 0.5]];
    case "REJECTED":
      return [...base, ["UNDER_REVIEW", 0.5], ["REJECTED", 1], ["CLOSED", 1.05]];
    case "CANCELLED":
      return [...base, ["CANCELLED", 0.8]];
    case "APPROVED":
      return [...base, ["UNDER_REVIEW", 0.5], ["APPROVED", 1]];
    case "PICKUP_SCHEDULED":
      return [...base, ["UNDER_REVIEW", 0.5], ["APPROVED", 1], ["PICKUP_SCHEDULED", 1.5]];
    case "RECEIVED":
      return [...base, ["UNDER_REVIEW", 0.5], ["APPROVED", 1], ["PICKUP_SCHEDULED", 1.5], ["RECEIVED", 4]];
    case "QC_FAILED":
      return [...base, ["APPROVED", 0.7], ["PICKUP_SCHEDULED", 1.2], ["RECEIVED", 4], ["QC_FAILED", 4.5], ["CLOSED", 5]];
    case "REFUND_INITIATED":
      return [...base, ["APPROVED", 0.7], ["PICKUP_SCHEDULED", 1.2], ["RECEIVED", 4], ["QC_PASSED", 4.5], ["REFUND_INITIATED", 5]];
    case "REFUND_COMPLETED":
      return [...base, ["UNDER_REVIEW", 0.4], ["APPROVED", 0.9], ["PICKUP_SCHEDULED", 1.3], ["RECEIVED", 4], ["QC_PASSED", 4.5], ["REFUND_INITIATED", 5], ["REFUND_COMPLETED", 7], ["CLOSED", 7.05]];
  }
}

const EVENT_MESSAGES: Record<string, string> = {
  REQUESTED: "Return requested by the customer.",
  UNDER_REVIEW: "Request opened for review.",
  APPROVED: "Return approved; refund on QC pass.",
  PICKUP_SCHEDULED: "Reverse pickup scheduled with the courier.",
  RECEIVED: "Parcel received at the seller's workshop.",
  QC_PASSED: "Quality check passed - item back in stock.",
  QC_FAILED: "Quality check failed - item shows signs of use; returning to customer.",
  REFUND_INITIATED: "Refund initiated.",
  REFUND_COMPLETED: "Refund completed.",
  REJECTED: "Return rejected: outside the 7-day window for change-of-mind returns.",
  CLOSED: "Return closed.",
  CANCELLED: "Customer withdrew the request.",
};

async function loadCandidates(db: PrismaClient, now: Date): Promise<Candidate[]> {
  const rows = await db.orderItem.findMany({
    where: {
      orderId: { startsWith: "demo_order_" },
      sellerId: { not: null },
      status: "ACTIVE",
      deliveredAt: { not: null, lte: daysAgo(now, 1) },
      order: { status: "DELIVERED" },
      returnRequests: { none: {} },
    },
    select: {
      id: true,
      quantity: true,
      lineTotalPaise: true,
      variantId: true,
      sellerId: true,
      deliveredAt: true,
      titleSnapshot: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          customerId: true,
          paymentMethod: true,
          totalPaise: true,
          shippingPaise: true,
          _count: { select: { items: true } },
          payments: { where: { status: "SUCCEEDED", type: "CHARGE", provider: "MOCK" }, select: { id: true, providerPaymentId: true } },
        },
      },
    },
    orderBy: { deliveredAt: "asc" },
  });
  return rows
    .filter((row) => row.deliveredAt)
    .map((row) => ({
      id: row.id,
      quantity: row.quantity,
      lineTotalPaise: row.lineTotalPaise,
      variantId: row.variantId,
      sellerId: row.sellerId,
      deliveredAt: row.deliveredAt as Date,
      titleSnapshot: row.titleSnapshot,
      order: { ...row.order, itemCount: row.order._count.items },
    }));
}

async function writeRefund(
  tx: Tx,
  input: {
    id: string;
    orderId: string;
    orderNumber: string;
    returnRequestId: string | null;
    orderItemId: string | null;
    amountPaise: number;
    status: "PENDING" | "APPROVED" | "PROCESSING" | "COMPLETED" | "FAILED";
    method: "ORIGINAL" | "BANK_TRANSFER" | "MANUAL";
    sourcePaymentId: string | null;
    providerRefundSuffix: string;
    reason: string;
    at: Date;
    completedAt: Date | null;
    actorId: string | null;
    failureReason?: string;
  },
): Promise<void> {
  const { seq, number } = await nextNumber(tx, "Refund");
  const online = input.method === "ORIGINAL";
  await tx.refund.create({
    data: {
      id: input.id,
      seq,
      refundNumber: number,
      orderId: input.orderId,
      returnRequestId: input.returnRequestId,
      orderPaymentId: input.sourcePaymentId,
      amountPaise: input.amountPaise,
      reason: input.reason,
      method: input.method,
      status: input.status,
      provider: online ? "MOCK" : input.method === "BANK_TRANSFER" ? "MANUAL" : null,
      providerRefundId: online && input.status === "COMPLETED" ? `rfnd_demo_${input.providerRefundSuffix}` : null,
      failureReason: input.failureReason ?? null,
      notes: input.method === "BANK_TRANSFER" ? "NEFT to the customer's bank account (COD order)." : null,
      initiatedById: input.actorId,
      approvedById: input.status === "PENDING" ? null : input.actorId,
      processedAt: input.status === "PROCESSING" || input.status === "COMPLETED" || input.status === "FAILED" ? addHours(input.at, 4) : null,
      completedAt: input.completedAt,
      createdAt: input.at,
    },
  });
  const events: Prisma.OrderEventCreateManyInput[] = [
    { orderId: input.orderId, type: "REFUND", message: `Refund ${number} of ${formatInr(input.amountPaise)} created (${input.method.toLowerCase().replace("_", " ")})`, createdAt: input.at, actorId: input.actorId, metadata: { refundId: input.id } },
  ];
  if (input.status === "COMPLETED" && input.completedAt) {
    if (online) {
      // F3: the gateway's refund echo is an OrderPayment of type REFUND pointing at the Refund.
      await tx.orderPayment.create({
        data: {
          orderId: input.orderId,
          provider: "MOCK",
          providerOrderId: null,
          providerPaymentId: `rfnd_demo_${input.providerRefundSuffix}`,
          method: "UPI",
          type: "REFUND",
          status: "SUCCEEDED",
          amountPaise: input.amountPaise,
          rawPayload: { mock: true, refundNumber: number },
          refundId: input.id,
          capturedAt: input.completedAt,
          createdAt: input.completedAt,
          updatedAt: input.completedAt,
        },
      });
    }
    await reverseEarningsForRefund(tx, input.id);
    events.push({ orderId: input.orderId, type: "REFUND", message: `Refund ${number} completed`, createdAt: input.completedAt, metadata: { refundId: input.id } });

    // B6 derivation in the same transaction as the refund change.
    const paid = await tx.orderPayment.aggregate({ where: { orderId: input.orderId, status: "SUCCEEDED", type: { in: ["CHARGE", "CAPTURE"] } }, _sum: { amountPaise: true } });
    const refunded = await tx.refund.aggregate({ where: { orderId: input.orderId, status: "COMPLETED" }, _sum: { amountPaise: true } });
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, select: { status: true, totalPaise: true } });
    const refundedPaise = refunded._sum.amountPaise ?? 0;
    await tx.order.update({
      where: { id: input.orderId },
      data: {
        refundedPaise,
        paymentStatus: derivePaymentStatus({ paidPaise: paid._sum.amountPaise ?? 0, refundedPaise, totalPaise: order.totalPaise, orderStatus: order.status }),
      },
    });
    if (input.orderItemId) {
      await tx.orderItem.update({ where: { id: input.orderItemId }, data: { refundedPaise: { increment: input.amountPaise }, status: "REFUNDED" } });
    }
  } else if (input.status === "FAILED") {
    events.push({ orderId: input.orderId, type: "REFUND", message: `Refund ${number} failed: ${input.failureReason ?? "unknown"}`, createdAt: addHours(input.at, 5), isInternal: true, actorId: input.actorId });
  }
  await tx.orderEvent.createMany({ data: events });
}

export async function seedDemoReturns(db: PrismaClient, ctx: SeedContext): Promise<void> {
  const rng = createRng("returns");
  const now = state.now;
  const actor = ctx.adminUserId;
  const partners = await db.shippingPartner.findMany({ where: { isActive: true }, select: { id: true, code: true } });
  const candidates = await loadCandidates(db, now);
  const used = new Set<string>();
  const cancelledPrepaid = await db.order.findMany({
    where: { id: { startsWith: "demo_order_" }, status: "CANCELLED", paymentStatus: "PAID", refunds: { none: {} } },
    select: { id: true, orderNumber: true, totalPaise: true, cancelledAt: true, payments: { where: { status: "SUCCEEDED", type: "CHARGE" }, select: { id: true }, take: 1 } },
    orderBy: { cancelledAt: "asc" },
  });

  let rmaCreated = 0;
  let refundCreated = 0;

  // ---- returns (C4) ------------------------------------------------------------------------------
  for (const spec of RMAS) {
    const id = demoId("rma", spec.n);
    if (await db.returnRequest.findUnique({ where: { id }, select: { id: true } })) {
      continue;
    }
    const candidate = candidates.find(
      (item) =>
        !used.has(item.order.id) &&
        item.deliveredAt <= daysAgo(now, spec.minAgeDays) &&
        (!spec.paymentMethod || item.order.paymentMethod === spec.paymentMethod) &&
        (!spec.singleLine || item.order.itemCount === 1),
    );
    if (!candidate) {
      ctx.log(`warning: no delivered line qualifies for RMA ${spec.n} (${spec.terminal}); skipped`);
      continue;
    }
    used.add(candidate.order.id);

    const requestedAt = addHours(candidate.deliveredAt, rng.float(12, 60));
    const path = pathTo(spec.terminal);
    const at = (status: string) => addDays(requestedAt, path.find(([step]) => step === status)?.[1] ?? 0);
    const finalStatus = path[path.length - 1][0];
    const quantity = 1;
    // B6: the line's share, plus shipping when every line comes back or the
    // seller is at fault; the COD fee is never refunded after dispatch.
    const fullReturn = candidate.order.itemCount === 1 && quantity === candidate.quantity;
    const sellerFault = ["DAMAGED", "DEFECTIVE", "WRONG_ITEM", "NOT_AS_DESCRIBED", "LATE_DELIVERY"].includes(spec.reason);
    const refundAmount = roundHalfUp(candidate.lineTotalPaise, quantity, candidate.quantity) + (fullReturn || sellerFault ? candidate.order.shippingPaise : 0);
    const has = (status: string) => path.some(([step]) => step === status);
    const partner = rng.pick(partners);
    const open = !["CLOSED", "CANCELLED", "REJECTED"].includes(finalStatus);

    await transaction(db, async (tx: Tx) => {
      const { seq, number: rmaNumber } = await nextNumber(tx, "ReturnRequest");
      await tx.returnRequest.create({
        data: {
          id,
          seq,
          rmaNumber,
          orderId: candidate.order.id,
          orderItemId: candidate.id,
          customerId: candidate.order.customerId,
          sellerId: candidate.sellerId,
          quantity,
          reason: spec.reason,
          reasonDetail: spec.detail,
          imageUrls: spec.withImages ? [mediaUrlOf(mediaId("upload:2")) ?? ""].filter(Boolean) : [],
          status: finalStatus,
          requestedResolution: spec.requestedResolution,
          resolution: has("APPROVED") ? "REFUND" : null,
          qcDisposition: has("QC_FAILED") ? "RETURN_TO_CUSTOMER" : null,
          rejectionReason: has("REJECTED") ? "Change-of-mind returns must be raised within 7 days of delivery." : null,
          pickupScheduledAt: has("PICKUP_SCHEDULED") ? addDays(at("PICKUP_SCHEDULED"), 2) : null,
          pickupPartnerId: has("PICKUP_SCHEDULED") ? partner.id : null,
          pickupTrackingNumber: has("PICKUP_SCHEDULED") ? `${partner.code.slice(0, 3)}R${rng.int(10000000, 99999999)}` : null,
          receivedAt: has("RECEIVED") ? at("RECEIVED") : null,
          qcNote: has("QC_PASSED") ? "Unused, tags intact, original packaging." : has("QC_FAILED") ? "Scratches on the base; item was used." : null,
          handledById: path.length > 1 ? actor : null,
          requestedAt,
          resolvedAt: open ? null : at(finalStatus),
          createdAt: requestedAt,
        },
      });
      await tx.returnEvent.createMany({
        data: path.map(([status, days], index) => ({
          returnRequestId: id,
          fromStatus: index === 0 ? null : path[index - 1][0],
          toStatus: status,
          message: EVENT_MESSAGES[status] ?? status,
          isInternal: status === "QC_FAILED" || status === "QC_PASSED",
          actorId: index === 0 || status === "CANCELLED" ? null : actor,
          createdAt: addDays(requestedAt, days),
        })),
      });
      const orderEvents: Prisma.OrderEventCreateManyInput[] = [
        { orderId: candidate.order.id, type: "RETURN", message: `Return ${rmaNumber} requested for ${candidate.titleSnapshot} (${spec.reason.toLowerCase().replace("_", " ")})`, createdAt: requestedAt, metadata: { returnRequestId: id } },
      ];
      if (has("APPROVED")) orderEvents.push({ orderId: candidate.order.id, type: "RETURN", message: `Return ${rmaNumber} approved`, createdAt: at("APPROVED"), actorId: actor, metadata: { returnRequestId: id } });
      if (has("REJECTED")) orderEvents.push({ orderId: candidate.order.id, type: "RETURN", message: `Return ${rmaNumber} rejected`, createdAt: at("REJECTED"), actorId: actor, metadata: { returnRequestId: id } });

      // C4: returnedQty increments at QC_PASSED. The C3 restock movement is
      // written by demo-stock.ts in time order with every other movement.
      let orderStatus: string | null = open ? "RETURN_REQUESTED" : null;
      let returnStatus = open ? "REQUESTED" : "NONE";
      if (has("QC_PASSED")) {
        await tx.orderItem.update({ where: { id: candidate.id }, data: { returnedQty: { increment: quantity }, status: "RETURNED" } });
        returnStatus = fullReturn ? "FULL" : "PARTIAL";
        orderStatus = fullReturn ? "RETURNED" : "DELIVERED";
        orderEvents.push({ orderId: candidate.order.id, type: "RETURN", message: `Return ${rmaNumber} passed quality check - ${quantity} unit restocked`, createdAt: at("QC_PASSED"), actorId: actor, isInternal: true, metadata: { returnRequestId: id } });
        await tx.order.update({ where: { id: candidate.order.id }, data: { returnedPaise: { increment: refundAmount } } });
      }
      await tx.orderEvent.createMany({ data: orderEvents });
      await tx.order.update({ where: { id: candidate.order.id }, data: { returnStatus, ...(orderStatus ? { status: orderStatus } : {}) } });

      // ---- the refund that belongs to this RMA (B6) --------------------------------------------
      if (spec.refund) {
        const online = candidate.order.paymentMethod === "ONLINE";
        const completedAt = spec.refund.status === "COMPLETED" ? at("REFUND_COMPLETED") : null;
        await writeRefund(tx, {
          id: demoId("refund", spec.refund.n),
          orderId: candidate.order.id,
          orderNumber: candidate.order.orderNumber,
          returnRequestId: id,
          orderItemId: candidate.id,
          amountPaise: refundAmount,
          status: spec.refund.status,
          method: online ? "ORIGINAL" : "BANK_TRANSFER",
          sourcePaymentId: candidate.order.payments[0]?.id ?? null,
          providerRefundSuffix: String(spec.refund.n).padStart(2, "0"),
          reason: `Return ${rmaNumber}: ${spec.reason.toLowerCase().replace("_", " ")}`,
          at: at("REFUND_INITIATED"),
          completedAt,
          actorId: actor,
        });
        refundCreated += 1;
        if (completedAt && fullReturn) {
          await tx.order.update({ where: { id: candidate.order.id }, data: { status: "REFUNDED" } });
        }
      }
    });
    rmaCreated += 1;
  }

  // ---- order-level refunds for cancelled prepaid orders (C2) ----------------------------------------
  const orderLevel: Array<{ n: number; status: "COMPLETED" | "PROCESSING" | "FAILED"; failureReason?: string }> = [
    { n: 4, status: "COMPLETED" },
    { n: 5, status: "PROCESSING" },
    { n: 6, status: "FAILED", failureReason: "Gateway rejected the refund: source transaction older than the provider's refund window." },
  ];
  for (const [index, spec] of orderLevel.entries()) {
    const id = demoId("refund", spec.n);
    if (await db.refund.findUnique({ where: { id }, select: { id: true } })) continue;
    let order = cancelledPrepaid[index];
    let amountPaise = order?.totalPaise ?? 0;
    let reason = "Order cancelled after payment";
    let at = addHours(order?.cancelledAt ?? daysAgo(now, 5), 2);
    if (!order || !order.payments[0]) {
      // Not enough cancelled prepaid orders: fall back to a goodwill refund of
      // the shipping charge on a delivered online order (late delivery).
      const goodwill = await db.order.findFirst({
        where: { id: { startsWith: "demo_order_" }, status: "DELIVERED", paymentMethod: "ONLINE", shippingPaise: { gt: 0 }, refunds: { none: {} }, returnRequests: { none: {} } },
        select: { id: true, orderNumber: true, totalPaise: true, shippingPaise: true, deliveredAt: true, cancelledAt: true, payments: { where: { status: "SUCCEEDED", type: "CHARGE" }, select: { id: true }, take: 1 } },
        orderBy: { deliveredAt: "asc" },
      });
      if (!goodwill || !goodwill.payments[0]) {
        ctx.log(`warning: no order qualifies for refund ${spec.n}; skipped`);
        continue;
      }
      order = goodwill;
      amountPaise = goodwill.shippingPaise;
      reason = "Goodwill refund of the shipping charge - delivered late";
      at = addHours(goodwill.deliveredAt ?? daysAgo(now, 5), 6);
    }
    const chosen = order;
    await transaction(db, (tx) =>
      writeRefund(tx, {
        id,
        orderId: chosen.id,
        orderNumber: chosen.orderNumber,
        returnRequestId: null,
        orderItemId: null,
        amountPaise,
        status: spec.status,
        method: "ORIGINAL",
        sourcePaymentId: chosen.payments[0].id,
        providerRefundSuffix: String(spec.n).padStart(2, "0"),
        reason,
        at,
        completedAt: spec.status === "COMPLETED" ? addHours(at, 30) : null,
        actorId: actor,
        failureReason: spec.failureReason,
      }),
    );
    refundCreated += 1;
  }
  ctx.log(`returns created: ${rmaCreated}, refunds created: ${refundCreated}`);

  // ---- ledger: the hold has passed for older deliveries (B4) -----------------------------------------
  const released = await markEarningsAvailable(now);
  ctx.log(`ledger entries made available: ${released.updated} across ${released.sellerIds.length} sellers`);

  // ---- payouts (B5): one PAID end to end, one PENDING ------------------------------------------------
  const payoutPlan: Array<{ seller: number; pay: boolean }> = [
    { seller: 1, pay: true },
    { seller: 2, pay: false },
  ];
  for (const plan of payoutPlan) {
    const sellerId = demoId("seller", plan.seller);
    if ((await db.sellerPayout.count({ where: { sellerId } })) > 0) continue;
    await transaction(db, async (tx) => {
      // A few minutes past "now": refund reversals written moments ago carry
      // availableAt = wall clock, and the statement must sweep them in too.
      const result = await generatePayout(tx, { sellerId, periodTo: addMinutes(now, 5), actorId: actor, method: "BANK_TRANSFER", notes: "Weekly payout run (demo)." });
      if (result.held) {
        ctx.log(`payout for seller ${plan.seller} held: net ${formatInr(result.netPaise)} ≤ minimum ${formatInr(result.minPayoutPaise)}`);
        return;
      }
      const createdAt = daysAgo(now, plan.pay ? 3 : 0.2);
      if (plan.pay) {
        await transitionPayout(tx, { payoutId: result.payout.id, toStatus: "APPROVED", actor: { id: actor ?? "system" } });
        await transitionPayout(tx, { payoutId: result.payout.id, toStatus: "PROCESSING", actor: { id: actor ?? "system" } });
        await transitionPayout(tx, { payoutId: result.payout.id, toStatus: "PAID", actor: { id: actor ?? "system" }, referenceNumber: "UTR-DEMO-000001" });
        await tx.sellerPayout.update({
          where: { id: result.payout.id },
          data: { createdAt, approvedAt: addHours(createdAt, 3), processedAt: addHours(createdAt, 20), paidAt: addHours(createdAt, 26) },
        });
        await tx.sellerLedgerEntry.updateMany({ where: { payoutId: result.payout.id, type: "PAYOUT" }, data: { createdAt: addHours(createdAt, 26), availableAt: addHours(createdAt, 26) } });
      } else {
        await tx.sellerPayout.update({ where: { id: result.payout.id }, data: { createdAt } });
      }
      ctx.log(`payout ${result.payout.payoutNumber} for seller ${plan.seller}: ${plan.pay ? "PAID" : "PENDING"} · net ${formatInr(result.payout.netPaise)} over ${result.entryCount} entries`);
    });
  }

  // ---- balances for every demo seller (B4) -----------------------------------------------------------
  await transaction(db, async (tx) => {
    for (const seller of state.sellers) await recomputeSellerBalance(tx, seller.id);
  });

  // ---- counters (C7) -------------------------------------------------------------------------------
  const customerAgg = await db.order.groupBy({
    by: ["customerId"],
    where: { id: { startsWith: "demo_order_" }, customerId: { not: null }, status: { notIn: ["CANCELLED", "FAILED"] } },
    _count: { _all: true },
    _sum: { totalPaise: true, refundedPaise: true },
    _min: { placedAt: true },
    _max: { placedAt: true },
  });
  for (const customer of state.customers) {
    const row = customerAgg.find((item) => item.customerId === customer.id);
    await db.customer.update({
      where: { id: customer.id },
      data: {
        orderCount: row?._count._all ?? 0,
        totalSpentPaise: (row?._sum.totalPaise ?? 0) - (row?._sum.refundedPaise ?? 0),
        firstOrderAt: row?._min.placedAt ?? null,
        lastOrderAt: row?._max.placedAt ?? null,
      },
    });
  }
  const productAgg = await db.orderItem.groupBy({
    by: ["productId"],
    where: { orderId: { startsWith: "demo_order_" }, productId: { not: null }, order: { status: { notIn: ["CANCELLED", "FAILED"] } } },
    _sum: { quantity: true },
  });
  for (const product of state.products) {
    const row = productAgg.find((item) => item.productId === product.id);
    await db.product.update({ where: { id: product.id }, data: { orderCount: row?._sum.quantity ?? 0 } });
  }

  // ---- sequences (C8, G3): live inserts continue after the highest demo seq -----------------------------
  for (const [table, floor] of [["Order", 10000], ["Shipment", 0], ["ReturnRequest", 0], ["Refund", 0], ["SellerPayout", 0]] as const) {
    await db.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${table}"', 'seq'), GREATEST(COALESCE((SELECT MAX(seq) FROM "${table}"), 0), ${floor}) + 1, false)`,
    );
  }
  ctx.log("sequences advanced past the highest seq for Order, Shipment, ReturnRequest, Refund, SellerPayout");
}
