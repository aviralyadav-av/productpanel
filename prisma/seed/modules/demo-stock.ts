import type { PrismaClient } from "@prisma/client";

import { readSettingNumber } from "@/features/finance/settings-reader";
import { commitReservation, releaseStock, reserveStock, restock, type StockChange } from "@/features/inventory/service";
import type { SeedContext } from "./context";
import { addMinutes } from "../lib/rng";
import { state, transaction, type Tx } from "../lib/state";

/**
 * Stock movements for the demo orders and returns (blueprint §14.C3, D7, F7).
 *
 * The movement ledger is the source of truth and `balance` is "onHand after
 * this movement", so rows must be written in the order the events happened.
 * Orders are created per order (demo-orders.ts), but their events are spread
 * over ninety days, so this module derives every C3 movement from what was
 * persisted - one RESERVE per line at placement, SALE at confirmation,
 * RELEASE on failure or pre-confirmation cancellation, RETURN on
 * post-confirmation cancellation and on a return's QC pass - sorts them all
 * by time, and applies them through the inventory service wrappers, then
 * stamps each row with the time it records. Replaying the ledger for any
 * variant reproduces InventoryItem exactly, and "last movement" agrees with
 * "current stock" whichever way you sort.
 *
 * Idempotent: orders that already have movements are skipped, and a return's
 * restock is keyed by its RMA number in the note.
 */

type Kind = "RESERVE" | "SALE" | "RELEASE" | "RETURN";

type Event = {
  at: Date;
  /** Tie-break so one order's events keep their natural sequence. */
  rank: number;
  kind: Kind;
  variantId: string;
  quantity: number;
  orderId: string;
  actorId: string | null;
  reason?: string;
  note?: string | null;
};

const KIND_RANK: Record<Kind, number> = { RESERVE: 0, SALE: 1, RELEASE: 2, RETURN: 3 };

export async function seedDemoStock(db: PrismaClient, ctx: SeedContext): Promise<void> {
  const paymentTimeoutMinutes = (await readSettingNumber(db, "checkout.payment_timeout_minutes")) || 20;

  const withMovements = new Set(
    (await db.stockMovement.groupBy({ by: ["orderId"], where: { orderId: { startsWith: "demo_order_" } } }))
      .map((row) => row.orderId)
      .filter((id): id is string => Boolean(id)),
  );

  const orders = await db.order.findMany({
    where: { id: { startsWith: "demo_order_" } },
    orderBy: { seq: "asc" },
    select: {
      id: true,
      seq: true,
      status: true,
      source: true,
      placedAt: true,
      confirmedAt: true,
      cancelledAt: true,
      createdById: true,
      items: { select: { variantId: true, quantity: true } },
    },
  });

  const events: Event[] = [];
  let ordersPlanned = 0;
  for (const order of orders) {
    if (withMovements.has(order.id)) continue;
    ordersPlanned += 1;
    const base = { orderId: order.id, rank: order.seq * 10 };
    for (const item of order.items) {
      if (!item.variantId) continue;
      const line = { variantId: item.variantId, quantity: item.quantity };
      events.push({ ...base, ...line, kind: "RESERVE", at: order.placedAt, actorId: null, rank: base.rank + KIND_RANK.RESERVE });

      if (order.status === "FAILED") {
        events.push({ ...base, ...line, kind: "RELEASE", at: addMinutes(order.placedAt, paymentTimeoutMinutes), actorId: null, note: "Payment window expired", rank: base.rank + KIND_RANK.RELEASE });
        continue;
      }
      if (order.status === "CANCELLED" && !order.confirmedAt) {
        events.push({ ...base, ...line, kind: "RELEASE", at: order.cancelledAt ?? order.placedAt, actorId: null, note: "Cancelled before confirmation", rank: base.rank + KIND_RANK.RELEASE });
        continue;
      }
      if (order.confirmedAt) {
        events.push({ ...base, ...line, kind: "SALE", at: order.confirmedAt, actorId: order.source === "MANUAL" ? order.createdById : null, rank: base.rank + KIND_RANK.SALE });
      }
      if (order.status === "CANCELLED" && order.confirmedAt) {
        events.push({ ...base, ...line, kind: "RETURN", at: order.cancelledAt ?? order.confirmedAt, actorId: ctx.adminUserId, reason: "ORDER_CANCELLED", note: "Cancelled after confirmation - units back on the shelf", rank: base.rank + KIND_RANK.RETURN });
      }
    }
  }

  // Returns whose QC passed put the unit back (C3, C4).
  const passed = await db.returnRequest.findMany({
    where: { id: { startsWith: "demo_rma_" }, events: { some: { toStatus: "QC_PASSED" } } },
    select: {
      id: true,
      rmaNumber: true,
      orderId: true,
      quantity: true,
      orderItem: { select: { variantId: true } },
      events: { where: { toStatus: "QC_PASSED" }, select: { createdAt: true }, take: 1 },
    },
  });
  let returnsPlanned = 0;
  for (const rma of passed) {
    if (!rma.orderItem.variantId || !rma.events[0]) continue;
    const note = `Return ${rma.rmaNumber}`;
    const exists = await db.stockMovement.findFirst({ where: { orderId: rma.orderId, type: "RETURN", note }, select: { id: true } });
    if (exists) continue;
    returnsPlanned += 1;
    events.push({
      at: rma.events[0].createdAt,
      rank: 1_000_000_000,
      kind: "RETURN",
      variantId: rma.orderItem.variantId,
      quantity: rma.quantity,
      orderId: rma.orderId,
      actorId: ctx.adminUserId,
      reason: "RETURN_QC_PASSED",
      note,
    });
  }

  events.sort((x, y) => x.at.getTime() - y.at.getTime() || x.rank - y.rank);

  // Apply in time order, in transaction chunks, stamping each row's time.
  const CHUNK = 150;
  let applied = 0;
  for (let start = 0; start < events.length; start += CHUNK) {
    const chunk = events.slice(start, start + CHUNK);
    await transaction(db, async (tx: Tx) => {
      for (const event of chunk) {
        const input = { variantId: event.variantId, quantity: event.quantity, orderId: event.orderId, actorId: event.actorId, note: event.note ?? null };
        let change: StockChange;
        switch (event.kind) {
          case "RESERVE":
            change = await reserveStock(tx, input);
            break;
          case "SALE":
            change = await commitReservation(tx, input);
            break;
          case "RELEASE":
            change = await releaseStock(tx, input);
            break;
          case "RETURN":
            change = await restock(tx, { ...input, reason: event.reason ?? "RETURN" });
            break;
        }
        await tx.stockMovement.update({ where: { id: change.movementId }, data: { createdAt: event.at } });
      }
    });
    applied += chunk.length;
  }

  // Refresh the in-memory availability the content module may consult.
  if (applied > 0) {
    const items = await db.inventoryItem.findMany({ select: { variantId: true, available: true } });
    const byVariant = new Map(items.map((item) => [item.variantId, item.available]));
    for (const product of state.products) {
      for (const variant of product.variants) variant.available = byVariant.get(variant.id) ?? variant.available;
    }
  }

  const states = await db.inventoryItem.groupBy({ by: ["stockState"], _count: { _all: true } });
  const mix = states.map((row) => `${row.stockState} ${row._count._all}`).join(", ");
  ctx.log(`stock movements applied: ${applied} (orders ${ordersPlanned}, return restocks ${returnsPlanned}) · ${mix}`);
}
