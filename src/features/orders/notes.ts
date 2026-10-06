import { conflict, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit } from "@/lib/audit";
import { hashToken, randomToken } from "@/lib/crypto";
import { formatPaise } from "@/lib/money";
import { queueEmail } from "@/features/email/service";

import type { AddressValues } from "./schemas";
import { addOrderEvent, contactFor, lockOrder, orderItemsHtml, orderUrlFor, runOrderTx, type OrderActor } from "./shared";

/**
 * The quieter order mutations: notes, address edits and re-sending the
 * confirmation email. None of them move stock or money, but every one leaves
 * a timeline entry and an audit row so "who changed the address" is always
 * answerable.
 */

export type NoteResult = { eventId: string; orderId: string; isInternal: boolean };

export function addOrderNote(input: { orderId: string; message: string; isInternal: boolean; actor: OrderActor; ip?: string | null }): Promise<NoteResult> {
  return runOrderTx(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: input.orderId }, select: { id: true, orderNumber: true } });
    if (!order) throw notFound("Order");
    const event = await tx.orderEvent.create({
      data: { orderId: order.id, type: "NOTE", message: input.message, isInternal: input.isInternal, actorId: input.actor.id },
      select: { id: true },
    });
    await writeAudit(tx, {
      actor: input.actor,
      action: "order.note",
      entityType: "Order",
      entityId: order.id,
      entityLabel: order.orderNumber,
      summary: `${input.isInternal ? "Internal" : "Customer-visible"} note on ${order.orderNumber}`,
      diff: { isInternal: input.isInternal, length: input.message.length },
      ip: input.ip ?? null,
    });
    return { eventId: event.id, orderId: order.id, isInternal: input.isInternal };
  });
}

const ADDRESS_EDITABLE_STATUSES: readonly string[] = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED"];

/**
 * Shipping addresses are editable until the parcel leaves (the label is
 * printed from this row); billing can be corrected until delivery for the
 * invoice. Upserts so an order missing a billing row can gain one.
 */
export function updateOrderAddress(input: { orderId: string; type: "SHIPPING" | "BILLING"; values: AddressValues; actor: OrderActor; ip?: string | null }): Promise<{ orderId: string; type: string }> {
  return runOrderTx(async (tx) => {
    if (!(await lockOrder(tx, input.orderId))) throw notFound("Order");
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, select: { id: true, orderNumber: true, status: true } });
    if (input.type === "SHIPPING" && !ADDRESS_EDITABLE_STATUSES.includes(order.status)) {
      throw conflict("The shipping address cannot change once the order has shipped.");
    }
    if (input.type === "BILLING" && ["CANCELLED", "FAILED", "REFUNDED"].includes(order.status)) {
      throw conflict("This order is closed; its billing address is frozen.");
    }

    const before = await tx.orderAddress.findUnique({ where: { orderId_type: { orderId: order.id, type: input.type } } });
    const data = {
      fullName: input.values.fullName,
      phone: input.values.phone,
      email: input.values.email ?? null,
      line1: input.values.line1,
      line2: input.values.line2 ?? null,
      landmark: input.values.landmark ?? null,
      city: input.values.city,
      state: input.values.state,
      pinCode: input.values.pinCode,
      country: input.values.country,
    };
    await tx.orderAddress.upsert({
      where: { orderId_type: { orderId: order.id, type: input.type } },
      create: { orderId: order.id, type: input.type, ...data },
      update: data,
    });

    const label = input.type === "SHIPPING" ? "Shipping" : "Billing";
    await addOrderEvent(tx, {
      orderId: order.id,
      type: "SYSTEM",
      isInternal: true,
      message: `${label} address updated to ${data.line1}, ${data.city} ${data.pinCode}`,
      metadata: { type: input.type },
      actorId: input.actor.id,
    });
    await writeAudit(tx, {
      actor: input.actor,
      action: "order.address_update",
      entityType: "Order",
      entityId: order.id,
      entityLabel: order.orderNumber,
      summary: `${label} address changed on ${order.orderNumber}`,
      diff: diffOf(before ? { ...data, ...pick(before) } : null, data),
      ip: input.ip ?? null,
    });
    return { orderId: order.id, type: input.type };
  });
}

function pick(row: { fullName: string; phone: string; email: string | null; line1: string; line2: string | null; landmark: string | null; city: string; state: string; pinCode: string; country: string }) {
  return { fullName: row.fullName, phone: row.phone, email: row.email, line1: row.line1, line2: row.line2, landmark: row.landmark, city: row.city, state: row.state, pinCode: row.pinCode, country: row.country };
}

/**
 * Re-send `order_confirmation`. The original tracking token was shown once
 * (D1) and is not recoverable from its hash, so a resend ROTATES it: the new
 * link works, the old one stops. The outbox dedupe key carries a timestamp
 * so the resend is not swallowed as a duplicate of the original.
 */
export function resendOrderConfirmation(input: { orderId: string; actor: OrderActor; ip?: string | null }): Promise<{ queued: boolean; reason: string | null; email: string }> {
  return runOrderTx(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalPaise: true,
        paymentMethod: true,
        guestEmail: true,
        customer: { select: { email: true, fullName: true } },
        addresses: { select: { type: true, fullName: true, email: true } },
        items: { where: { status: "ACTIVE" }, select: { titleSnapshot: true, variantSnapshot: true, quantity: true, lineTotalPaise: true } },
      },
    });
    if (!order) throw notFound("Order");
    if (["CANCELLED", "FAILED"].includes(order.status)) throw conflict("A cancelled or failed order has no confirmation to send.");
    const contact = contactFor(order);
    if (!contact.email) throw conflict("This order has no customer email.");

    const token = randomToken();
    await tx.order.update({ where: { id: order.id }, data: { accessTokenHash: hashToken(token) } });

    const result = await queueEmail({
      templateKey: "order_confirmation",
      to: { email: contact.email, name: contact.name },
      vars: {
        customer_name: contact.name,
        order_id: order.orderNumber,
        order_total: formatPaise(order.totalPaise),
        order_items_html: orderItemsHtml(order.items),
        order_url: await orderUrlFor(tx, order.orderNumber, token),
        payment_method: order.paymentMethod,
      },
      entity: { type: "Order", id: order.id },
      dedupeKey: `order_confirmation:Order:${order.id}:resend:${Date.now()}`,
      tx,
    });

    await addOrderEvent(tx, {
      orderId: order.id,
      type: "SYSTEM",
      isInternal: true,
      message: result.queued ? `Confirmation email re-sent to ${contact.email} (tracking link rotated)` : `Confirmation email not sent: ${result.reason}`,
      actorId: input.actor.id,
    });
    await writeAudit(tx, {
      actor: input.actor,
      action: "order.resend_confirmation",
      entityType: "Order",
      entityId: order.id,
      entityLabel: order.orderNumber,
      summary: `Re-sent confirmation for ${order.orderNumber} to ${contact.email}`,
      diff: { queued: result.queued, reason: result.queued ? null : result.reason },
      ip: input.ip ?? null,
    });

    return { queued: result.queued, reason: result.queued ? null : result.reason, email: contact.email };
  });
}
