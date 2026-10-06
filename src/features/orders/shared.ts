import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import type { AuditActor } from "@/lib/audit";
import type { OrderEventType } from "@/lib/enums";
import { afterStockChange, type StockChange } from "@/features/inventory/service";
import { nextNumber } from "@/features/finance/service";
import { readSettingString } from "@/features/finance/settings-reader";
import { emitEvent } from "@/features/notifications/service";
import { escapeHtml } from "@/features/email/render";

/**
 * Small pieces every orders service file shares. Kept free of `next/*` so the
 * worker, the check script and node:test can import the services directly.
 */

export type Db = Prisma.TransactionClient;
export type OrderActor = AuditActor;

/** Interactive transactions default to 5 s; an order touches many rows. */
export const ORDER_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;

export function runOrderTx<T>(body: (tx: Db) => Promise<T>): Promise<T> {
  return db.$transaction(body, ORDER_TX_OPTIONS);
}

/**
 * Serialise concurrent writers on one order (a webhook confirming while an
 * operator cancels). Prisma has no row-lock API, so it is raw SQL on the same
 * transaction client; the lock holds until commit.
 */
export async function lockOrder(tx: Db, orderId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  return rows.length > 0;
}

export async function addOrderEvent(
  tx: Db,
  input: {
    orderId: string;
    type: OrderEventType;
    message: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    isInternal?: boolean;
    metadata?: Record<string, unknown>;
    actorId?: string | null;
  },
): Promise<void> {
  await tx.orderEvent.create({
    data: {
      orderId: input.orderId,
      type: input.type,
      message: input.message,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      isInternal: input.isInternal ?? false,
      metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined,
      // The seeded SYSTEM user is a real row; any other synthetic id is dropped.
      actorId: input.actorId ?? null,
    },
  });
}

/** Stock side effects must run AFTER the transaction commits (facets, alerts). */
export async function settleStockChanges(changes: readonly StockChange[]): Promise<void> {
  for (const change of changes) {
    try {
      await afterStockChange(change.variantId, change);
    } catch (error) {
      console.error("AFTER STOCK CHANGE FAILED", change.variantId, error);
    }
  }
}

/** Storefront URL of an order for emails; the token is only added at creation (D1). */
export async function orderUrlFor(tx: Db | undefined, orderNumber: string, token?: string): Promise<string> {
  const base = ((await readSettingString(tx, "storefront.base_url")) || "").replace(/\/+$/, "");
  const path = `${base}/orders/${encodeURIComponent(orderNumber)}`;
  return token ? `${path}?token=${encodeURIComponent(token)}` : path;
}

export type OrderContact = { name: string; email: string };

/** Who the customer-facing emails go to: the account, else the shipping address, else the guest email. */
export function contactFor(order: {
  guestEmail: string | null;
  customer: { email: string; fullName: string | null } | null;
  addresses: Array<{ type: string; fullName: string; email: string | null }>;
}): OrderContact {
  const shipping = order.addresses.find((address) => address.type === "SHIPPING");
  return {
    name: order.customer?.fullName || shipping?.fullName || "Customer",
    email: order.customer?.email || shipping?.email || order.guestEmail || "",
  };
}

/** The `{{order_items_html}}` table for the confirmation email (E3). */
export function orderItemsHtml(
  items: ReadonlyArray<{ titleSnapshot: string; variantSnapshot: string | null; quantity: number; lineTotalPaise: number }>,
): string {
  const rows = items
    .map(
      (item) =>
        `<tr><td style="padding:4px 8px">${escapeHtml(item.titleSnapshot)}${item.variantSnapshot ? ` <span style="color:#666">(${escapeHtml(item.variantSnapshot)})</span>` : ""}</td>` +
        `<td style="padding:4px 8px;text-align:right">× ${item.quantity}</td>` +
        `<td style="padding:4px 8px;text-align:right">${escapeHtml(formatPaise(item.lineTotalPaise))}</td></tr>`,
    )
    .join("");
  return `<table style="border-collapse:collapse;width:100%">${rows}</table>`;
}

/**
 * Cancellation / RTO refund (C2, B6): a PENDING Refund for what the customer
 * actually paid, by the method the payment allows (COD cash cannot go back to
 * a gateway). Returns null when nothing is refundable.
 */
export async function createCancellationRefund(
  tx: Db,
  input: { orderId: string; amountPaise: number; reason: string; actorId?: string | null },
): Promise<{ id: string; refundNumber: string; amountPaise: number } | null> {
  if (input.amountPaise <= 0) return null;
  const order = await tx.order.findUniqueOrThrow({
    where: { id: input.orderId },
    select: {
      orderNumber: true,
      paymentMethod: true,
      payments: { where: { status: "SUCCEEDED", type: { in: ["CHARGE", "CAPTURE"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, provider: true } },
    },
  });
  const source = order.payments[0] ?? null;
  const gateway = source && !["COD", "MANUAL"].includes(source.provider);
  const method = gateway ? "ORIGINAL" : "BANK_TRANSFER";
  const { number } = await nextNumber(tx, "Refund");
  const refund = await tx.refund.create({
    data: {
      refundNumber: number,
      orderId: input.orderId,
      orderPaymentId: source?.id ?? null,
      amountPaise: input.amountPaise,
      reason: input.reason,
      method,
      status: "PENDING",
      provider: gateway ? source?.provider : null,
      initiatedById: input.actorId && input.actorId !== "system" ? input.actorId : null,
    },
    select: { id: true, refundNumber: true, amountPaise: true },
  });
  await addOrderEvent(tx, {
    orderId: input.orderId,
    type: "REFUND",
    message: `Refund ${refund.refundNumber} of ${formatPaise(refund.amountPaise)} created (${method.toLowerCase().replace("_", " ")}) - awaiting approval`,
    metadata: { refundId: refund.id, method },
    actorId: input.actorId ?? null,
  });
  await emitEvent(
    "refund.pending",
    { refundId: refund.id, refundNumber: refund.refundNumber, orderNumber: order.orderNumber, amountText: formatPaise(refund.amountPaise), method },
    tx,
  );
  return refund;
}

/** Actor id safe to store on FK columns: real users only (SYSTEM_ACTOR is seeded as "system"). */
export function actorIdFor(actor: OrderActor): string | null {
  return actor.id || null;
}
