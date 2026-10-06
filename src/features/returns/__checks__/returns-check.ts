import "dotenv/config";

import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import {
  createManualOrder,
  createShipment,
  settleStockChanges,
  transitionOrder,
  updateShipmentStatus,
} from "@/features/orders/service";
import type { ManualOrderValues } from "@/features/orders/schemas";
import { transitionRefund } from "@/features/refunds/service";
import { createReturnRequest, transitionReturn } from "@/features/returns/service";

/**
 * End-to-end RETURN check against the REAL database (blueprint §14.C3, C4,
 * B4, B5, B6, E3):
 *
 *   npx tsx src/features/returns/__checks__/returns-check.ts
 *
 * Keys a cash-on-delivery order, ships and delivers it, then walks one RMA the
 * whole way — REQUESTED → UNDER_REVIEW → APPROVED → PICKUP_SCHEDULED →
 * RECEIVED → QC_PASSED → REFUND_INITIATED → (refund approved, processed,
 * completed) → REFUND_COMPLETED → CLOSED — asserting after each step that the
 * things which must move together actually did:
 *
 *   · stock comes back exactly once, at QC_PASSED (C3)
 *   · the seller is charged the pickup fee at RECEIVED for a seller-fault
 *     reason, as a CHARGE ledger row (B5)
 *   · the refund cap is enforced (B6) — an over-cap amount is refused
 *   · completing the refund appends REFUND_REVERSAL ledger rows (B4)
 *   · Order.returnStatus, Order.paymentStatus and Order.status are re-derived
 *
 * The order it creates is left in place (audit rows point at it) and carries
 * the marker below in its internal note. The `returns.pickup_fee_paise`
 * setting is temporarily raised to exercise B5 and restored in `finally`.
 */

const MARKER = "check_returns_check";
const PICKUP_FEE_PAISE = 4_900;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

function log(step: string, detail = ""): void {
  console.log(`  ${step}${detail ? ` - ${detail}` : ""}`);
}

async function stockOf(variantId: string): Promise<{ onHand: number; reserved: number }> {
  return db.inventoryItem.findUniqueOrThrow({ where: { variantId }, select: { onHand: true, reserved: true } });
}

/** A published, in-stock, non-customisable variant that belongs to a seller. */
async function findCandidate(): Promise<{ productId: string; variantId: string; sellerId: string | null } | null> {
  const products = await db.product.findMany({
    where: {
      status: "PUBLISHED",
      deletedAt: null,
      isCustomizable: false,
      minOrderQty: 1,
      sellerId: { not: null },
      seller: { status: "ACTIVE", deletedAt: null },
    },
    take: 60,
    select: {
      id: true,
      sellerId: true,
      variants: { where: { deletedAt: null, isActive: true }, select: { id: true, inventory: { select: { available: true } } } },
    },
  });
  for (const product of products) {
    const variant = product.variants.find((row) => (row.inventory?.available ?? 0) >= 2);
    if (variant) return { productId: product.id, variantId: variant.id, sellerId: product.sellerId };
  }
  return null;
}

async function readSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key }, select: { value: true } });
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  await db.setting.update({ where: { key }, data: { value } });
}

async function main(): Promise<void> {
  const actorRow = await db.user.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, email: true } });
  assert(actorRow, "an admin user exists to act as");
  const actor = { id: actorRow.id, email: actorRow.email };

  const candidate = await findCandidate();
  assert(candidate, "a published, in-stock variant belonging to an active seller exists");
  assert(candidate.sellerId, "the candidate has a seller (the B5 pickup charge needs one)");
  log("candidate", `product ${candidate.productId} · variant ${candidate.variantId}`);

  const originalFee = await readSetting("returns.pickup_fee_paise");

  try {
    await writeSetting("returns.pickup_fee_paise", String(PICKUP_FEE_PAISE));

    // ---- 1. an order that has actually been delivered ----------------------
    const input = {
      customer: { email: `check-returns-${Date.now()}@example.test`, name: "Returns Check", phone: "9876543210" },
      shippingAddress: {
        fullName: "Returns Check",
        phone: "9876543210",
        line1: "1 Check Street",
        city: "New Delhi",
        state: "Delhi",
        pinCode: "110001",
        country: "IN",
      },
      billingSameAsShipping: true,
      items: [{ productId: candidate.productId, variantId: candidate.variantId, quantity: 1 }],
      paymentMethod: "COD" as const,
      internalNote: `${MARKER}: return happy path`,
    } as unknown as ManualOrderValues;

    const created = await createManualOrder(actor, input);
    await settleStockChanges(created.stockChanges);
    log("order", `${created.orderNumber} ${formatPaise(created.totalPaise)} (${created.status})`);

    for (const toStatus of ["PROCESSING", "PACKED"] as const) {
      const moved = await transitionOrder({ orderId: created.orderId, toStatus, actor, note: MARKER });
      await settleStockChanges(moved.stockChanges);
    }

    const orderItem = await db.orderItem.findFirstOrThrow({ where: { orderId: created.orderId }, select: { id: true, quantity: true, lineTotalPaise: true } });
    const shipment = await createShipment({
      orderId: created.orderId,
      actor,
      values: {
        items: [{ orderItemId: orderItem.id, quantity: orderItem.quantity }],
        markShipped: true,
        partnerId: null,
        billingSameAsShipping: undefined,
      } as never,
    });
    await settleStockChanges(shipment.stockChanges);
    const delivered = await updateShipmentStatus({
      orderId: created.orderId,
      shipmentId: shipment.shipmentId,
      actor,
      values: { toStatus: "DELIVERED", note: MARKER } as never,
    });
    await settleStockChanges(delivered.stockChanges);

    const afterDelivery = await db.order.findUniqueOrThrow({
      where: { id: created.orderId },
      select: { status: true, paymentStatus: true, totalPaise: true, payments: { where: { status: "SUCCEEDED", type: "CHARGE" }, select: { amountPaise: true } } },
    });
    const paidPaise = afterDelivery.payments.reduce((sum, payment) => sum + payment.amountPaise, 0);
    assert(afterDelivery.status === "DELIVERED", `the order is delivered (got ${afterDelivery.status})`);
    assert(paidPaise > 0, "the COD cash charge was recorded on delivery (B6)");
    log("delivered", `${formatPaise(paidPaise)} collected · payment status ${afterDelivery.paymentStatus}`);

    const stockAfterDelivery = await stockOf(candidate.variantId);

    // ---- 2. REQUESTED ------------------------------------------------------
    const rma = await createReturnRequest({
      orderId: created.orderId,
      orderItemId: orderItem.id,
      quantity: orderItem.quantity,
      reason: "DAMAGED",
      reasonDetail: `${MARKER}: arrived with a cracked corner`,
      requestedResolution: "REFUND",
      actor,
      source: "ADMIN",
    });
    log("RMA", `${rma.rmaNumber} created (${rma.status})`);

    let order = await db.order.findUniqueOrThrow({ where: { id: created.orderId }, select: { status: true, returnStatus: true } });
    assert(order.returnStatus === "REQUESTED", `an open RMA sets returnStatus REQUESTED (got ${order.returnStatus})`);
    assert(order.status === "RETURN_REQUESTED", `an open RMA moves the order to RETURN_REQUESTED (got ${order.status})`);

    // ---- 3. review → approve → pickup → received ---------------------------
    const move = async (toStatus: Parameters<typeof transitionReturn>[0]["values"]["toStatus"], values: Record<string, unknown> = {}) => {
      const result = await transitionReturn({
        returnRequestId: rma.returnRequestId,
        actor,
        values: { toStatus, isInternal: true, ...values } as never,
      });
      await settleStockChanges(result.stockChanges);
      log("transition", `${result.fromStatus} → ${result.toStatus}`);
      return result;
    };

    await move("UNDER_REVIEW");
    await move("APPROVED", { resolution: "REFUND" });
    await move("PICKUP_SCHEDULED", { pickupTrackingNumber: "CHK-PICKUP-1" });
    await move("RECEIVED");

    const charge = await db.sellerLedgerEntry.findFirst({
      where: { sellerId: candidate.sellerId, type: "CHARGE", description: { contains: `[${rma.rmaNumber}]` } },
      select: { amountPaise: true, status: true },
    });
    assert(charge, "B5: a seller-fault return charges the seller the pickup fee at RECEIVED");
    assert(charge.amountPaise === -PICKUP_FEE_PAISE, `the charge is −${formatPaise(PICKUP_FEE_PAISE)} (got ${charge.amountPaise})`);
    assert(charge.status === "AVAILABLE", "the pickup charge is immediately available against the next payout");
    log("B5 pickup fee", `${formatPaise(-charge.amountPaise)} charged to the seller`);

    const stockBeforeQc = await stockOf(candidate.variantId);
    assert(stockBeforeQc.onHand === stockAfterDelivery.onHand, "nothing is restocked before QC passes (C3)");

    // ---- 4. QC_PASSED restocks and marks the units returned ----------------
    await move("QC_PASSED", { qcNote: `${MARKER}: inspected, resellable` });

    const stockAfterQc = await stockOf(candidate.variantId);
    assert(
      stockAfterQc.onHand === stockBeforeQc.onHand + orderItem.quantity,
      `QC_PASSED restocks ${orderItem.quantity} unit(s) (${stockBeforeQc.onHand} -> ${stockAfterQc.onHand})`,
    );
    const movement = await db.stockMovement.findFirst({
      where: { orderId: created.orderId, type: "RETURN", reason: "RETURN_QC_PASSED" },
      select: { delta: true },
    });
    assert(movement?.delta === orderItem.quantity, "the RETURN movement carries the returned quantity (C3)");

    const itemAfterQc = await db.orderItem.findUniqueOrThrow({ where: { id: orderItem.id }, select: { returnedQty: true, status: true } });
    assert(itemAfterQc.returnedQty === orderItem.quantity, "returnedQty increments at QC_PASSED (C4)");
    assert(itemAfterQc.status === "RETURNED", `a fully returned line is RETURNED (got ${itemAfterQc.status})`);

    // ---- 5. the cap is enforced before a refund exists (B6) ----------------
    let refused = false;
    try {
      await transitionReturn({
        returnRequestId: rma.returnRequestId,
        actor,
        values: { toStatus: "REFUND_INITIATED", isInternal: true, amountPaise: paidPaise * 5 } as never,
      });
    } catch {
      refused = true;
    }
    assert(refused, "an amount above the cap is refused (B6)");
    log("cap", `an over-cap refund of ${formatPaise(paidPaise * 5)} was refused`);

    // ---- 6. REFUND_INITIATED creates the refund at the cap ------------------
    const initiated = await move("REFUND_INITIATED", { refundMethod: "BANK_TRANSFER" });
    assert(initiated.refund, "REFUND_INITIATED creates a refund");
    const refundId = initiated.refund.id;
    log("refund", `${initiated.refund.refundNumber} ${formatPaise(initiated.refund.amountPaise)} PENDING`);

    const pending = await db.refund.findUniqueOrThrow({ where: { id: refundId }, select: { status: true, method: true, amountPaise: true } });
    assert(pending.status === "PENDING", "the refund starts PENDING");
    assert(pending.method === "BANK_TRANSFER", "a COD order refunds by bank transfer, never to a card (§11.12)");
    assert(pending.amountPaise <= paidPaise, "the refund never exceeds what was collected");

    // ---- 7. approve → process → complete -----------------------------------
    // The settlement reference lands on the REFUND echo OrderPayment row, and
    // (provider, providerPaymentId) is globally unique - so a fixed literal
    // here would make the SECOND run of this check crash on the row the first
    // run left behind. Stamp it per run.
    const utr = `CHK-UTR-${Date.now()}`;
    for (const step of [
      { toStatus: "APPROVED" as const, values: {} },
      { toStatus: "PROCESSING" as const, values: { reference: utr } },
      { toStatus: "COMPLETED" as const, values: { reference: utr } },
    ]) {
      const result = await transitionRefund({ refundId, actor, values: { toStatus: step.toStatus, ...step.values } as never });
      log("refund", `${result.fromStatus} → ${result.toStatus}`);
    }

    const reversals = await db.sellerLedgerEntry.findMany({
      where: { orderId: created.orderId, type: "REFUND_REVERSAL" },
      select: { amountPaise: true, status: true },
    });
    assert(reversals.length >= 2, `B4: completing the refund appends sale and commission reversals (got ${reversals.length})`);
    assert(reversals.some((row) => row.amountPaise < 0), "one reversal takes the sale back off the seller");
    assert(reversals.some((row) => row.amountPaise > 0), "one reversal hands the commission back to the seller");
    log("B4 reversal", `${reversals.length} REFUND_REVERSAL entries`);

    const echo = await db.orderPayment.findFirst({ where: { refundId, type: "REFUND" }, select: { status: true, amountPaise: true } });
    assert(echo, "a REFUND echo row is written so /admin/payments shows both legs (B6)");
    assert(echo.amountPaise === pending.amountPaise, "the echo row carries the refunded amount");

    // ---- 8. the RMA and the order follow the refund -------------------------
    const rmaAfter = await db.returnRequest.findUniqueOrThrow({ where: { id: rma.returnRequestId }, select: { status: true } });
    assert(rmaAfter.status === "REFUND_COMPLETED", `the RMA follows its refund (got ${rmaAfter.status})`);

    order = await db.order.findUniqueOrThrow({ where: { id: created.orderId }, select: { status: true, returnStatus: true } });
    const money = await db.order.findUniqueOrThrow({
      where: { id: created.orderId },
      select: { paymentStatus: true, refundedPaise: true, returnedPaise: true },
    });
    assert(money.refundedPaise === pending.amountPaise, `Order.refundedPaise is the completed refund (${money.refundedPaise} vs ${pending.amountPaise})`);
    assert(order.returnStatus === "FULL", `every line returned means returnStatus FULL (got ${order.returnStatus})`);
    if (money.refundedPaise >= paidPaise) {
      assert(money.paymentStatus === "REFUNDED", `fully refunded means paymentStatus REFUNDED (got ${money.paymentStatus})`);
      assert(order.status === "REFUNDED", `fully refunded means the order is REFUNDED (got ${order.status})`);
    } else {
      assert(money.paymentStatus === "PARTIALLY_REFUNDED", `partly refunded means PARTIALLY_REFUNDED (got ${money.paymentStatus})`);
      assert(order.status === "RETURNED", `goods back but money not all returned means RETURNED (got ${order.status})`);
    }
    log("derived", `order ${order.status} · payment ${money.paymentStatus} · return ${order.returnStatus} · refunded ${formatPaise(money.refundedPaise)}`);

    // ---- 9. close ----------------------------------------------------------
    await move("CLOSED");
    const closed = await db.returnRequest.findUniqueOrThrow({ where: { id: rma.returnRequestId }, select: { status: true, resolvedAt: true } });
    assert(closed.status === "CLOSED" && closed.resolvedAt, "closing stamps resolvedAt");

    const audits = await db.auditLog.count({ where: { entityType: "ReturnRequest", entityId: rma.returnRequestId } });
    assert(audits >= 7, `every transition is audited (D13) — ${audits} rows`);

    console.log("\nOK - returns check passed.");
    console.log(`   order:  ${created.orderNumber}`);
    console.log(`   RMA:    ${rma.rmaNumber}`);
    console.log(`   refund: ${initiated.refund.refundNumber}`);
    console.log(`   all three are left in place and carry the marker "${MARKER}".`);
  } finally {
    if (originalFee !== null) await writeSetting("returns.pickup_fee_paise", originalFee);
  }
}

main()
  .catch((error) => {
    console.error("\nFAILED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
