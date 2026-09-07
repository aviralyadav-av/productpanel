"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { requireAdminOrThrow } from "@/lib/auth/guards";
import { writeAudit, diffOf } from "@/lib/audit";
import {
  ok,
  fail,
  zodFail,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import {
  ORDER_STATUS_META,
  ORDER_TRANSITIONS,
  PAYMENT_STATUS_META,
  TERMINAL_ORDER_STATUSES,
  canTransition,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/enums";
import { formatPaise, rupeesToPaise } from "@/lib/money";
import {
  addOrderNoteSchema,
  changeOrderStatusSchema,
  markPaymentStatusSchema,
  recordRefundSchema,
  updateShippingAddressSchema,
  type AddOrderNoteInput,
  type ChangeOrderStatusInput,
  type MarkPaymentStatusInput,
  type RecordRefundInput,
  type UpdateShippingAddressInput,
} from "./schemas";

function label(status: OrderStatus): string {
  return ORDER_STATUS_META[status].label;
}

function revalidateOrder(orderId: string) {
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  // Order totals and pipeline counts are on the dashboard and in the sidebar
  // badge, both of which are rendered from the same rows.
  revalidatePath("/dashboard");
}

/**
 * The order state machine.
 *
 * ORDER_TRANSITIONS is the whole rulebook. The detail page disables moves that
 * are not reachable, but that is an affordance - this function is the check,
 * because a Server Action is a public HTTP endpoint and the UI is not.
 */
export async function changeOrderStatus(
  input: ChangeOrderStatusInput,
): Promise<ActionResult<{ status: OrderStatus; restockedUnits: number }>> {
  const actor = await requireAdminOrThrow();

  const parsed = changeOrderStatusSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  const { orderId, toStatus } = parsed.data;
  const reason =
    [parsed.data.reason, parsed.data.detail].filter(Boolean).join(" — ") ||
    null;

  return runAction<{ status: OrderStatus; restockedUnits: number }>(async () => {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        items: {
          select: {
            variantId: true,
            quantity: true,
            titleSnapshot: true,
            variantSnapshot: true,
          },
        },
      },
    });

    if (!order) return fail("That order no longer exists.");

    const fromStatus = order.status as OrderStatus;

    if (fromStatus === toStatus) {
      return fail(`This order is already ${label(toStatus).toLowerCase()}.`);
    }

    if (!canTransition(fromStatus, toStatus)) {
      const allowed = ORDER_TRANSITIONS[fromStatus] ?? [];
      return fail(
        allowed.length === 0
          ? `${label(fromStatus)} is a final status. This order cannot change again.`
          : `An order that is ${label(fromStatus).toLowerCase()} can only move to ${allowed
              .map((next) => label(next).toLowerCase())
              .join(" or ")}.`,
      );
    }

    const restocks = TERMINAL_ORDER_STATUSES.includes(toStatus);
    let restockedUnits = 0;

    await db.$transaction(async (tx) => {
      const data: Prisma.OrderUpdateInput = { status: toStatus };

      // PROCESSING and RETURNED have no timestamp column on Order. Their
      // OrderEvent row is the timestamp, which is why the timeline is the
      // authoritative history and these columns are only a fast path.
      if (toStatus === "CONFIRMED") data.confirmedAt = new Date();
      if (toStatus === "SHIPPED") data.shippedAt = new Date();
      if (toStatus === "DELIVERED") data.deliveredAt = new Date();
      if (toStatus === "CANCELLED") {
        data.cancelledAt = new Date();
        data.cancelReason = reason;
      }

      await tx.order.update({ where: { id: order.id }, data });

      if (restocks) {
        // One movement per line, read-then-write in sequence so the running
        // balance is right even when two lines share a variant.
        for (const item of order.items) {
          if (!item.variantId || item.quantity <= 0) continue;

          const inventory = await tx.inventoryItem.findUnique({
            where: { variantId: item.variantId },
            select: { onHand: true },
          });
          // A variant deleted since the order was placed has no inventory row
          // to restock into. Skipping is honest; inventing one is not.
          if (!inventory) continue;

          const balance = inventory.onHand + item.quantity;

          await tx.inventoryItem.update({
            where: { variantId: item.variantId },
            data: { onHand: balance },
          });

          await tx.stockMovement.create({
            data: {
              variantId: item.variantId,
              delta: item.quantity,
              type: toStatus === "RETURNED" ? "RETURN" : "ADJUSTMENT",
              reason:
                toStatus === "RETURNED" ? "Order returned" : "Order cancelled",
              note: [order.orderNumber, item.titleSnapshot, item.variantSnapshot]
                .filter(Boolean)
                .join(" · "),
              orderId: order.id,
              actorId: actor.id,
              balance,
            },
          });

          restockedUnits += item.quantity;
        }
      }

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: "STATUS_CHANGE",
          fromStatus,
          toStatus,
          message: [
            `${label(fromStatus)} → ${label(toStatus)}`,
            reason,
            restockedUnits > 0
              ? `${restockedUnits} unit${restockedUnits === 1 ? "" : "s"} returned to stock`
              : null,
          ]
            .filter(Boolean)
            .join(" · "),
          actorId: actor.id,
        },
      });
    });

    // Audit lives outside the transaction on purpose: writeAudit uses the
    // shared client and swallows its own failures, and a lost audit row must
    // never roll back the status change an operator actually asked for.
    await writeAudit({
      actor,
      action: "order.status_change",
      entityType: "Order",
      entityId: order.id,
      summary: `Order ${order.orderNumber} moved from ${label(fromStatus)} to ${label(toStatus)}`,
      diff: diffOf(
        { status: fromStatus },
        { status: toStatus, cancelReason: reason, restockedUnits },
      ),
    });

    revalidateOrder(order.id);
    if (restockedUnits > 0) revalidatePath("/inventory");

    return ok(
      { status: toStatus, restockedUnits },
      restockedUnits > 0
        ? `Order ${order.orderNumber} is ${label(toStatus).toLowerCase()}. ${restockedUnits} unit${restockedUnits === 1 ? "" : "s"} returned to stock.`
        : `Order ${order.orderNumber} is now ${label(toStatus).toLowerCase()}.`,
    );
  });
}

/**
 * Notes are always internal. There is no customer-facing order view in this
 * project for a public note to appear on, so offering the choice would be
 * offering something that does not exist.
 */
export async function addOrderNote(
  input: AddOrderNoteInput,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();

  const parsed = addOrderNoteSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  const { orderId, message } = parsed.data;

  return runAction<{ id: string }>(async () => {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true },
    });
    if (!order) return fail("That order no longer exists.");

    const event = await db.orderEvent.create({
      data: {
        orderId: order.id,
        type: "NOTE",
        message,
        isInternal: true,
        actorId: actor.id,
      },
      select: { id: true },
    });

    await writeAudit({
      actor,
      action: "order.note",
      entityType: "Order",
      entityId: order.id,
      summary: `Note added to order ${order.orderNumber}`,
      diff: diffOf(null, { message }),
    });

    revalidateOrder(order.id);
    return ok({ id: event.id }, "Note added to the timeline.");
  });
}

/**
 * Bookkeeping, not an integration. No payment gateway exists anywhere in this
 * project, so this records what the operator knows to be true - money received
 * in hand for a COD delivery, or a bank transfer they can see.
 */
export async function markPaymentStatus(
  input: MarkPaymentStatusInput,
): Promise<ActionResult<{ paymentStatus: PaymentStatus }>> {
  const actor = await requireAdminOrThrow();

  const parsed = markPaymentStatusSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  const { orderId, paymentStatus, note } = parsed.data;

  return runAction<{ paymentStatus: PaymentStatus }>(async () => {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        paymentStatus: true,
        paymentMethod: true,
        refundedPaise: true,
      },
    });
    if (!order) return fail("That order no longer exists.");

    const previous = order.paymentStatus as PaymentStatus;

    if (previous === paymentStatus) {
      return fail(
        `Payment is already marked ${PAYMENT_STATUS_META[paymentStatus].label.toLowerCase()}.`,
      );
    }

    // Refund states are derived from the refund ledger. Letting an operator
    // overwrite them by hand would make refundedPaise and paymentStatus
    // disagree with no way to tell which one is wrong.
    if (order.refundedPaise > 0) {
      return fail(
        `${formatPaise(order.refundedPaise)} has been refunded on this order, so its payment status is set by the refund record.`,
      );
    }

    await db.$transaction([
      db.order.update({
        where: { id: order.id },
        data: { paymentStatus },
      }),
      db.orderEvent.create({
        data: {
          orderId: order.id,
          type: "PAYMENT",
          message: [
            `Payment marked ${PAYMENT_STATUS_META[paymentStatus].label.toLowerCase()} (${order.paymentMethod})`,
            note,
          ]
            .filter(Boolean)
            .join(" · "),
          actorId: actor.id,
        },
      }),
    ]);

    await writeAudit({
      actor,
      action: "order.payment_status",
      entityType: "Order",
      entityId: order.id,
      summary: `Order ${order.orderNumber} payment marked ${PAYMENT_STATUS_META[paymentStatus].label.toLowerCase()}`,
      diff: diffOf({ paymentStatus: previous }, { paymentStatus, note }),
    });

    revalidateOrder(order.id);
    return ok(
      { paymentStatus },
      `Payment marked ${PAYMENT_STATUS_META[paymentStatus].label.toLowerCase()}.`,
    );
  });
}

/**
 * A refund here moves no money. It records that a refund happened outside this
 * system so the books, the timeline and the revenue figures agree with reality.
 */
export async function recordRefund(
  input: RecordRefundInput,
): Promise<ActionResult<{ refundedPaise: number; paymentStatus: PaymentStatus }>> {
  const actor = await requireAdminOrThrow();

  const parsed = recordRefundSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  const { orderId, reason } = parsed.data;
  const amountPaise = rupeesToPaise(parsed.data.amountRupees);

  return runAction<{ refundedPaise: number; paymentStatus: PaymentStatus }>(async () => {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        totalPaise: true,
        refundedPaise: true,
        paymentStatus: true,
      },
    });
    if (!order) return fail("That order no longer exists.");

    const remaining = order.totalPaise - order.refundedPaise;
    if (remaining <= 0) {
      return fail("This order is already refunded in full.");
    }

    if (amountPaise > remaining) {
      return fail(
        `That is more than is left to refund. At most ${formatPaise(remaining)} can still be refunded on this order.`,
        { amountRupees: `Maximum ${formatPaise(remaining)}` },
      );
    }

    const refundedPaise = order.refundedPaise + amountPaise;
    const paymentStatus: PaymentStatus =
      refundedPaise >= order.totalPaise ? "REFUNDED" : "PARTIALLY_REFUNDED";
    const previous = order.paymentStatus as PaymentStatus;

    await db.$transaction([
      db.order.update({
        where: { id: order.id },
        data: { refundedPaise, paymentStatus },
      }),
      db.orderEvent.create({
        data: {
          orderId: order.id,
          type: "REFUND",
          message: [
            `Refund of ${formatPaise(amountPaise)} recorded (${formatPaise(refundedPaise)} of ${formatPaise(order.totalPaise)} total)`,
            reason,
          ]
            .filter(Boolean)
            .join(" · "),
          actorId: actor.id,
        },
      }),
    ]);

    await writeAudit({
      actor,
      action: "order.refund",
      entityType: "Order",
      entityId: order.id,
      summary: `Refund of ${formatPaise(amountPaise)} recorded on order ${order.orderNumber}`,
      diff: diffOf(
        { refundedPaise: order.refundedPaise, paymentStatus: previous },
        { refundedPaise, paymentStatus, reason },
      ),
    });

    revalidateOrder(order.id);
    return ok(
      { refundedPaise, paymentStatus },
      `Recorded a ${formatPaise(amountPaise)} refund.`,
    );
  });
}

/**
 * The shipping block is a snapshot taken at checkout, so editing it changes
 * this order only - never the customer's saved address.
 */
export async function updateShippingAddress(
  input: UpdateShippingAddressInput,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();

  const parsed = updateShippingAddressSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  const { orderId, ...address } = parsed.data;

  return runAction<{ id: string }>(async () => {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        shipFullName: true,
        shipEmail: true,
        shipPhone: true,
        shipAddress: true,
        shipCity: true,
        shipState: true,
        shipPinCode: true,
      },
    });
    if (!order) return fail("That order no longer exists.");

    if (order.status === "DELIVERED" || order.status === "RETURNED") {
      return fail(
        `This order is already ${order.status.toLowerCase()}. Its delivery address is now part of the record and cannot be rewritten.`,
      );
    }

    const before = {
      shipFullName: order.shipFullName,
      shipEmail: order.shipEmail,
      shipPhone: order.shipPhone,
      shipAddress: order.shipAddress,
      shipCity: order.shipCity,
      shipState: order.shipState,
      shipPinCode: order.shipPinCode,
    };

    const diff = diffOf(before, address);
    if (!diff) return ok({ id: order.id }, "Nothing changed.");

    await db.$transaction([
      db.order.update({ where: { id: order.id }, data: address }),
      db.orderEvent.create({
        data: {
          orderId: order.id,
          type: "SYSTEM",
          message: `Shipping details edited: ${Object.keys(
            diff as unknown as Record<string, unknown>,
          )
            .map((key) => key.replace(/^ship/, "").toLowerCase())
            .join(", ")}`,
          isInternal: true,
          actorId: actor.id,
        },
      }),
    ]);

    await writeAudit({
      actor,
      action: "order.address_update",
      entityType: "Order",
      entityId: order.id,
      summary: `Shipping details edited on order ${order.orderNumber}`,
      diff,
    });

    revalidateOrder(order.id);
    return ok({ id: order.id }, "Shipping details updated.");
  });
}
