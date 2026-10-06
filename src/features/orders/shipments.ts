import { conflict, notFound, validationError } from "@/lib/api/errors";
import { writeAudit } from "@/lib/audit";
import { canTransitionShipment, SHIPMENT_STATUS_META, type ShipmentStatus } from "@/lib/enums";
import { formatIstDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import type { StockChange } from "@/features/inventory/service";
import { nextNumber, recordEarningsForDeliveredItems } from "@/features/finance/service";
import { buildTrackingUrl } from "@/features/shipping/tracking";
import { emitEvent } from "@/features/notifications/service";

import { applyCancellation } from "./cancellation";
import { recomputeCustomerCounters, recomputeOrderDerivedStatus, recomputeOrderPaymentStatus } from "./derived";
import type { CreateShipmentValues, UpdateShipmentStatusValues } from "./schemas";
import { addOrderEvent, contactFor, lockOrder, orderUrlFor, runOrderTx, type Db, type OrderActor } from "./shared";

/**
 * Shipments (blueprint §14.C1, C2, C8, B6). Fulfilment is per shipment: a
 * multi-seller order ships in parts, each with its own tracking number, and
 * the order's SHIPPED / OUT_FOR_DELIVERY / DELIVERED status is derived from
 * them (derived.ts) rather than set by hand.
 */

const SHIPPABLE_ORDER_STATUSES: readonly string[] = ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY"];

export type ShipmentMutationResult = {
  shipmentId: string;
  shipmentNumber: string;
  orderId: string;
  status: ShipmentStatus;
  stockChanges: StockChange[];
};

/** Units of each ACTIVE line not yet on a live (non-cancelled) shipment. */
export async function unshippedQuantities(tx: Db, orderId: string): Promise<Map<string, number>> {
  const items = await tx.orderItem.findMany({
    where: { orderId, status: "ACTIVE" },
    select: { id: true, quantity: true, shipmentItems: { where: { shipment: { status: { not: "CANCELLED" } } }, select: { quantity: true } } },
  });
  return new Map(items.map((item) => [item.id, Math.max(0, item.quantity - item.shipmentItems.reduce((sum, row) => sum + row.quantity, 0))]));
}

/**
 * Create a shipment inside the caller's transaction (also used by the manual
 * PACKED→SHIPPED transition, which ships every unshipped line at once).
 */
export async function createShipmentInTx(
  tx: Db,
  input: { orderId: string; actor: OrderActor; values: CreateShipmentValues },
): Promise<ShipmentMutationResult> {
  const { orderId, actor, values } = input;
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, orderNumber: true, status: true } });
  if (!order) throw notFound("Order");
  if (!SHIPPABLE_ORDER_STATUSES.includes(order.status)) {
    throw conflict(`Shipments cannot be created while the order is ${order.status.toLowerCase().replace("_", " ")}.`);
  }

  const remaining = await unshippedQuantities(tx, orderId);
  const errors: Record<string, string> = {};
  const seen = new Set<string>();
  values.items.forEach((line, index) => {
    const left = remaining.get(line.orderItemId);
    if (left === undefined) errors[`items.${index}`] = "That line is not on this order or is cancelled.";
    else if (seen.has(line.orderItemId)) errors[`items.${index}`] = "Duplicate line.";
    else if (line.quantity > left) errors[`items.${index}.quantity`] = `Only ${left} unit${left === 1 ? "" : "s"} left to ship.`;
    seen.add(line.orderItemId);
  });
  if (Object.keys(errors).length) throw validationError(errors, "Check the shipment lines.");

  const partner = values.partnerId ? await tx.shippingPartner.findUnique({ where: { id: values.partnerId } }) : null;
  if (values.partnerId && !partner) throw validationError({ partnerId: "Unknown shipping partner." });

  const { seq, number } = await nextNumber(tx, "Shipment");
  const trackingUrl = values.trackingUrl ?? buildTrackingUrl(partner, values.trackingNumber ?? null);
  const initialStatus: ShipmentStatus = values.markShipped ? "SHIPPED" : "PENDING";
  const now = new Date();

  const shipment = await tx.shipment.create({
    data: {
      seq,
      shipmentNumber: number,
      orderId,
      partnerId: partner?.id ?? null,
      carrierName: values.carrierName ?? partner?.name ?? null,
      trackingNumber: values.trackingNumber ?? null,
      trackingUrl,
      status: initialStatus,
      weightGrams: values.weightGrams ?? null,
      costPaise: values.costPaise ?? 0,
      estimatedDeliveryAt: values.estimatedDeliveryAt ?? null,
      note: values.note ?? null,
      items: { create: values.items.map((line) => ({ orderItemId: line.orderItemId, quantity: line.quantity })) },
      events: { create: { status: initialStatus, message: values.markShipped ? "Handed to the courier" : "Shipment created", occurredAt: now } },
    },
    select: { id: true, shipmentNumber: true },
  });

  await addOrderEvent(tx, {
    orderId,
    type: "SHIPMENT",
    message: `Shipment ${shipment.shipmentNumber} created${partner ? ` with ${partner.name}` : ""}${values.trackingNumber ? ` · tracking ${values.trackingNumber}` : ""} (${values.items.reduce((sum, line) => sum + line.quantity, 0)} units)`,
    metadata: { shipmentId: shipment.id, trackingNumber: values.trackingNumber ?? null, carrier: partner?.name ?? values.carrierName ?? null },
    actorId: actor.id,
  });
  await writeAudit(tx, {
    actor,
    action: "order.shipment_create",
    entityType: "Shipment",
    entityId: shipment.id,
    entityLabel: shipment.shipmentNumber,
    summary: `Created shipment ${shipment.shipmentNumber} on ${order.orderNumber}`,
    diff: { orderId, items: values.items, partnerId: partner?.id ?? null, trackingNumber: values.trackingNumber ?? null, status: initialStatus },
  });

  if (values.markShipped) await onShipped(tx, shipment.id, actor, now);
  await recomputeOrderDerivedStatus(tx, orderId);

  return { shipmentId: shipment.id, shipmentNumber: shipment.shipmentNumber, orderId, status: initialStatus, stockChanges: [] };
}

export function createShipment(input: { orderId: string; actor: OrderActor; values: CreateShipmentValues }): Promise<ShipmentMutationResult> {
  return runOrderTx(async (tx) => {
    if (!(await lockOrder(tx, input.orderId))) throw notFound("Order");
    return createShipmentInTx(tx, input);
  });
}

/** SHIPPED side effects: stamps, the customer's tracking email. */
async function onShipped(tx: Db, shipmentId: string, actor: OrderActor, at: Date): Promise<void> {
  const shipment = await tx.shipment.findUniqueOrThrow({
    where: { id: shipmentId },
    select: {
      id: true,
      shipmentNumber: true,
      carrierName: true,
      trackingNumber: true,
      trackingUrl: true,
      estimatedDeliveryAt: true,
      items: { select: { orderItemId: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          shippedAt: true,
          guestEmail: true,
          customer: { select: { email: true, fullName: true } },
          addresses: { select: { type: true, fullName: true, email: true } },
        },
      },
    },
  });

  await tx.shipment.update({ where: { id: shipmentId }, data: { shippedAt: at } });
  await tx.orderItem.updateMany({ where: { id: { in: shipment.items.map((row) => row.orderItemId) }, shippedAt: null }, data: { shippedAt: at } });
  if (!shipment.order.shippedAt) await tx.order.update({ where: { id: shipment.order.id }, data: { shippedAt: at } });

  const contact = contactFor(shipment.order);
  if (contact.email) {
    await emitEvent(
      "shipment.shipped",
      {
        orderId: shipment.order.id,
        orderNumber: shipment.order.orderNumber,
        shipmentId: shipment.id,
        customerName: contact.name,
        customerEmail: contact.email,
        carrier: shipment.carrierName ?? "our courier",
        trackingNumber: shipment.trackingNumber ?? "-",
        trackingUrl: shipment.trackingUrl ?? (await orderUrlFor(tx, shipment.order.orderNumber)),
        eta: shipment.estimatedDeliveryAt ? formatIstDate(shipment.estimatedDeliveryAt) : "soon",
        orderUrl: await orderUrlFor(tx, shipment.order.orderNumber),
      },
      tx,
    );
  }
  void actor;
}

/**
 * DELIVERED side effects (C1, B4, B6, C7): line stamps, the COD cash payment
 * row (shipping + COD fee ride on the first delivered shipment), seller
 * earnings, counters and the delivered email.
 */
async function onDelivered(tx: Db, shipmentId: string, actor: OrderActor, at: Date): Promise<void> {
  const shipment = await tx.shipment.findUniqueOrThrow({
    where: { id: shipmentId },
    select: {
      id: true,
      shipmentNumber: true,
      items: { select: { orderItemId: true, quantity: true, orderItem: { select: { id: true, quantity: true, lineTotalPaise: true, productId: true } } } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          paymentMethod: true,
          shippingPaise: true,
          codFeePaise: true,
          totalPaise: true,
          customerId: true,
          guestEmail: true,
          customer: { select: { email: true, fullName: true } },
          addresses: { select: { type: true, fullName: true, email: true } },
          payments: { where: { provider: "COD", status: "SUCCEEDED", type: "CHARGE" }, select: { id: true } },
        },
      },
    },
  });

  await tx.shipment.update({ where: { id: shipmentId }, data: { deliveredAt: at } });

  // A line counts as delivered once every unit of it has been delivered.
  for (const row of shipment.items) {
    const delivered = await tx.shipmentItem.aggregate({
      where: { orderItemId: row.orderItemId, shipment: { status: "DELIVERED" } },
      _sum: { quantity: true },
    });
    if ((delivered._sum.quantity ?? 0) + row.quantity >= row.orderItem.quantity) {
      await tx.orderItem.update({ where: { id: row.orderItemId }, data: { deliveredAt: at } });
    }
    if (row.orderItem.productId) {
      await tx.product.update({ where: { id: row.orderItem.productId }, data: { orderCount: { increment: row.quantity } } });
    }
  }

  // B6: cash collected on delivery becomes a SUCCEEDED COD charge.
  if (shipment.order.paymentMethod === "COD") {
    const first = shipment.order.payments.length === 0;
    const lines = shipment.items.reduce(
      (sum, row) => sum + Math.round((row.orderItem.lineTotalPaise * row.quantity) / Math.max(1, row.orderItem.quantity)),
      0,
    );
    // Shipping actually charged = total − Σ line totals − COD fee (0 when a
    // FREE_SHIPPING coupon waived it), so the cash collected matches the invoice.
    const activeTotals = await tx.orderItem.aggregate({ where: { orderId: shipment.order.id, status: { not: "CANCELLED" } }, _sum: { lineTotalPaise: true } });
    const shippingShare = Math.max(0, shipment.order.totalPaise - (activeTotals._sum.lineTotalPaise ?? 0) - shipment.order.codFeePaise);
    const amount = lines + (first ? shippingShare + shipment.order.codFeePaise : 0);
    if (amount > 0) {
      await tx.orderPayment.create({
        data: {
          orderId: shipment.order.id,
          provider: "COD",
          method: "CASH",
          type: "CHARGE",
          status: "SUCCEEDED",
          amountPaise: amount,
          capturedAt: at,
          rawPayload: { shipmentId: shipment.id, shipmentNumber: shipment.shipmentNumber },
        },
      });
      await addOrderEvent(tx, {
        orderId: shipment.order.id,
        type: "PAYMENT",
        message: `Cash of ${formatPaise(amount)} collected on delivery (${shipment.shipmentNumber})`,
        metadata: { provider: "COD", shipmentId: shipment.id, amountPaise: amount },
        actorId: actor.id,
      });
    }
    await recomputeOrderPaymentStatus(tx, shipment.order.id);
  }

  await recordEarningsForDeliveredItems(tx, shipmentId, actor.id);

  const derived = await recomputeOrderDerivedStatus(tx, shipment.order.id);
  if (derived.status === "DELIVERED" && shipment.order.customerId) await recomputeCustomerCounters(tx, shipment.order.customerId);

  const contact = contactFor(shipment.order);
  if (contact.email) {
    const orderUrl = await orderUrlFor(tx, shipment.order.orderNumber);
    await emitEvent(
      "shipment.delivered",
      {
        orderId: shipment.order.id,
        orderNumber: shipment.order.orderNumber,
        shipmentId: shipment.id,
        customerName: contact.name,
        customerEmail: contact.email,
        orderUrl,
        reviewUrl: `${orderUrl}#review`,
      },
      tx,
    );
  }
}

/**
 * Move a shipment along SHIPMENT_TRANSITIONS. FAILED_DELIVERY is recorded as
 * an event only (C2). Returns the recomputed order status so the caller can
 * revalidate and toast accurately.
 */
export function updateShipmentStatus(input: {
  orderId: string;
  shipmentId: string;
  actor: OrderActor;
  values: UpdateShipmentStatusValues;
}): Promise<ShipmentMutationResult & { orderStatus: string }> {
  return runOrderTx(async (tx) => {
    if (!(await lockOrder(tx, input.orderId))) throw notFound("Order");
    const shipment = await tx.shipment.findUnique({
      where: { id: input.shipmentId },
      select: { id: true, shipmentNumber: true, orderId: true, status: true, order: { select: { orderNumber: true } } },
    });
    if (!shipment || shipment.orderId !== input.orderId) throw notFound("Shipment");

    const from = shipment.status as ShipmentStatus;
    const to = input.values.toStatus as ShipmentStatus;
    const at = input.values.occurredAt ?? new Date();
    const note = input.values.note ?? null;
    const location = input.values.location ?? null;

    if (to === "FAILED_DELIVERY") {
      if (!["SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(from)) throw conflict("A delivery attempt can only fail while the shipment is in transit.");
      await tx.shipmentEvent.create({ data: { shipmentId: shipment.id, status: "FAILED_DELIVERY", location, message: note ?? "Delivery attempt failed", occurredAt: at } });
      await tx.shipment.update({ where: { id: shipment.id }, data: { updatedAt: at } });
      await addOrderEvent(tx, {
        orderId: input.orderId,
        type: "SHIPMENT",
        message: `Delivery attempt failed for ${shipment.shipmentNumber}${location ? ` at ${location}` : ""}${note ? ` - ${note}` : ""}`,
        metadata: { shipmentId: shipment.id, event: "FAILED_DELIVERY" },
        actorId: input.actor.id,
      });
      const derived = await recomputeOrderDerivedStatus(tx, input.orderId);
      return { shipmentId: shipment.id, shipmentNumber: shipment.shipmentNumber, orderId: input.orderId, status: from, stockChanges: [], orderStatus: derived.status };
    }

    if (!canTransitionShipment(from, to)) {
      throw conflict(`A shipment cannot go from ${SHIPMENT_STATUS_META[from].label.toLowerCase()} to ${SHIPMENT_STATUS_META[to].label.toLowerCase()}.`);
    }

    await tx.shipment.update({ where: { id: shipment.id }, data: { status: to } });
    await tx.shipmentEvent.create({ data: { shipmentId: shipment.id, status: to, location, message: note, occurredAt: at } });
    await addOrderEvent(tx, {
      orderId: input.orderId,
      type: "SHIPMENT",
      message: `Shipment ${shipment.shipmentNumber} ${SHIPMENT_STATUS_META[to].label.toLowerCase()}${location ? ` · ${location}` : ""}${note ? ` - ${note}` : ""}`,
      metadata: { shipmentId: shipment.id, fromStatus: from, toStatus: to },
      actorId: input.actor.id,
    });
    await writeAudit(tx, {
      actor: input.actor,
      action: "order.shipment_status",
      entityType: "Shipment",
      entityId: shipment.id,
      entityLabel: shipment.shipmentNumber,
      summary: `${shipment.shipmentNumber} on ${shipment.order.orderNumber}: ${from} → ${to}`,
      diff: { status: { from, to }, note, location },
    });

    if (to === "SHIPPED") await onShipped(tx, shipment.id, input.actor, at);
    if (to === "DELIVERED") await onDelivered(tx, shipment.id, input.actor, at);

    const derived = await recomputeOrderDerivedStatus(tx, input.orderId);
    return { shipmentId: shipment.id, shipmentNumber: shipment.shipmentNumber, orderId: input.orderId, status: to, stockChanges: [], orderStatus: derived.status };
  });
}

/**
 * "RTO received" (C2): the courier brought the parcel back. Units return to
 * the shelf, the lines are cancelled, and when nothing else on the order was
 * delivered the order itself becomes CANCELLED with cancelReason RTO plus a
 * refund of what was paid. Never earnings.
 */
export function rtoReceived(input: { orderId: string; shipmentId: string; actor: OrderActor; note?: string | null }): Promise<ShipmentMutationResult & { orderStatus: string }> {
  return runOrderTx(async (tx) => {
    if (!(await lockOrder(tx, input.orderId))) throw notFound("Order");
    const shipment = await tx.shipment.findUnique({
      where: { id: input.shipmentId },
      select: {
        id: true,
        shipmentNumber: true,
        orderId: true,
        status: true,
        items: { select: { orderItemId: true } },
        order: { select: { orderNumber: true, items: { select: { id: true, status: true, deliveredAt: true } } } },
      },
    });
    if (!shipment || shipment.orderId !== input.orderId) throw notFound("Shipment");
    if (shipment.status !== "RETURNED_TO_ORIGIN") throw conflict("Only a shipment marked returned to origin can be received back.");

    const lineIds = shipment.items.map((row) => row.orderItemId);
    const otherDelivered = shipment.order.items.some((item) => !lineIds.includes(item.id) && item.status === "ACTIVE" && item.deliveredAt);

    let stockChanges: StockChange[] = [];
    if (otherDelivered) {
      // Part of the order reached the customer: cancel only these lines.
      const result = await applyCancellation(tx, {
        orderId: input.orderId,
        toStatus: "CANCELLED",
        reason: "RTO",
        note: input.note,
        actor: input.actor,
        cancelledBy: "admin",
        lineIds,
        restockShipped: true,
      });
      stockChanges = result.stockChanges;
      // applyCancellation set the order CANCELLED; the other delivered lines say otherwise.
      await tx.order.update({ where: { id: input.orderId }, data: { status: "DELIVERED", cancelledAt: null, cancelReason: null } });
    } else {
      const result = await applyCancellation(tx, {
        orderId: input.orderId,
        toStatus: "CANCELLED",
        reason: "RTO",
        note: input.note,
        actor: input.actor,
        cancelledBy: "admin",
        restockShipped: true,
      });
      stockChanges = result.stockChanges;
    }

    await tx.shipmentEvent.create({ data: { shipmentId: shipment.id, status: "RETURNED_TO_ORIGIN", message: input.note ?? "Parcel received back at origin", occurredAt: new Date() } });
    await writeAudit(tx, {
      actor: input.actor,
      action: "order.rto_received",
      entityType: "Shipment",
      entityId: shipment.id,
      entityLabel: shipment.shipmentNumber,
      summary: `RTO received for ${shipment.shipmentNumber} on ${shipment.order.orderNumber}`,
      diff: { lines: lineIds, note: input.note ?? null },
    });

    const derived = await recomputeOrderDerivedStatus(tx, input.orderId);
    return { shipmentId: shipment.id, shipmentNumber: shipment.shipmentNumber, orderId: input.orderId, status: "RETURNED_TO_ORIGIN", stockChanges, orderStatus: derived.status };
  });
}
