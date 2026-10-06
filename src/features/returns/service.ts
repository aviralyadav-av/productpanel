import type { Prisma } from "@prisma/client";

import { conflict, notFound, validationError } from "@/lib/api/errors";
import { diffOf, writeAudit } from "@/lib/audit";
import {
  canTransitionReturn,
  QC_DISPOSITION_META,
  RETURN_REASON_META,
  RETURN_REQUEST_STATUS_META,
  SELLER_FAULT_RETURN_REASONS,
  type QcDisposition,
  type ReturnReason,
  type ReturnRequestStatus,
  type ReturnResolution,
} from "@/lib/enums";
import { formatIstDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { applyStockMovement, restock, type StockChange } from "@/features/inventory/service";
import { nextNumber, recomputeSellerBalance } from "@/features/finance/service";
import { readSettingBoolean, readSettingNumber } from "@/features/finance/settings-reader";
import { emitEvent } from "@/features/notifications/service";
import { recomputeOrderDerivedStatus } from "@/features/orders/derived";
import { addOrderEvent, contactFor, lockOrder, orderUrlFor } from "@/features/orders/shared";
import { createRefundInTx, refundCapFor } from "@/features/refunds/service";

import { addReturnEvent, runReturnTx, type Db, type ReturnActor } from "./events";
import type { BulkReturnsValues, ReturnNoteValues, ReturnTransitionValues } from "./schemas";

/**
 * The RMA workflow (blueprint §14.C4, C3, B5, B6, §10, E3).
 *
 * One entry point - `transitionReturn` - drives every move in the flow, so a
 * status can never be set without its side effects: QC_PASSED is the only
 * place stock comes back, RECEIVED is the only place a seller is charged for
 * the pickup, and REFUND_INITIATED is the only place a refund is born from an
 * RMA. After each move the order's derived state is recomputed, because
 * `Order.status` / `returnStatus` are functions of the RMAs, never set by hand.
 *
 * Stock changes are returned rather than settled here: `afterStockChange`
 * sends low-stock notifications and must run after the transaction commits.
 */

export type { Db, ReturnActor } from "./events";

export type ReturnTransitionResult = {
  returnRequestId: string;
  rmaNumber: string;
  orderId: string;
  orderNumber: string;
  fromStatus: ReturnRequestStatus;
  toStatus: ReturnRequestStatus;
  stockChanges: StockChange[];
  refund: { id: string; refundNumber: string; amountPaise: number } | null;
  replacementShipmentId: string | null;
};

const RMA_LOAD = {
  id: true,
  rmaNumber: true,
  orderId: true,
  orderItemId: true,
  sellerId: true,
  customerId: true,
  quantity: true,
  reason: true,
  status: true,
  requestedResolution: true,
  resolution: true,
  qcDisposition: true,
  pickupScheduledAt: true,
  pickupPartnerId: true,
  pickupTrackingNumber: true,
  receivedAt: true,
  handledById: true,
  order: {
    select: {
      id: true,
      orderNumber: true,
      guestEmail: true,
      customer: { select: { email: true, fullName: true } },
      addresses: { select: { type: true, fullName: true, email: true } },
    },
  },
  orderItem: {
    select: {
      id: true,
      variantId: true,
      quantity: true,
      returnedQty: true,
      status: true,
      titleSnapshot: true,
      lineTotalPaise: true,
      sellerId: true,
    },
  },
} as const;

type RmaRow = Prisma.ReturnRequestGetPayload<{ select: typeof RMA_LOAD }>;

async function loadRma(tx: Db, id: string): Promise<RmaRow> {
  const rma = await tx.returnRequest.findUnique({ where: { id }, select: RMA_LOAD });
  if (!rma) throw notFound("Return request");
  return rma;
}

function actorIdOf(actor: ReturnActor): string | null {
  return actor.id || null;
}

function label(status: string): string {
  return RETURN_REQUEST_STATUS_META[status as ReturnRequestStatus]?.label ?? status;
}

// ---------------------------------------------------------------------------
// Intake (public POST /api/v1/returns and the admin equivalent)
// ---------------------------------------------------------------------------

export type CreateReturnInput = {
  orderId: string;
  orderItemId: string;
  quantity: number;
  reason: ReturnReason;
  reasonDetail?: string | null;
  requestedResolution?: ReturnResolution | null;
  imageUrls?: readonly string[];
  /** Null for a customer-initiated request; set when an operator files it. */
  actor?: ReturnActor | null;
  source: "STOREFRONT" | "ADMIN";
};

export type CreateReturnResult = {
  returnRequestId: string;
  rmaNumber: string;
  status: ReturnRequestStatus;
  orderNumber: string;
};

/**
 * Units still returnable on a line: what was bought, minus what has already
 * come back, minus what other open RMAs have claimed (C4). The last term is
 * what stops a customer opening five RMAs for the same single unit.
 */
export async function returnableQuantity(
  tx: Db,
  orderItemId: string,
  options: { excludeReturnRequestId?: string } = {},
): Promise<{ quantity: number; returnedQty: number; openQty: number; returnable: number }> {
  const item = await tx.orderItem.findUnique({
    where: { id: orderItemId },
    select: { quantity: true, returnedQty: true },
  });
  if (!item) throw notFound("Order line");

  const open = await tx.returnRequest.aggregate({
    where: {
      orderItemId,
      id: options.excludeReturnRequestId ? { not: options.excludeReturnRequestId } : undefined,
      status: { in: ["REQUESTED", "UNDER_REVIEW", "APPROVED", "PICKUP_SCHEDULED", "RECEIVED"] },
    },
    _sum: { quantity: true },
  });
  const openQty = open._sum.quantity ?? 0;
  return {
    quantity: item.quantity,
    returnedQty: item.returnedQty,
    openQty,
    returnable: Math.max(0, item.quantity - item.returnedQty - openQty),
  };
}

/** Days since the line was delivered, or null when it never was. */
export function daysSinceDelivery(deliveredAt: Date | null, now = new Date()): number | null {
  if (!deliveredAt) return null;
  return Math.floor((now.getTime() - deliveredAt.getTime()) / 86_400_000);
}

/**
 * Create an RMA inside the caller's transaction. The window is checked from
 * `OrderItem.deliveredAt` (C1: per line, not per order), so a two-parcel order
 * gives each parcel its own clock.
 */
export async function createReturnRequestInTx(tx: Db, input: CreateReturnInput): Promise<CreateReturnResult> {
  const item = await tx.orderItem.findUnique({
    where: { id: input.orderItemId },
    select: { id: true, orderId: true, sellerId: true, deliveredAt: true, status: true, titleSnapshot: true, quantity: true },
  });
  if (!item || item.orderId !== input.orderId) throw notFound("Order line");
  if (item.status === "CANCELLED") throw conflict("That line was cancelled and cannot be returned.");

  const order = await tx.order.findUniqueOrThrow({
    where: { id: input.orderId },
    select: { id: true, orderNumber: true, customerId: true },
  });

  const [enabled, windowDays] = await Promise.all([
    readSettingBoolean(tx, "returns.enabled"),
    readSettingNumber(tx, "returns.window_days"),
  ]);
  if (!enabled && input.source === "STOREFRONT") {
    throw conflict("Returns are not being accepted at the moment.");
  }

  const age = daysSinceDelivery(item.deliveredAt);
  if (age === null) throw conflict("That line has not been delivered yet, so it cannot be returned.");
  if (input.source === "STOREFRONT" && age > windowDays) {
    throw conflict(`The ${windowDays}-day return window for this item closed ${age - windowDays} day(s) ago.`);
  }

  const capacity = await returnableQuantity(tx, item.id);
  if (input.quantity > capacity.returnable) {
    throw validationError(
      {
        quantity:
          capacity.returnable === 0
            ? "Every unit of this line is already returned or has an open request."
            : `At most ${capacity.returnable} unit(s) can be returned.`,
      },
      "That quantity is not available to return.",
    );
  }

  const { number } = await nextNumber(tx, "ReturnRequest");
  const created = await tx.returnRequest.create({
    data: {
      rmaNumber: number,
      orderId: order.id,
      orderItemId: item.id,
      customerId: order.customerId,
      // Snapshot the seller: the line may later lose its seller (SetNull) and
      // the pickup charge still has to know whom it belongs to.
      sellerId: item.sellerId,
      quantity: input.quantity,
      reason: input.reason,
      reasonDetail: input.reasonDetail ?? null,
      requestedResolution: input.requestedResolution ?? null,
      imageUrls: [...(input.imageUrls ?? [])],
      status: "REQUESTED",
      handledById: input.actor ? actorIdOf(input.actor) : null,
    },
    select: { id: true, rmaNumber: true, status: true },
  });

  await addReturnEvent(tx, {
    returnRequestId: created.id,
    toStatus: "REQUESTED",
    message: `Return requested for ${input.quantity} × ${item.titleSnapshot} · ${RETURN_REASON_META[input.reason].label}`,
    isInternal: false,
    actorId: input.actor ? actorIdOf(input.actor) : null,
  });
  await addOrderEvent(tx, {
    orderId: order.id,
    type: "RETURN",
    message: `Return ${created.rmaNumber} requested for ${input.quantity} × ${item.titleSnapshot} (${RETURN_REASON_META[input.reason].label})`,
    metadata: { returnRequestId: created.id, orderItemId: item.id, quantity: input.quantity },
    actorId: input.actor ? actorIdOf(input.actor) : null,
  });

  if (input.actor) {
    await writeAudit(tx, {
      actor: input.actor,
      action: "return.create",
      entityType: "ReturnRequest",
      entityId: created.id,
      entityLabel: created.rmaNumber,
      summary: `Filed return ${created.rmaNumber} on ${order.orderNumber}`,
      diff: { quantity: input.quantity, reason: input.reason, requestedResolution: input.requestedResolution ?? null },
    });
  }

  await emitEvent(
    "return.requested",
    {
      returnRequestId: created.id,
      rmaNumber: created.rmaNumber,
      orderNumber: order.orderNumber,
      reason: RETURN_REASON_META[input.reason].label,
      quantity: input.quantity,
    },
    tx,
  );

  await recomputeOrderDerivedStatus(tx, order.id);

  return {
    returnRequestId: created.id,
    rmaNumber: created.rmaNumber,
    status: created.status as ReturnRequestStatus,
    orderNumber: order.orderNumber,
  };
}

export function createReturnRequest(input: CreateReturnInput): Promise<CreateReturnResult> {
  return runReturnTx(async (tx) => {
    if (!(await lockOrder(tx, input.orderId))) throw notFound("Order");
    return createReturnRequestInTx(tx, input);
  });
}

// ---------------------------------------------------------------------------
// The pickup fee (B5)
// ---------------------------------------------------------------------------

export function isSellerFault(reason: string): boolean {
  return (SELLER_FAULT_RETURN_REASONS as readonly string[]).includes(reason);
}

/**
 * B5: a seller-fault return costs the seller the pickup. The CHARGE row is
 * written with `orderItemId: null` on purpose - the partial unique index
 * `SellerLedgerEntry_item_type_once` allows only ONE CHARGE per order item,
 * and that slot already belongs to the marketplace charges recorded at
 * delivery. The RMA number in the description is the idempotency key.
 */
async function chargePickupFee(tx: Db, rma: RmaRow): Promise<number> {
  if (!rma.sellerId || !isSellerFault(rma.reason)) return 0;
  const feePaise = await readSettingNumber(tx, "returns.pickup_fee_paise");
  if (feePaise <= 0) return 0;

  const marker = `[${rma.rmaNumber}]`;
  const already = await tx.sellerLedgerEntry.count({
    where: { sellerId: rma.sellerId, type: "CHARGE", description: { contains: marker } },
  });
  if (already > 0) return 0;

  await tx.sellerLedgerEntry.create({
    data: {
      sellerId: rma.sellerId,
      orderId: rma.orderId,
      orderItemId: null,
      type: "CHARGE",
      amountPaise: -feePaise,
      description: `Return pickup fee ${marker} · ${RETURN_REASON_META[rma.reason as ReturnReason]?.label ?? rma.reason}`,
      status: "AVAILABLE",
      availableAt: new Date(),
    },
  });
  await recomputeSellerBalance(tx, rma.sellerId);
  return feePaise;
}

// ---------------------------------------------------------------------------
// Replacement shipment (C4)
// ---------------------------------------------------------------------------

/**
 * A replacement goes out on the SAME order as a new shipment plus a SALE
 * movement (C3) - the customer is not charged again, so there is no second
 * order and no second reservation.
 *
 * It is created here rather than through `createShipmentInTx` from the orders
 * module because that helper refuses an order past OUT_FOR_DELIVERY and only
 * ships units that have never shipped; a replacement is by definition a second
 * parcel for a line that has already been delivered.
 */
async function createReplacementShipment(
  tx: Db,
  rma: RmaRow,
  actor: ReturnActor,
  values: NonNullable<ReturnTransitionValues["replacement"]>,
): Promise<{ shipmentId: string; shipmentNumber: string; stockChanges: StockChange[] }> {
  const partner = values.partnerId
    ? await tx.shippingPartner.findUnique({ where: { id: values.partnerId }, select: { id: true, name: true, trackingUrlTemplate: true } })
    : null;
  if (values.partnerId && !partner) throw validationError({ partnerId: "Unknown shipping partner." });

  const { seq, number } = await nextNumber(tx, "Shipment");
  const now = new Date();
  const trackingUrl =
    partner?.trackingUrlTemplate && values.trackingNumber
      ? partner.trackingUrlTemplate.replace("{tracking}", encodeURIComponent(values.trackingNumber))
      : null;

  const shipment = await tx.shipment.create({
    data: {
      seq,
      shipmentNumber: number,
      orderId: rma.orderId,
      partnerId: partner?.id ?? null,
      carrierName: values.carrierName ?? partner?.name ?? null,
      trackingNumber: values.trackingNumber ?? null,
      trackingUrl,
      status: "SHIPPED",
      shippedAt: now,
      note: values.note ?? `Replacement for ${rma.rmaNumber}`,
      items: { create: [{ orderItemId: rma.orderItemId, quantity: rma.quantity }] },
      events: { create: { status: "SHIPPED", message: `Replacement for ${rma.rmaNumber} handed to the courier`, occurredAt: now } },
    },
    select: { id: true, shipmentNumber: true },
  });

  const stockChanges: StockChange[] = [];
  if (rma.orderItem.variantId) {
    stockChanges.push(
      await applyStockMovement(tx, {
        variantId: rma.orderItem.variantId,
        delta: -rma.quantity,
        reservedDelta: 0,
        type: "SALE",
        reason: "RETURN_REPLACEMENT",
        note: `Replacement shipped for ${rma.rmaNumber}`,
        orderId: rma.orderId,
        actorId: actorIdOf(actor),
        // A replacement must go out even if the shelf count says zero: the
        // customer is already owed the goods.
        allowNegative: true,
      }),
    );
  }

  return { shipmentId: shipment.id, shipmentNumber: shipment.shipmentNumber, stockChanges };
}

// ---------------------------------------------------------------------------
// Transitions (C4)
// ---------------------------------------------------------------------------

function assertTarget(from: string, to: ReturnRequestStatus): void {
  if (from === to) throw conflict(`This return is already ${label(to).toLowerCase()}.`);
  if (!canTransitionReturn(from as ReturnRequestStatus, to)) {
    throw conflict(`A ${label(from).toLowerCase()} return cannot move to ${label(to).toLowerCase()}.`);
  }
}

export function transitionReturn(input: {
  returnRequestId: string;
  actor: ReturnActor;
  values: ReturnTransitionValues;
  ip?: string | null;
}): Promise<ReturnTransitionResult> {
  return runReturnTx((tx) => transitionReturnInTx(tx, input));
}

export async function transitionReturnInTx(
  tx: Db,
  input: { returnRequestId: string; actor: ReturnActor; values: ReturnTransitionValues; ip?: string | null },
): Promise<ReturnTransitionResult> {
  const { actor, values } = input;
  const rma = await loadRma(tx, input.returnRequestId);
  if (!(await lockOrder(tx, rma.orderId))) throw notFound("Order");
  assertTarget(rma.status, values.toStatus);

  const now = new Date();
  const data: Prisma.ReturnRequestUncheckedUpdateInput = { status: values.toStatus, handledById: actorIdOf(actor) };
  const stockChanges: StockChange[] = [];
  let refund: ReturnTransitionResult["refund"] = null;
  let replacementShipmentId: string | null = null;
  const notes: string[] = [];

  switch (values.toStatus) {
    case "UNDER_REVIEW":
      break;

    case "APPROVED": {
      const resolution = values.resolution ?? (rma.requestedResolution === "REPLACEMENT" ? "REPLACEMENT" : "REFUND");
      data.resolution = resolution;
      notes.push(`Resolution: ${resolution === "REFUND" ? "refund" : "replacement"}`);
      break;
    }

    case "REJECTED": {
      if (!values.rejectionReason) throw validationError({ rejectionReason: "Say why the return is being rejected." });
      data.rejectionReason = values.rejectionReason;
      data.resolvedAt = now;
      notes.push(values.rejectionReason);
      break;
    }

    case "PICKUP_SCHEDULED": {
      if (values.pickupPartnerId) {
        const partner = await tx.shippingPartner.findUnique({ where: { id: values.pickupPartnerId }, select: { id: true } });
        if (!partner) throw validationError({ pickupPartnerId: "Unknown shipping partner." });
      }
      data.pickupPartnerId = values.pickupPartnerId ?? null;
      data.pickupScheduledAt = values.pickupScheduledAt ?? now;
      data.pickupTrackingNumber = values.pickupTrackingNumber ?? null;
      notes.push(`Pickup ${formatIstDate(values.pickupScheduledAt ?? now)}${values.pickupTrackingNumber ? ` · ${values.pickupTrackingNumber}` : ""}`);
      break;
    }

    case "RECEIVED": {
      data.receivedAt = now;
      const feePaise = await chargePickupFee(tx, rma);
      if (feePaise > 0) notes.push(`Pickup fee ${formatPaise(feePaise)} charged to the seller (${RETURN_REASON_META[rma.reason as ReturnReason]?.label ?? rma.reason}).`);
      break;
    }

    case "QC_PASSED": {
      data.qcNote = values.qcNote ?? null;
      if (rma.orderItem.variantId) {
        stockChanges.push(
          await restock(tx, {
            variantId: rma.orderItem.variantId,
            quantity: rma.quantity,
            orderId: rma.orderId,
            reason: "RETURN_QC_PASSED",
            note: `${rma.rmaNumber} passed QC`,
            actorId: actorIdOf(actor),
          }),
        );
      }
      await markUnitsReturned(tx, rma);
      notes.push(`${rma.quantity} unit(s) back in stock.`);
      break;
    }

    case "QC_FAILED": {
      const disposition = values.qcDisposition;
      if (!disposition) throw validationError({ qcDisposition: "Choose what happens to the goods." });
      data.qcNote = values.qcNote ?? null;
      data.qcDisposition = disposition;
      stockChanges.push(...(await applyDisposition(tx, rma, disposition, actor)));
      notes.push(`QC failed · ${QC_DISPOSITION_META[disposition].label}`);
      break;
    }

    case "REFUND_INITIATED": {
      if (rma.status === "QC_FAILED" && rma.qcDisposition !== "PARTIAL_REFUND") {
        throw conflict("Only a partial-refund disposition leads to a refund after failed QC.");
      }
      if (rma.status === "QC_PASSED" && rma.resolution === "REPLACEMENT") {
        throw conflict("This return is being settled with a replacement, not a refund.");
      }
      const cap = await refundCapFor(tx, { orderId: rma.orderId, returnRequestId: rma.id });
      const amountPaise = values.amountPaise ?? cap.capPaise;
      if (amountPaise <= 0) {
        throw conflict("Nothing is left to refund on this order — the payment has already been returned in full.");
      }
      const created = await createRefundInTx(tx, {
        orderId: rma.orderId,
        amountPaise,
        reason: `Return ${rma.rmaNumber} · ${RETURN_REASON_META[rma.reason as ReturnReason]?.label ?? rma.reason}`,
        notes: values.note ?? null,
        method: values.refundMethod ?? null,
        returnRequestId: rma.id,
        actor,
      });
      refund = { id: created.id, refundNumber: created.refundNumber, amountPaise: created.amountPaise };
      notes.push(`Refund ${created.refundNumber} for ${formatPaise(created.amountPaise)} created.`);
      break;
    }

    case "REFUND_COMPLETED": {
      // The refunds module owns this move (it runs when the refund actually
      // settles). Setting it by hand would leave a PENDING refund behind.
      const linked = await tx.refund.findUnique({ where: { returnRequestId: rma.id }, select: { status: true, refundNumber: true } });
      if (!linked) throw conflict("No refund is linked to this RMA.");
      if (linked.status !== "COMPLETED") {
        throw conflict(`Complete refund ${linked.refundNumber} first — it is ${linked.status.toLowerCase()}.`);
      }
      break;
    }

    case "REPLACEMENT_SHIPPED": {
      if (rma.resolution !== "REPLACEMENT") throw conflict("This return was approved for a refund, not a replacement.");
      const shipment = await createReplacementShipment(tx, rma, actor, values.replacement ?? {});
      replacementShipmentId = shipment.shipmentId;
      data.replacementShipmentId = shipment.shipmentId;
      stockChanges.push(...shipment.stockChanges);
      notes.push(`Replacement shipped on ${shipment.shipmentNumber}.`);
      break;
    }

    case "CLOSED":
      data.resolvedAt = now;
      break;

    case "CANCELLED": {
      if (rma.receivedAt) throw conflict("The goods are already back with us; close the RMA instead of cancelling it.");
      data.resolvedAt = now;
      break;
    }

    default:
      break;
  }

  await tx.returnRequest.update({ where: { id: rma.id }, data });

  const message = [`${label(rma.status)} → ${label(values.toStatus)}`, ...notes, values.note].filter(Boolean).join(" · ");
  await addReturnEvent(tx, {
    returnRequestId: rma.id,
    fromStatus: rma.status,
    toStatus: values.toStatus,
    message,
    isInternal: values.isInternal ?? true,
    actorId: actorIdOf(actor),
  });
  await addOrderEvent(tx, {
    orderId: rma.orderId,
    type: "RETURN",
    message: `Return ${rma.rmaNumber}: ${message}`,
    metadata: { returnRequestId: rma.id, toStatus: values.toStatus },
    actorId: actorIdOf(actor),
  });
  await writeAudit(tx, {
    actor,
    action: "return.status_change",
    entityType: "ReturnRequest",
    entityId: rma.id,
    entityLabel: rma.rmaNumber,
    summary: `Return ${rma.rmaNumber} moved to ${label(values.toStatus).toLowerCase()} on ${rma.order.orderNumber}`,
    diff: diffOf(
      { status: rma.status, resolution: rma.resolution, qcDisposition: rma.qcDisposition },
      {
        status: values.toStatus,
        resolution: (data.resolution as string | undefined) ?? rma.resolution,
        qcDisposition: (data.qcDisposition as string | undefined) ?? rma.qcDisposition,
        refundId: refund?.id ?? null,
        replacementShipmentId,
      },
    ),
    ip: input.ip ?? null,
  });

  // E3: the customer hears about an approval; everything else is internal.
  if (values.toStatus === "APPROVED") {
    const contact = contactFor(rma.order);
    if (contact.email) {
      await emitEvent(
        "return.approved",
        {
          returnRequestId: rma.id,
          rmaNumber: rma.rmaNumber,
          orderId: rma.orderId,
          orderNumber: rma.order.orderNumber,
          customerName: contact.name,
          customerEmail: contact.email,
          pickupDate: rma.pickupScheduledAt ? formatIstDate(rma.pickupScheduledAt) : "to be scheduled",
          orderUrl: await orderUrlFor(tx, rma.order.orderNumber),
        },
        tx,
      );
    }
  }

  await recomputeOrderDerivedStatus(tx, rma.orderId);

  // C4: a rejection closes itself - there is nothing left for anyone to do.
  if (values.toStatus === "REJECTED") {
    await tx.returnRequest.update({ where: { id: rma.id }, data: { status: "CLOSED", resolvedAt: now } });
    await addReturnEvent(tx, {
      returnRequestId: rma.id,
      fromStatus: "REJECTED",
      toStatus: "CLOSED",
      message: "Closed automatically after rejection.",
      isInternal: true,
      actorId: actorIdOf(actor),
    });
    await recomputeOrderDerivedStatus(tx, rma.orderId);
  }

  return {
    returnRequestId: rma.id,
    rmaNumber: rma.rmaNumber,
    orderId: rma.orderId,
    orderNumber: rma.order.orderNumber,
    fromStatus: rma.status as ReturnRequestStatus,
    toStatus: values.toStatus === "REJECTED" ? "CLOSED" : values.toStatus,
    stockChanges,
    refund,
    replacementShipmentId,
  };
}

/** QC_PASSED (and a RESTOCK disposition): the units are formally returned. */
async function markUnitsReturned(tx: Db, rma: RmaRow): Promise<void> {
  const returnedQty = Math.min(rma.orderItem.quantity, rma.orderItem.returnedQty + rma.quantity);
  await tx.orderItem.update({
    where: { id: rma.orderItemId },
    data: {
      returnedQty,
      // REFUNDED is set later by applyRefundToOrder; RETURNED says the goods
      // are back but the money has not moved yet.
      status: returnedQty >= rma.orderItem.quantity && rma.orderItem.status === "ACTIVE" ? "RETURNED" : undefined,
    },
  });
}

/** C3: what a failed QC does to stock, by disposition. */
async function applyDisposition(
  tx: Db,
  rma: RmaRow,
  disposition: QcDisposition,
  actor: ReturnActor,
): Promise<StockChange[]> {
  const variantId = rma.orderItem.variantId;
  switch (disposition) {
    case "RESTOCK": {
      await markUnitsReturned(tx, rma);
      if (!variantId) return [];
      return [
        await restock(tx, {
          variantId,
          quantity: rma.quantity,
          orderId: rma.orderId,
          reason: "RETURN_QC_FAILED_RESTOCK",
          note: `${rma.rmaNumber} restocked despite failed QC`,
          actorId: actorIdOf(actor),
        }),
      ];
    }
    case "DISPOSE": {
      await markUnitsReturned(tx, rma);
      if (!variantId) return [];
      // delta 0: the goods never re-enter saleable stock, but the movement
      // records that they were scrapped (C3).
      return [
        await applyStockMovement(tx, {
          variantId,
          delta: 0,
          reservedDelta: 0,
          type: "DAMAGE",
          reason: "RETURN_DISPOSED",
          note: `${rma.quantity} unit(s) from ${rma.rmaNumber} disposed of`,
          orderId: rma.orderId,
          actorId: actorIdOf(actor),
        }),
      ];
    }
    case "PARTIAL_REFUND":
      // The goods stay with us but are not saleable; the money side follows
      // at REFUND_INITIATED.
      await markUnitsReturned(tx, rma);
      return [];
    case "RETURN_TO_CUSTOMER":
    default:
      // Nothing changes hands: the parcel goes back out, the line stays sold.
      return [];
  }
}

// ---------------------------------------------------------------------------
// Notes and bulk
// ---------------------------------------------------------------------------

export async function addReturnNote(input: {
  returnRequestId: string;
  values: ReturnNoteValues;
  actor: ReturnActor;
  ip?: string | null;
}): Promise<{ eventId: string; isInternal: boolean }> {
  return runReturnTx(async (tx) => {
    const rma = await loadRma(tx, input.returnRequestId);
    const event = await addReturnEvent(tx, {
      returnRequestId: rma.id,
      message: input.values.message,
      isInternal: input.values.isInternal,
      actorId: actorIdOf(input.actor),
    });
    await writeAudit(tx, {
      actor: input.actor,
      action: "return.note",
      entityType: "ReturnRequest",
      entityId: rma.id,
      entityLabel: rma.rmaNumber,
      summary: `${input.values.isInternal ? "Internal" : "Customer-visible"} note on ${rma.rmaNumber}`,
      diff: { isInternal: input.values.isInternal, length: input.values.message.length },
      ip: input.ip ?? null,
    });
    return { eventId: event.id, isInternal: input.values.isInternal };
  });
}

export type BulkReturnsResult = {
  op: BulkReturnsValues["op"];
  requested: number;
  affected: number;
  skipped: Array<{ id: string; rmaNumber: string | null; reason: string }>;
  stockChanges: StockChange[];
};

const BULK_TARGET = {
  REVIEW: "UNDER_REVIEW",
  APPROVE: "APPROVED",
  REJECT: "REJECTED",
  CLOSE: "CLOSED",
} as const satisfies Record<BulkReturnsValues["op"], ReturnRequestStatus>;

/**
 * §11.33: capped at 500 ids, one transaction, one audit row. A row that
 * cannot make the move is skipped with its reason rather than aborting the
 * batch - an operator who selected forty RMAs wants the thirty-eight that
 * worked, plus a list of the two that did not.
 */
export async function bulkReturns(input: {
  values: BulkReturnsValues;
  actor: ReturnActor;
  ip?: string | null;
}): Promise<BulkReturnsResult> {
  const { values, actor } = input;
  const target = BULK_TARGET[values.op];
  if (target === "REJECTED" && !values.reason) {
    throw validationError({ reason: "A rejection needs a reason." });
  }

  return runReturnTx(async (tx) => {
    const skipped: BulkReturnsResult["skipped"] = [];
    const stockChanges: StockChange[] = [];
    let affected = 0;

    // Pre-filter rather than discovering ineligibility by exception: a failed
    // statement aborts a Postgres transaction, and one bad id must not take
    // the other 499 with it.
    const rows = await tx.returnRequest.findMany({
      where: { id: { in: [...values.ids] } },
      select: { id: true, rmaNumber: true, status: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    for (const id of values.ids) {
      const row = byId.get(id);
      if (!row) {
        skipped.push({ id, rmaNumber: null, reason: 'No such return request.' });
        continue;
      }
      if (!canTransitionReturn(row.status as ReturnRequestStatus, target)) {
        skipped.push({ id, rmaNumber: row.rmaNumber, reason: `A ${label(row.status).toLowerCase()} return cannot move to ${label(target).toLowerCase()}.` });
        continue;
      }
      try {
        const result = await transitionReturnInTx(tx, {
          returnRequestId: id,
          actor,
          values: {
            toStatus: target,
            isInternal: true,
            note: values.reason,
            rejectionReason: target === "REJECTED" ? values.reason : undefined,
            resolution: undefined,
            pickupPartnerId: undefined,
            pickupScheduledAt: undefined,
            pickupTrackingNumber: undefined,
            qcNote: undefined,
            qcDisposition: undefined,
            amountPaise: undefined,
            refundMethod: undefined,
            replacement: undefined,
          },
          ip: input.ip,
        });
        stockChanges.push(...result.stockChanges);
        affected += 1;
      } catch (error) {
        skipped.push({ id, rmaNumber: row.rmaNumber, reason: error instanceof Error ? error.message : "Could not be moved." });
      }
    }

    await writeAudit(tx, {
      actor,
      action: `return.bulk_${values.op.toLowerCase()}`,
      entityType: "ReturnRequest",
      summary: `${values.op} applied to ${affected} of ${values.ids.length} return(s)`,
      diff: { ids: values.ids.length, affected, skipped: skipped.length, reason: values.reason ?? null },
      ip: input.ip ?? null,
    });

    return { op: values.op, requested: values.ids.length, affected, skipped, stockChanges };
  });
}
