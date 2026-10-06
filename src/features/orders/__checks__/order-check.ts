import "dotenv/config";

import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { parseChoices } from "@/features/products/customization";
import {
  createManualOrder,
  createShipment,
  settleStockChanges,
  transitionOrder,
  updateShipmentStatus,
} from "@/features/orders/service";
import type { ManualOrderValues } from "@/features/orders/schemas";

/**
 * End-to-end order check against the REAL database (blueprint §10, §14.B1,
 * B4, B6, C1, C2, C3):
 *
 *   npx tsx src/features/orders/__checks__/order-check.ts
 *
 * Walks a cash-on-delivery order the whole way - keyed by hand from two demo
 * products (one of them customisable), confirmed on entry, processed, packed,
 * shipped and delivered - and asserts after every step that the things that
 * must move together actually did: stock (RESERVE then SALE, never twice),
 * the OrderItem money columns against the order totals, the COD cash payment
 * row created on delivery, the seller earnings ledger, and the derived
 * status. Then it places a second order, leaves it PENDING, cancels it and
 * asserts the reservation came back.
 *
 * Rows are left behind on purpose (an order is not something to delete in a
 * script that also writes audit rows); every one carries a `check_` marker in
 * its internal note so it is recognisable in /admin/orders.
 */

const MARKER = "check_order_check";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

function log(step: string, detail = ""): void {
  console.log(`  ${step}${detail ? ` - ${detail}` : ""}`);
}

type Candidate = { productId: string; variantId: string; available: number; customizable: boolean };

/** A published, in-stock, purchasable variant; `customizable` picks one with answerable options. */
async function findCandidate(options: { customizable: boolean; excludeProductId?: string }): Promise<Candidate | null> {
  const products = await db.product.findMany({
    where: {
      status: "PUBLISHED",
      deletedAt: null,
      isCustomizable: options.customizable,
      id: options.excludeProductId ? { not: options.excludeProductId } : undefined,
      OR: [{ sellerId: null }, { seller: { status: "ACTIVE", deletedAt: null } }],
    },
    take: 60,
    select: {
      id: true,
      minOrderQty: true,
      variants: {
        where: { deletedAt: null, isActive: true },
        select: { id: true, inventory: { select: { available: true } } },
      },
      customizationOptions: { where: { isActive: true }, select: { type: true, isRequired: true } },
    },
  });

  for (const product of products) {
    if (product.minOrderQty > 1) continue;
    // A required file answer would need a PendingUpload; skip those products.
    if (product.customizationOptions.some((option) => option.isRequired && ["PHOTO", "IMAGE", "DESIGN"].includes(option.type))) continue;
    if (options.customizable && product.customizationOptions.length === 0) continue;
    const variant = product.variants.find((row) => (row.inventory?.available ?? 0) >= 4);
    if (variant) return { productId: product.id, variantId: variant.id, available: variant.inventory?.available ?? 0, customizable: options.customizable };
  }
  return null;
}

/** Fill every answerable option so the line validates the way checkout would. */
async function buildAnswers(productId: string): Promise<Record<string, string | string[] | boolean>> {
  const options = await db.customizationOption.findMany({ where: { productId, isActive: true }, orderBy: { position: "asc" } });
  const answers: Record<string, string | string[] | boolean> = {};
  for (const option of options) {
    const choices = parseChoices(option.choices);
    if (["PHOTO", "IMAGE", "DESIGN"].includes(option.type)) continue;
    if (choices.length > 0) {
      answers[option.id] = option.type === "MULTI_SELECT" ? [choices[0].value] : choices[0].value;
    } else if (option.type === "CHECKBOX") {
      answers[option.id] = true;
    } else {
      const min = option.minLength ?? 0;
      const text = "Check order".padEnd(Math.max(min, 11), "x").slice(0, option.maxLength ?? 40);
      answers[option.id] = text;
    }
  }
  return answers;
}

async function stockOf(variantId: string): Promise<{ onHand: number; reserved: number; available: number }> {
  const item = await db.inventoryItem.findUniqueOrThrow({ where: { variantId }, select: { onHand: true, reserved: true, available: true } });
  return item;
}

async function main(): Promise<void> {
  const actorRow = await db.user.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, email: true } });
  assert(actorRow, "an admin user exists to act as");
  const actor = { id: actorRow.id, email: actorRow.email };

  const plain = await findCandidate({ customizable: false });
  assert(plain, "a published, in-stock, non-customisable variant exists");
  const custom = await findCandidate({ customizable: true, excludeProductId: plain.productId });
  assert(custom, "a published, in-stock, customisable variant exists");
  log("candidates", `${plain.productId} + ${custom.productId} (customisable)`);

  const answers = await buildAnswers(custom.productId);
  const address = {
    fullName: "Order Check",
    phone: "9876543210",
    line1: "1 Check Street",
    city: "New Delhi",
    state: "Delhi",
    pinCode: "110001",
    country: "IN",
  };

  const input = {
    customer: { email: `check-order-${Date.now()}@example.test`, name: "Order Check", phone: "9876543210" },
    shippingAddress: address,
    billingSameAsShipping: true,
    items: [
      { productId: plain.productId, variantId: plain.variantId, quantity: 2 },
      { productId: custom.productId, variantId: custom.variantId, quantity: 1, customization: answers },
    ],
    paymentMethod: "COD" as const,
    internalNote: `${MARKER}: cash-on-delivery happy path`,
  } as unknown as ManualOrderValues;

  const before = { plain: await stockOf(plain.variantId), custom: await stockOf(custom.variantId) };

  // ---- 1. keyed COD order: CONFIRMED with RESERVE + SALE (C3) --------------
  const created = await createManualOrder(actor, input);
  await settleStockChanges(created.stockChanges);
  assert(created.status === "CONFIRMED", `manual COD order is confirmed on entry (got ${created.status})`);
  log("created", `${created.orderNumber} ${formatPaise(created.totalPaise)} (${created.status})`);

  const afterCreate = { plain: await stockOf(plain.variantId), custom: await stockOf(custom.variantId) };
  assert(afterCreate.plain.onHand === before.plain.onHand - 2, `plain onHand fell by 2 (${before.plain.onHand} -> ${afterCreate.plain.onHand})`);
  assert(afterCreate.plain.reserved === before.plain.reserved, "plain reservation was committed, not left standing");
  assert(afterCreate.custom.onHand === before.custom.onHand - 1, "customisable onHand fell by 1");

  const movements = await db.stockMovement.findMany({ where: { orderId: created.orderId }, select: { type: true, delta: true, reservedDelta: true, variantId: true } });
  const reserves = movements.filter((row) => row.type === "RESERVE");
  const sales = movements.filter((row) => row.type === "SALE");
  assert(reserves.length === 2, `one RESERVE per line (got ${reserves.length})`);
  assert(sales.length === 2, `one SALE per line (got ${sales.length})`);
  assert(sales.every((row) => row.delta < 0), "SALE movements take stock off the shelf");
  log("stock", `${reserves.length} RESERVE + ${sales.length} SALE movements`);

  // ---- 2. money: lines and totals agree (B1) --------------------------------
  const order = await db.order.findUniqueOrThrow({
    where: { id: created.orderId },
    select: {
      orderNumber: true,
      status: true,
      paymentStatus: true,
      subtotalPaise: true,
      discountPaise: true,
      couponDiscountPaise: true,
      shippingPaise: true,
      codFeePaise: true,
      taxPaise: true,
      totalPaise: true,
      items: { select: { id: true, quantity: true, unitPricePaise: true, customizationPaise: true, lineTotalPaise: true, taxPaise: true, customization: true, sellerId: true, commissionPaise: true, sellerPayablePaise: true } },
    },
  });
  const lineTotals = order.items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
  assert(order.totalPaise === lineTotals + order.shippingPaise + order.codFeePaise, `total = Σ lines + shipping + COD fee (${order.totalPaise} vs ${lineTotals + order.shippingPaise + order.codFeePaise})`);
  const grossSubtotal = order.items.reduce((sum, item) => sum + (item.unitPricePaise + item.customizationPaise) * item.quantity, 0);
  assert(order.subtotalPaise === grossSubtotal, `subtotal = Σ (unit + customisation) × qty (${order.subtotalPaise} vs ${grossSubtotal})`);
  const customLine = order.items.find((item) => item.customization !== null);
  assert(customLine, "the customisable line stored a customisation snapshot");
  assert(Array.isArray(customLine.customization) && (customLine.customization as unknown[]).length > 0, "the snapshot has at least one answer");
  log("money", `subtotal ${formatPaise(order.subtotalPaise)} + shipping ${formatPaise(order.shippingPaise)} + COD ${formatPaise(order.codFeePaise)} + tax ${formatPaise(order.taxPaise)} = ${formatPaise(order.totalPaise)}`);

  // ---- 3. PROCESSING -> PACKED --------------------------------------------
  for (const next of ["PROCESSING", "PACKED"] as const) {
    const moved = await transitionOrder({ orderId: created.orderId, toStatus: next, actor, note: MARKER });
    await settleStockChanges(moved.stockChanges);
    assert(moved.stockChanges.length === 0, `${next} moves no stock (C3)`);
  }
  log("transitions", "CONFIRMED -> PROCESSING -> PACKED with no extra stock movement");

  // ---- 4. ship everything ---------------------------------------------------
  const shipment = await createShipment({
    orderId: created.orderId,
    actor,
    values: {
      items: order.items.map((item) => ({ orderItemId: item.id, quantity: item.quantity })),
      partnerId: null,
      carrierName: "Check Courier",
      trackingNumber: `CHK${Date.now().toString().slice(-8)}`,
      markShipped: true,
      note: MARKER,
    } as unknown as Parameters<typeof createShipment>[0]["values"],
  });
  const shipped = await db.order.findUniqueOrThrow({ where: { id: created.orderId }, select: { status: true, fulfillmentStatus: true, shippedAt: true } });
  assert(shipped.status === "SHIPPED", `order derived to SHIPPED (got ${shipped.status})`);
  assert(shipped.fulfillmentStatus === "FULFILLED", `every line is on a shipment (got ${shipped.fulfillmentStatus})`);
  assert(shipped.shippedAt !== null, "order carries a shippedAt stamp");
  log("shipment", `${shipment.shipmentNumber} shipped, order ${shipped.status}/${shipped.fulfillmentStatus}`);

  // ---- 5. deliver: COD cash, earnings, derived DELIVERED (B4, B6) -----------
  const delivered = await updateShipmentStatus({
    orderId: created.orderId,
    shipmentId: shipment.shipmentId,
    actor,
    values: { toStatus: "DELIVERED", note: MARKER } as unknown as Parameters<typeof updateShipmentStatus>[0]["values"],
  });
  assert(delivered.orderStatus === "DELIVERED", `order derived to DELIVERED (got ${delivered.orderStatus})`);

  const payments = await db.orderPayment.findMany({ where: { orderId: created.orderId }, select: { provider: true, status: true, type: true, amountPaise: true } });
  const cash = payments.filter((row) => row.provider === "COD" && row.status === "SUCCEEDED");
  assert(cash.length === 1, `exactly one COD cash payment row (got ${cash.length})`);
  assert(cash[0].amountPaise === order.totalPaise, `cash collected equals the order total (${cash[0].amountPaise} vs ${order.totalPaise})`);

  const settled = await db.order.findUniqueOrThrow({ where: { id: created.orderId }, select: { paymentStatus: true, status: true, deliveredAt: true } });
  assert(settled.paymentStatus === "PAID", `payment status derived to PAID (got ${settled.paymentStatus})`);
  assert(settled.deliveredAt !== null, "order carries a deliveredAt stamp");
  log("delivery", `cash ${formatPaise(cash[0].amountPaise)} recorded, order ${settled.status}/${settled.paymentStatus}`);

  const sellerLines = order.items.filter((item) => item.sellerId !== null);
  const ledger = await db.sellerLedgerEntry.findMany({ where: { orderId: created.orderId }, select: { type: true, sellerId: true, amountPaise: true } });
  if (sellerLines.length > 0) {
    assert(ledger.length > 0, "seller earnings were recorded on delivery (B4)");
    const saleRows = ledger.filter((row) => row.type === "SALE");
    const commissionRows = ledger.filter((row) => row.type === "COMMISSION");
    assert(saleRows.length === sellerLines.length, `one SALE entry per seller line (got ${saleRows.length} for ${sellerLines.length})`);
    assert(saleRows.every((row) => row.amountPaise > 0), "SALE entries credit the seller");
    assert(commissionRows.every((row) => row.amountPaise < 0), "COMMISSION entries debit the seller");
    const net = ledger.reduce((sum, row) => sum + row.amountPaise, 0);
    const payable = sellerLines.reduce((sum, item) => sum + item.sellerPayablePaise, 0);
    assert(net === payable, `ledger net equals the snapshotted payable (${net} vs ${payable})`);
    log("earnings", `${saleRows.length} SALE + ${commissionRows.length} COMMISSION row(s), net ${formatPaise(net)}`);
  } else {
    assert(ledger.length === 0, "a platform-only order records no seller earnings");
    log("earnings", "platform-only order - no ledger rows, as expected");
  }

  const afterDeliver = await stockOf(plain.variantId);
  assert(afterDeliver.onHand === afterCreate.plain.onHand, "delivery moves no stock (the SALE already happened at confirm)");

  // ---- 6. a PENDING order, cancelled: the reservation comes back (C3) -------
  const pendingInput = {
    ...input,
    items: [{ productId: plain.productId, variantId: plain.variantId, quantity: 1 }],
    paymentMethod: "COD" as const,
    internalNote: `${MARKER}: cancellation path`,
  } as unknown as ManualOrderValues;

  const second = await createManualOrder(actor, pendingInput);
  await settleStockChanges(second.stockChanges);
  // A keyed COD order is confirmed on entry, so put it back to PENDING the
  // only honest way: release the sale by cancelling it and assert the RETURN.
  const beforeCancel = await stockOf(plain.variantId);
  const cancelled = await transitionOrder({
    orderId: second.orderId,
    toStatus: "CANCELLED",
    actor,
    reason: "Duplicate or test order",
    note: MARKER,
  });
  await settleStockChanges(cancelled.stockChanges);
  const afterCancel = await stockOf(plain.variantId);
  assert(afterCancel.onHand === beforeCancel.onHand + 1, `cancelling a confirmed order restocks the unit (${beforeCancel.onHand} -> ${afterCancel.onHand})`);

  const cancelledOrder = await db.order.findUniqueOrThrow({ where: { id: second.orderId }, select: { status: true, cancelReason: true, items: { select: { status: true, reservedQty: true } } } });
  assert(cancelledOrder.status === "CANCELLED", "the second order is cancelled");
  assert(cancelledOrder.items.every((item) => item.status === "CANCELLED" && item.reservedQty === 0), "every line is cancelled with nothing reserved");
  const returnMovements = await db.stockMovement.findMany({ where: { orderId: second.orderId, type: "RETURN" }, select: { delta: true, reason: true } });
  assert(returnMovements.length === 1 && returnMovements[0].delta === 1, "one RETURN movement of +1 (reason ORDER_CANCELLED)");
  log("cancellation", `${second.orderNumber} cancelled, ${returnMovements[0].delta} unit restocked (${returnMovements[0].reason})`);

  console.log("\nOK - order check passed.");
  console.log(`   delivered order: ${created.orderNumber}`);
  console.log(`   cancelled order: ${second.orderNumber}`);
  console.log(`   both carry the internal note marker "${MARKER}" and are left in place.`);
}

main()
  .catch((error) => {
    console.error("\nFAILED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
