import type { Prisma } from "@prisma/client";

import { COUNTED_REFUND_STATUSES, OPEN_RETURN_STATUSES, type FulfillmentStatus, type OrderReturnStatus, type OrderStatus, type PaymentStatus } from "@/lib/enums";
import { derivePaymentStatus } from "@/features/finance/math";

/**
 * Derived order state (blueprint §14.C1, C4, B6).
 *
 * `Order.status` past PACKED, `fulfillmentStatus`, `returnStatus` and
 * `paymentStatus` are never set by hand: they are functions of the lines,
 * shipments, returns, refunds and payments. The pure functions below are the
 * specification (unit-tested in derived.test.ts); the `recompute*` helpers
 * read the rows inside the caller's transaction and write the result. The
 * returns and refunds modules call `recomputeOrderDerivedStatus` /
 * `applyRefundToOrder` after their own writes so every module agrees on what
 * "delivered", "returned" and "refunded" mean.
 */

type Db = Prisma.TransactionClient;

export type DerivationItem = {
  status: string;
  quantity: number;
  returnedQty: number;
  shippedAt: Date | null;
  deliveredAt: Date | null;
};

export type DerivationShipment = { status: string };

export type DerivationInput = {
  current: string;
  items: readonly DerivationItem[];
  shipments: readonly DerivationShipment[];
  openReturns: number;
  paidPaise: number;
  refundedPaise: number;
};

export type DerivedState = {
  status: OrderStatus;
  fulfillmentStatus: FulfillmentStatus;
  returnStatus: OrderReturnStatus;
};

const TERMINAL: readonly string[] = ["CANCELLED", "FAILED"];
const PRE_SHIPMENT: readonly string[] = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED"];

export function deriveFulfillmentStatus(items: readonly DerivationItem[]): FulfillmentStatus {
  const active = items.filter((item) => item.status !== "CANCELLED");
  if (active.length === 0) return "UNFULFILLED";
  const shipped = active.filter((item) => item.shippedAt !== null).length;
  if (shipped === 0) return "UNFULFILLED";
  return shipped === active.length ? "FULFILLED" : "PARTIAL";
}

export function deriveReturnStatus(items: readonly DerivationItem[], openReturns: number): OrderReturnStatus {
  if (openReturns > 0) return "REQUESTED";
  const active = items.filter((item) => item.status !== "CANCELLED");
  if (active.length === 0) return "NONE";
  const fully = active.filter((item) => item.returnedQty >= item.quantity).length;
  if (fully === active.length) return "FULL";
  return active.some((item) => item.returnedQty > 0) ? "PARTIAL" : "NONE";
}

/**
 * C1/C2/C4 in one place. CANCELLED and FAILED are terminal and never
 * re-derived. Return/refund states win over delivery states, delivery states
 * win over transit, and an order that has not shipped keeps whatever manual
 * pre-shipment status it holds.
 */
export function deriveOrderState(input: DerivationInput): DerivedState {
  const fulfillmentStatus = deriveFulfillmentStatus(input.items);
  const returnStatus = deriveReturnStatus(input.items, input.openReturns);

  if (TERMINAL.includes(input.current)) {
    return { status: input.current as OrderStatus, fulfillmentStatus, returnStatus };
  }

  const active = input.items.filter((item) => item.status !== "CANCELLED");
  const allDelivered = active.length > 0 && active.every((item) => item.deliveredAt !== null);
  const live = input.shipments.filter((shipment) => shipment.status !== "CANCELLED");

  let status: OrderStatus;
  if (active.length === 0) {
    status = "CANCELLED";
  } else if (returnStatus === "FULL" && input.paidPaise > 0 && input.refundedPaise >= input.paidPaise) {
    status = "REFUNDED";
  } else if (returnStatus === "FULL") {
    status = "RETURNED";
  } else if (returnStatus === "REQUESTED" && (allDelivered || input.current === "DELIVERED" || input.current === "RETURN_REQUESTED")) {
    status = "RETURN_REQUESTED";
  } else if (allDelivered) {
    status = "DELIVERED";
  } else if (live.some((shipment) => shipment.status === "OUT_FOR_DELIVERY")) {
    status = "OUT_FOR_DELIVERY";
  } else if (live.some((shipment) => ["SHIPPED", "IN_TRANSIT", "DELIVERED", "RETURNED_TO_ORIGIN"].includes(shipment.status))) {
    status = "SHIPPED";
  } else if (PRE_SHIPMENT.includes(input.current)) {
    status = input.current as OrderStatus;
  } else {
    // A derived status whose evidence disappeared (shipment cancelled after
    // SHIPPED): fall back to PACKED, the last manual state.
    status = "PACKED";
  }

  return { status, fulfillmentStatus, returnStatus };
}

// ---------------------------------------------------------------------------
// Transaction helpers
// ---------------------------------------------------------------------------

export type PaymentRecompute = {
  paymentStatus: PaymentStatus;
  paidPaise: number;
  refundedPaise: number;
  totalPaise: number;
};

/**
 * B6 derivation from the payment and refund rows. `Order.refundedPaise` is
 * Σ COMPLETED refunds; the pending ones only reduce the refundable cap.
 */
export async function recomputeOrderPaymentStatus(tx: Db, orderId: string): Promise<PaymentRecompute> {
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

  await tx.order.update({ where: { id: orderId }, data: { paymentStatus, refundedPaise } });
  return { paymentStatus, paidPaise, refundedPaise, totalPaise: order.totalPaise };
}

export type DerivedRecompute = DerivedState & { changed: boolean; previousStatus: string };

/**
 * Re-derive status / fulfillmentStatus / returnStatus from the rows and write
 * them. Cheap enough to call after every shipment, return or refund write.
 * Also maintains `Order.returnedPaise` (Σ returned units × unit value) and the
 * DELIVERED timestamp when the order reaches DELIVERED.
 */
export async function recomputeOrderDerivedStatus(tx: Db, orderId: string): Promise<DerivedRecompute> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      status: true,
      deliveredAt: true,
      items: { select: { status: true, quantity: true, returnedQty: true, shippedAt: true, deliveredAt: true, lineTotalPaise: true } },
      shipments: { select: { status: true } },
    },
  });
  const [openReturns, paid, refunded] = await Promise.all([
    tx.returnRequest.count({ where: { orderId, status: { in: [...OPEN_RETURN_STATUSES] } } }),
    tx.orderPayment.aggregate({ where: { orderId, status: "SUCCEEDED", type: { in: ["CHARGE", "CAPTURE"] } }, _sum: { amountPaise: true } }),
    tx.refund.aggregate({ where: { orderId, status: "COMPLETED" }, _sum: { amountPaise: true } }),
  ]);

  const derived = deriveOrderState({
    current: order.status,
    items: order.items,
    shipments: order.shipments,
    openReturns,
    paidPaise: paid._sum.amountPaise ?? 0,
    refundedPaise: refunded._sum.amountPaise ?? 0,
  });

  const returnedPaise = order.items.reduce((sum, item) => {
    if (item.quantity <= 0 || item.returnedQty <= 0) return sum;
    return sum + Math.round((item.lineTotalPaise * Math.min(item.returnedQty, item.quantity)) / item.quantity);
  }, 0);

  const changed = derived.status !== order.status;
  await tx.order.update({
    where: { id: orderId },
    data: {
      status: derived.status,
      fulfillmentStatus: derived.fulfillmentStatus,
      returnStatus: derived.returnStatus,
      returnedPaise,
      deliveredAt: derived.status === "DELIVERED" && !order.deliveredAt ? new Date() : undefined,
    },
  });

  return { ...derived, changed, previousStatus: order.status };
}

/**
 * For the refunds module: after a Refund row changes status, bring the order
 * in line - `OrderItem.refundedPaise` for RMA-linked refunds, `paymentStatus`
 * / `refundedPaise` (B6), the derived order status (REFUNDED when fully
 * refunded after a full return) and the customer's spend counter (C7).
 * Idempotent: it recomputes from the rows rather than adding deltas, except
 * for the item's refundedPaise which is Σ COMPLETED refunds linked to it.
 */
export async function applyRefundToOrder(
  tx: Db,
  refundId: string,
): Promise<{ orderId: string; payment: PaymentRecompute; derived: DerivedRecompute }> {
  const refund = await tx.refund.findUniqueOrThrow({
    where: { id: refundId },
    select: { id: true, orderId: true, status: true, returnRequest: { select: { orderItemId: true } } },
  });

  if (refund.returnRequest) {
    const itemId = refund.returnRequest.orderItemId;
    const completed = await tx.refund.aggregate({
      where: { status: "COMPLETED", returnRequest: { orderItemId: itemId } },
      _sum: { amountPaise: true },
    });
    const item = await tx.orderItem.findUnique({ where: { id: itemId }, select: { quantity: true, returnedQty: true, status: true } });
    if (item) {
      const refundedPaise = completed._sum.amountPaise ?? 0;
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          refundedPaise,
          status: refundedPaise > 0 && item.returnedQty >= item.quantity && item.status !== "CANCELLED" ? "REFUNDED" : undefined,
        },
      });
    }
  }

  const payment = await recomputeOrderPaymentStatus(tx, refund.orderId);
  const derived = await recomputeOrderDerivedStatus(tx, refund.orderId);

  // C7: spend counter follows Σ(total − refunded) over the customer's live orders.
  const order = await tx.order.findUnique({ where: { id: refund.orderId }, select: { customerId: true } });
  if (order?.customerId) await recomputeCustomerCounters(tx, order.customerId);

  return { orderId: refund.orderId, payment, derived };
}

/**
 * C7 counters, recomputed from the rows (a delta would drift after a retry).
 * Counted orders: DELIVERED and later (RETURN_REQUESTED/RETURNED/REFUNDED),
 * since the blueprint updates the counters "on DELIVERED/REFUNDED".
 */
export async function recomputeCustomerCounters(tx: Db, customerId: string): Promise<void> {
  const stats = await tx.order.aggregate({
    where: { customerId, status: { in: ["DELIVERED", "RETURN_REQUESTED", "RETURNED", "REFUNDED"] } },
    _count: { _all: true },
    _sum: { totalPaise: true, refundedPaise: true },
    _min: { placedAt: true },
    _max: { placedAt: true },
  });
  await tx.customer.update({
    where: { id: customerId },
    data: {
      orderCount: stats._count._all,
      totalSpentPaise: Math.max(0, (stats._sum.totalPaise ?? 0) - (stats._sum.refundedPaise ?? 0)),
      firstOrderAt: stats._min.placedAt ?? null,
      lastOrderAt: stats._max.placedAt ?? null,
    },
  });
}

/** Refund cap helper re-exported here so callers of derived.ts need one import. */
export async function countedRefundsPaise(tx: Db, orderId: string): Promise<number> {
  const counted = await tx.refund.aggregate({
    where: { orderId, status: { in: [...COUNTED_REFUND_STATUSES] } },
    _sum: { amountPaise: true },
  });
  return counted._sum.amountPaise ?? 0;
}
