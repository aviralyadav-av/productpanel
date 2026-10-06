import { ApiError, conflict, isApiError, notFound, validationError } from "@/lib/api/errors";
import { writeAudit } from "@/lib/audit";
import { canManuallyTransitionOrder, ORDER_STATUS_META, type OrderStatus } from "@/lib/enums";
import { formatPaise } from "@/lib/money";
import { commitReservation, InventoryError, releaseStock, restock, type StockChange } from "@/features/inventory/service";
import { refundableRemaining } from "@/features/finance/service";

import { applyCancellation } from "./cancellation";
import { recomputeOrderDerivedStatus, recomputeOrderPaymentStatus } from "./derived";
import { BULK_OP_TARGET, type BulkOrderOp } from "./schemas";
import { createShipmentInTx, unshippedQuantities } from "./shipments";
import { addOrderEvent, createCancellationRefund, lockOrder, runOrderTx, type Db, type OrderActor } from "./shared";

/**
 * The order state machine (blueprint §10, §14.C2, C3).
 *
 * `transitionOrder` is the only writer of the pre-shipment statuses. Stock
 * moves with the status (C3): confirming commits the reservation to a SALE,
 * cancelling releases or restocks, and the RESERVE that happened at creation
 * is never repeated. SHIPPED is accepted from PACKED as a convenience that
 * creates one shipment for everything unshipped - after that, shipments drive
 * the order (shipments.ts + derived.ts).
 */

export type TransitionInput = {
  orderId: string;
  toStatus: OrderStatus;
  actor: OrderActor;
  reason?: string | null;
  note?: string | null;
  /** Who is acting, for the cancellation email; defaults to "admin". */
  cancelledBy?: "customer" | "admin" | "system";
  /** Compose with an outer transaction (jobs, bulk). */
  tx?: Db;
  ip?: string | null;
};

export type TransitionResult = {
  orderId: string;
  orderNumber: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  stockChanges: StockChange[];
  refund: { id: string; refundNumber: string; amountPaise: number } | null;
};

function inventoryToApi(error: unknown): unknown {
  if (error instanceof InventoryError) {
    return conflict(error.code === "INSUFFICIENT_STOCK" ? `Not enough stock to confirm: ${error.message}` : error.message);
  }
  return error;
}

async function transitionInTx(tx: Db, input: TransitionInput): Promise<TransitionResult> {
  if (!(await lockOrder(tx, input.orderId))) throw notFound("Order");
  const order = await tx.order.findUniqueOrThrow({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentMethod: true,
      items: { select: { id: true, variantId: true, quantity: true, reservedQty: true, status: true, shippedAt: true } },
    },
  });
  const from = order.status as OrderStatus;
  const to = input.toStatus;

  if (!canManuallyTransitionOrder(from, to)) {
    throw conflict(`An order cannot go from ${ORDER_STATUS_META[from].label.toLowerCase()} to ${ORDER_STATUS_META[to].label.toLowerCase()} here.`);
  }
  if ((to === "CANCELLED" || to === "FAILED") && !input.reason) throw validationError({ reason: "A reason is required." });

  const now = new Date();
  let stockChanges: StockChange[] = [];
  let refund: TransitionResult["refund"] = null;

  switch (to) {
    case "CONFIRMED": {
      try {
        for (const item of order.items) {
          if (item.status !== "ACTIVE" || !item.variantId || item.reservedQty <= 0) continue;
          stockChanges.push(await commitReservation(tx, { variantId: item.variantId, quantity: item.reservedQty, orderId: order.id, actorId: input.actor.id }));
          await tx.orderItem.update({ where: { id: item.id }, data: { reservedQty: 0 } });
        }
      } catch (error) {
        throw inventoryToApi(error);
      }
      await tx.order.update({ where: { id: order.id }, data: { status: to, confirmedAt: now, reservationExpiresAt: null } });
      break;
    }
    case "PROCESSING":
      await tx.order.update({ where: { id: order.id }, data: { status: to } });
      break;
    case "PACKED":
      await tx.order.update({ where: { id: order.id }, data: { status: to, packedAt: order.status === "PACKED" ? undefined : now } });
      break;
    case "SHIPPED": {
      const live = await tx.shipment.findMany({ where: { orderId: order.id, status: { not: "CANCELLED" } }, select: { id: true, status: true } });
      const remaining = await unshippedQuantities(tx, order.id);
      const toShip = [...remaining.entries()].filter(([, qty]) => qty > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
      if (live.length === 0 || toShip.length > 0) {
        if (toShip.length === 0) throw conflict("Every line is already on a shipment; update the shipment status instead.");
        await createShipmentInTx(tx, {
          orderId: order.id,
          actor: input.actor,
          values: { items: toShip, markShipped: true, note: input.note ?? undefined },
        });
      } else {
        // Existing unshipped shipments: hand them all to the courier.
        for (const shipment of live.filter((row) => row.status === "PENDING" || row.status === "PACKED")) {
          await tx.shipment.update({ where: { id: shipment.id }, data: { status: "SHIPPED", shippedAt: now } });
          await tx.shipmentEvent.create({ data: { shipmentId: shipment.id, status: "SHIPPED", message: "Handed to the courier", occurredAt: now } });
        }
        await tx.orderItem.updateMany({ where: { orderId: order.id, status: "ACTIVE", shippedAt: null }, data: { shippedAt: now } });
        await tx.order.update({ where: { id: order.id }, data: { shippedAt: now } });
      }
      await recomputeOrderDerivedStatus(tx, order.id);
      break;
    }
    case "CANCELLED":
    case "FAILED": {
      const result = await applyCancellation(tx, {
        orderId: order.id,
        toStatus: to,
        reason: input.reason ?? "Cancelled",
        note: input.note,
        actor: input.actor,
        cancelledBy: input.cancelledBy ?? "admin",
      });
      stockChanges = result.stockChanges;
      refund = result.refund;
      break;
    }
    default:
      throw conflict(`${ORDER_STATUS_META[to].label} is derived from shipments and returns; it cannot be set by hand.`);
  }

  if (to !== "CANCELLED" && to !== "FAILED") {
    await addOrderEvent(tx, {
      orderId: order.id,
      type: "STATUS_CHANGE",
      fromStatus: from,
      toStatus: to,
      message: `Status changed from ${ORDER_STATUS_META[from].label.toLowerCase()} to ${ORDER_STATUS_META[to].label.toLowerCase()}${input.reason ? ` - ${input.reason}` : ""}${input.note ? ` (${input.note})` : ""}`,
      metadata: { reason: input.reason ?? null, note: input.note ?? null },
      actorId: input.actor.id,
    });
  }

  // D13: manual status overrides are audited inside the transaction.
  await writeAudit(tx, {
    actor: input.actor,
    action: "order.status_change",
    entityType: "Order",
    entityId: order.id,
    entityLabel: order.orderNumber,
    summary: `${order.orderNumber}: ${from} → ${to}${input.reason ? ` (${input.reason})` : ""}`,
    diff: { status: { from, to }, reason: input.reason ?? null, note: input.note ?? null, refund: refund?.refundNumber ?? null },
    ip: input.ip ?? null,
  });

  return { orderId: order.id, orderNumber: order.orderNumber, fromStatus: from, toStatus: to, stockChanges, refund };
}

export function transitionOrder(input: TransitionInput): Promise<TransitionResult> {
  return input.tx ? transitionInTx(input.tx, input) : runOrderTx((tx) => transitionInTx(tx, input));
}

// ---------------------------------------------------------------------------
// Bulk (§11.33)
// ---------------------------------------------------------------------------

export type BulkTransitionResult = {
  op: BulkOrderOp;
  requested: number;
  affected: number;
  skipped: Array<{ id: string; orderNumber: string | null; reason: string }>;
  stockChanges: StockChange[];
};

/**
 * One transaction, a summary result. Orders that cannot make the move are
 * reported, not failed: the status check happens before any write for that
 * order, so a skip leaves the transaction healthy.
 */
export async function bulkTransitionOrders(input: { ids: readonly string[]; op: BulkOrderOp }, actor: OrderActor, meta: { ip?: string | null } = {}): Promise<BulkTransitionResult> {
  const target = BULK_OP_TARGET[input.op];
  const ids = [...new Set(input.ids)];

  const result = await runOrderTx(async (tx) => {
    const rows = await tx.order.findMany({ where: { id: { in: ids } }, select: { id: true, orderNumber: true, status: true } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const skipped: BulkTransitionResult["skipped"] = [];
    const stockChanges: StockChange[] = [];
    let affected = 0;

    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        skipped.push({ id, orderNumber: null, reason: "Not found" });
        continue;
      }
      if (!canManuallyTransitionOrder(row.status as OrderStatus, target)) {
        skipped.push({ id, orderNumber: row.orderNumber, reason: `Cannot move from ${ORDER_STATUS_META[row.status as OrderStatus]?.label ?? row.status}` });
        continue;
      }
      try {
        const done = await transitionInTx(tx, { orderId: id, toStatus: target, actor, tx, ip: meta.ip, note: "Bulk action" });
        stockChanges.push(...done.stockChanges);
        affected += 1;
      } catch (error) {
        // Only pre-write validation errors reach here (stock checked under lock);
        // anything else is a real failure and must roll the batch back.
        if (isApiError(error) && (error as ApiError).status < 500) skipped.push({ id, orderNumber: row.orderNumber, reason: (error as ApiError).message });
        else throw error;
      }
    }

    await writeAudit(tx, {
      actor,
      action: "order.bulk",
      entityType: "Order",
      summary: `Bulk ${input.op.toLowerCase()} on ${ids.length} orders (${affected} changed, ${skipped.length} skipped)`,
      diff: { op: input.op, requested: ids.length, affected, skipped: skipped.length },
      ip: meta.ip ?? null,
    });

    return { op: input.op, requested: ids.length, affected, skipped, stockChanges };
  });

  return result;
}

// ---------------------------------------------------------------------------
// Cancel one line before it ships (C2)
// ---------------------------------------------------------------------------

export type CancelItemResult = {
  orderId: string;
  orderItemId: string;
  cancelledQuantity: number;
  orderCancelled: boolean;
  refund: { id: string; refundNumber: string; amountPaise: number } | null;
  stockChanges: StockChange[];
};

const MONEY_FIELDS = ["discountPaise", "sellerFundedDiscountPaise", "platformFundedDiscountPaise", "taxPaise", "lineTotalPaise", "commissionPaise", "chargesPaise", "sellerPayablePaise"] as const;

/**
 * Cancel `quantity` units of a line. A partial cancel splits the line into a
 * CANCELLED sibling carrying its share of every money column (largest share
 * stays with the original so the two always sum to the old line), releases or
 * restocks the units, refunds what was paid for them and - when nothing
 * active remains - cancels the whole order. The coupon is NOT re-allocated.
 */
export function cancelOrderItem(input: { orderId: string; orderItemId: string; quantity: number; reason: string; actor: OrderActor; ip?: string | null }): Promise<CancelItemResult> {
  return runOrderTx(async (tx) => {
    if (!(await lockOrder(tx, input.orderId))) throw notFound("Order");
    const order = await tx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      select: { id: true, orderNumber: true, status: true, shippingPaise: true, codFeePaise: true, totalPaise: true, taxPaise: true, subtotalPaise: true, discountPaise: true, couponDiscountPaise: true },
    });
    if (!["PENDING", "CONFIRMED", "PROCESSING", "PACKED"].includes(order.status)) throw conflict("Lines can only be cancelled before the order ships.");

    const item = await tx.orderItem.findUnique({
      where: { id: input.orderItemId },
      include: { shipmentItems: { where: { shipment: { status: { not: "CANCELLED" } } }, select: { id: true } } },
    });
    if (!item || item.orderId !== order.id) throw notFound("Order line");
    if (item.status !== "ACTIVE") throw conflict("This line is already cancelled.");
    if (item.shippedAt || item.shipmentItems.length > 0) throw conflict("This line is on a shipment; cancel the shipment first.");
    const quantity = Math.trunc(input.quantity);
    if (quantity < 1 || quantity > item.quantity) throw validationError({ quantity: `Enter 1 to ${item.quantity}.` });

    const stockChanges: StockChange[] = [];
    if (item.variantId) {
      if (order.status === "PENDING") {
        const release = Math.min(quantity, item.reservedQty);
        if (release > 0) stockChanges.push(await releaseStock(tx, { variantId: item.variantId, quantity: release, orderId: order.id, actorId: input.actor.id, note: input.reason }));
      } else {
        stockChanges.push(await restock(tx, { variantId: item.variantId, quantity, orderId: order.id, actorId: input.actor.id, reason: "ORDER_CANCELLED", note: input.reason }));
      }
    }

    // Money moving to the cancelled part of the line.
    const share = (value: number) => (quantity === item.quantity ? value : Math.round((value * quantity) / item.quantity));
    const cancelledValue = share(item.lineTotalPaise);

    if (quantity === item.quantity) {
      await tx.orderItem.update({ where: { id: item.id }, data: { status: "CANCELLED", reservedQty: 0 } });
    } else {
      const siblingMoney = Object.fromEntries(MONEY_FIELDS.map((field) => [field, share(item[field])])) as Record<(typeof MONEY_FIELDS)[number], number>;
      const remainingMoney = Object.fromEntries(MONEY_FIELDS.map((field) => [field, item[field] - siblingMoney[field]])) as Record<(typeof MONEY_FIELDS)[number], number>;
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          productId: item.productId,
          variantId: item.variantId,
          sellerId: item.sellerId,
          categoryId: item.categoryId,
          titleSnapshot: item.titleSnapshot,
          variantSnapshot: item.variantSnapshot,
          skuSnapshot: item.skuSnapshot,
          sellerNameSnapshot: item.sellerNameSnapshot,
          categoryPathSnapshot: item.categoryPathSnapshot,
          hsnCodeSnapshot: item.hsnCodeSnapshot,
          brandSnapshot: item.brandSnapshot,
          costPaiseSnapshot: item.costPaiseSnapshot,
          imageUrl: item.imageUrl,
          attributesSnapshot: item.attributesSnapshot ?? undefined,
          customization: item.customization ?? undefined,
          listPricePaise: item.listPricePaise,
          unitPricePaise: item.unitPricePaise,
          customizationPaise: item.customizationPaise,
          quantity,
          taxRateBps: item.taxRateBps,
          commissionBps: item.commissionBps,
          commissionFixedPaise: item.commissionFixedPaise,
          commissionRuleId: item.commissionRuleId,
          status: "CANCELLED",
          reservedQty: 0,
          ...siblingMoney,
        },
      });
      await tx.orderItem.update({
        where: { id: item.id },
        data: { quantity: item.quantity - quantity, reservedQty: Math.max(0, item.reservedQty - quantity), ...remainingMoney },
      });
    }

    // Order totals follow the active lines; shipping and the COD fee stay
    // unless nothing is left to deliver.
    const active = await tx.orderItem.aggregate({
      where: { orderId: order.id, status: "ACTIVE" },
      _count: { _all: true },
      _sum: { lineTotalPaise: true, taxPaise: true, unitPricePaise: true },
    });
    const allCancelled = active._count._all === 0;
    const activeLines = await tx.orderItem.findMany({ where: { orderId: order.id, status: "ACTIVE" }, select: { unitPricePaise: true, customizationPaise: true, quantity: true, taxPaise: true, lineTotalPaise: true } });
    const subtotal = activeLines.reduce((sum, row) => sum + (row.unitPricePaise + row.customizationPaise) * row.quantity, 0);
    const lineTotals = activeLines.reduce((sum, row) => sum + row.lineTotalPaise, 0);
    const shippingCharged = Math.max(0, order.totalPaise - (lineTotals + cancelledValue) - order.codFeePaise);
    const newTotal = allCancelled ? 0 : lineTotals + shippingCharged + order.codFeePaise;

    await tx.order.update({
      where: { id: order.id },
      data: { subtotalPaise: subtotal, taxPaise: activeLines.reduce((sum, row) => sum + row.taxPaise, 0), totalPaise: newTotal },
    });

    await addOrderEvent(tx, {
      orderId: order.id,
      type: "STATUS_CHANGE",
      message: `Cancelled ${quantity} × ${item.titleSnapshot}${item.variantSnapshot ? ` (${item.variantSnapshot})` : ""} - ${input.reason}`,
      metadata: { orderItemId: item.id, quantity, reason: input.reason, valuePaise: cancelledValue },
      actorId: input.actor.id,
    });

    let refund: CancelItemResult["refund"] = null;
    let orderCancelled = false;
    if (allCancelled) {
      const result = await applyCancellation(tx, { orderId: order.id, toStatus: "CANCELLED", reason: input.reason, actor: input.actor, cancelledBy: "admin" });
      refund = result.refund;
      orderCancelled = true;
    } else {
      const payment = await recomputeOrderPaymentStatus(tx, order.id);
      if (payment.paidPaise > 0) {
        const cap = await refundableRemaining(tx, order.id);
        const amount = Math.min(cap, Math.max(0, payment.paidPaise - newTotal));
        refund = await createCancellationRefund(tx, { orderId: order.id, amountPaise: amount, reason: `Line cancelled: ${input.reason}`, actorId: input.actor.id });
      }
      await recomputeOrderDerivedStatus(tx, order.id);
    }

    await writeAudit(tx, {
      actor: input.actor,
      action: "order.item_cancel",
      entityType: "Order",
      entityId: order.id,
      entityLabel: order.orderNumber,
      summary: `Cancelled ${quantity} × ${item.titleSnapshot} on ${order.orderNumber} (${formatPaise(cancelledValue)})`,
      diff: { orderItemId: item.id, quantity, reason: input.reason, orderCancelled, refund: refund?.refundNumber ?? null },
      ip: input.ip ?? null,
    });

    return { orderId: order.id, orderItemId: item.id, cancelledQuantity: quantity, orderCancelled, refund, stockChanges };
  });
}
