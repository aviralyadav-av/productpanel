"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { clientIp } from "@/lib/client-ip";
import { formatPaise } from "@/lib/money";
import { ORDER_STATUS_META, type OrderStatus } from "@/lib/enums";

import {
  addNoteSchema,
  bulkOrdersSchema,
  cancelOrderItemSchema,
  createShipmentSchema,
  manualOrderSchema,
  orderIdSchema,
  previewDraftSchema,
  recordManualPaymentSchema,
  transitionOrderSchema,
  updateAddressSchema,
  updateShipmentStatusSchema,
  type AddNoteInput,
  type BulkOrdersInput,
  type CancelOrderItemInput,
  type CreateShipmentInput,
  type ManualOrderInput,
  type PreviewDraftInput,
  type RecordManualPaymentInput,
  type TransitionOrderInput,
  type UpdateAddressInput,
  type UpdateShipmentStatusInput,
} from "./schemas";
import {
  addOrderNote,
  bulkTransitionOrders,
  cancelOrderItem,
  createManualOrder,
  createShipment,
  previewManualOrderDraft,
  recordManualPayment,
  resendOrderConfirmation,
  rtoReceived,
  settleStockChanges,
  transitionOrder,
  updateOrderAddress,
  updateShipmentStatus,
} from "./service";
import type { OrderDraft } from "./draft";
import type { ManualProductInfo } from "./manual-types";
import { getManualOrderProduct } from "./queries";

/**
 * Thin Server Action wrappers: permission -> zod -> service (its own
 * transaction, its own audit row) -> post-commit stock side effects ->
 * revalidate -> ActionResult.
 *
 * No business rule lives here. Everything an action can do, the matching REST
 * route can do too, because both call the same service function - which is
 * what stops the screens and the API drifting apart.
 */

const LIST_PATH = "/admin/orders";

async function requestIp(): Promise<string> {
  return clientIp(await headers());
}

function revalidateOrder(orderId?: string): void {
  revalidatePath(LIST_PATH);
  if (orderId) {
    revalidatePath(`${LIST_PATH}/${orderId}`);
    revalidatePath(`${LIST_PATH}/${orderId}/invoice`);
  }
}

// ---------------------------------------------------------------------------
// Manual order entry
// ---------------------------------------------------------------------------

export async function previewOrderDraftAction(input: PreviewDraftInput): Promise<ActionResult<OrderDraft>> {
  return runAction(async () => {
    await requirePermissionOrThrow("orders.create");
    const parsed = previewDraftSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const values = parsed.data;
    if (values.items.length === 0) return ok(null as unknown as OrderDraft, "Add an item to price the order.");

    const draft = await previewManualOrderDraft({
      items: values.items,
      paymentMethod: values.paymentMethod,
      couponCode: values.couponCode,
      shippingRateId: values.shippingRateId,
      destination: values.pinCode && values.pinCode.length === 6 ? { pinCode: values.pinCode, state: values.state ?? null } : null,
      customer: { email: values.customerEmail ?? null, customerId: values.customerId ?? null },
    });
    return ok(draft);
  });
}

export async function createManualOrderAction(
  input: ManualOrderInput,
): Promise<ActionResult<{ orderId: string; orderNumber: string; status: string; totalPaise: number; paymentError: string | null }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("orders.create");
    const parsed = manualOrderSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await createManualOrder(actor, parsed.data, { ip: await requestIp() });
    revalidateOrder(result.orderId);
    return ok(
      {
        orderId: result.orderId,
        orderNumber: result.orderNumber,
        status: result.status,
        totalPaise: result.totalPaise,
        paymentError: result.paymentError,
      },
      `Order ${result.orderNumber} created for ${formatPaise(result.totalPaise)}.`,
    );
  });
}

// ---------------------------------------------------------------------------
// Status, notes, address
// ---------------------------------------------------------------------------

export async function transitionOrderAction(
  orderId: string,
  input: TransitionOrderInput,
): Promise<ActionResult<{ orderId: string; status: string; refundNumber: string | null }>> {
  return runAction(async () => {
    const parsedId = orderIdSchema.safeParse(orderId);
    if (!parsedId.success) return fail("Invalid order id.");
    const parsed = transitionOrderSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    // Cancelling is a separate, scarcer permission than moving an order along.
    const cancelling = parsed.data.toStatus === "CANCELLED" || parsed.data.toStatus === "FAILED";
    const actor = await requirePermissionOrThrow(cancelling ? "orders.cancel" : "orders.update");

    const result = await transitionOrder({
      orderId: parsedId.data,
      toStatus: parsed.data.toStatus,
      actor,
      reason: parsed.data.reason,
      note: parsed.data.note,
      ip: await requestIp(),
    });
    await settleStockChanges(result.stockChanges);
    revalidateOrder(result.orderId);

    const label = ORDER_STATUS_META[result.toStatus as OrderStatus]?.label ?? result.toStatus;
    return ok(
      { orderId: result.orderId, status: result.toStatus, refundNumber: result.refund?.refundNumber ?? null },
      result.refund
        ? `${result.orderNumber} is now ${label.toLowerCase()}. Refund ${result.refund.refundNumber} for ${formatPaise(result.refund.amountPaise)} is awaiting approval.`
        : `${result.orderNumber} is now ${label.toLowerCase()}.`,
    );
  });
}

export async function bulkOrdersAction(
  input: BulkOrdersInput,
): Promise<ActionResult<{ op: string; requested: number; affected: number; skipped: Array<{ id: string; orderNumber: string | null; reason: string }> }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("orders.update");
    const parsed = bulkOrdersSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await bulkTransitionOrders(parsed.data, actor, { ip: await requestIp() });
    await settleStockChanges(result.stockChanges);
    revalidateOrder();
    return ok(
      { op: result.op, requested: result.requested, affected: result.affected, skipped: result.skipped },
      result.skipped.length
        ? `${result.affected} of ${result.requested} orders updated; ${result.skipped.length} skipped.`
        : `${result.affected} order${result.affected === 1 ? "" : "s"} updated.`,
    );
  });
}

export async function addOrderNoteAction(orderId: string, input: AddNoteInput): Promise<ActionResult<{ eventId: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("orders.notes");
    const parsedId = orderIdSchema.safeParse(orderId);
    if (!parsedId.success) return fail("Invalid order id.");
    const parsed = addNoteSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await addOrderNote({
      orderId: parsedId.data,
      message: parsed.data.message,
      isInternal: parsed.data.isInternal,
      actor,
      ip: await requestIp(),
    });
    revalidateOrder(parsedId.data);
    return ok({ eventId: result.eventId }, parsed.data.isInternal ? "Internal note added." : "Note added to the order.");
  });
}

export async function updateOrderAddressAction(orderId: string, input: UpdateAddressInput): Promise<ActionResult<{ type: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("orders.update");
    const parsedId = orderIdSchema.safeParse(orderId);
    if (!parsedId.success) return fail("Invalid order id.");
    const parsed = updateAddressSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const { type, ...values } = parsed.data;
    const result = await updateOrderAddress({ orderId: parsedId.data, type, values, actor, ip: await requestIp() });
    revalidateOrder(parsedId.data);
    return ok({ type: result.type }, `${type === "SHIPPING" ? "Shipping" : "Billing"} address updated.`);
  });
}

export async function resendOrderConfirmationAction(orderId: string): Promise<ActionResult<{ email: string; queued: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("orders.update");
    const parsedId = orderIdSchema.safeParse(orderId);
    if (!parsedId.success) return fail("Invalid order id.");

    const result = await resendOrderConfirmation({ orderId: parsedId.data, actor, ip: await requestIp() });
    revalidateOrder(parsedId.data);
    return ok(
      { email: result.email, queued: result.queued },
      result.queued ? `Confirmation re-sent to ${result.email}. The old tracking link no longer works.` : `Not sent: ${result.reason}.`,
    );
  });
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export async function recordManualPaymentAction(
  orderId: string,
  input: RecordManualPaymentInput,
): Promise<ActionResult<{ paymentId: string; paymentStatus: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("payments.manage");
    const parsedId = orderIdSchema.safeParse(orderId);
    if (!parsedId.success) return fail("Invalid order id.");
    const parsed = recordManualPaymentSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const ip = await requestIp();
    const result = await recordManualPayment({ orderId: parsedId.data, actor, values: parsed.data, ip });

    // A payment that settles a PENDING order confirms it (same rule the
    // gateway job applies), so the operator does not have to click twice.
    if (result.shouldConfirm) {
      const moved = await transitionOrder({
        orderId: parsedId.data,
        toStatus: "CONFIRMED",
        actor,
        note: `Payment of ${formatPaise(parsed.data.amountPaise as number)} recorded`,
        ip,
      });
      await settleStockChanges(moved.stockChanges);
    }

    revalidateOrder(parsedId.data);
    return ok({ paymentId: result.paymentId, paymentStatus: result.paymentStatus }, "Payment recorded.");
  });
}

export async function cancelOrderItemAction(
  orderId: string,
  orderItemId: string,
  input: CancelOrderItemInput,
): Promise<ActionResult<{ orderCancelled: boolean; refundNumber: string | null }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("orders.cancel");
    const parsedId = orderIdSchema.safeParse(orderId);
    const parsedItemId = orderIdSchema.safeParse(orderItemId);
    if (!parsedId.success || !parsedItemId.success) return fail("Invalid order id.");
    const parsed = cancelOrderItemSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await cancelOrderItem({
      orderId: parsedId.data,
      orderItemId: parsedItemId.data,
      quantity: parsed.data.quantity,
      reason: parsed.data.reason,
      actor,
      ip: await requestIp(),
    });
    await settleStockChanges(result.stockChanges);
    revalidateOrder(parsedId.data);
    return ok(
      { orderCancelled: result.orderCancelled, refundNumber: result.refund?.refundNumber ?? null },
      result.orderCancelled ? "Last line cancelled - the order is now cancelled." : `Cancelled ${result.cancelledQuantity} unit(s).`,
    );
  });
}

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

export async function createShipmentAction(
  orderId: string,
  input: CreateShipmentInput,
): Promise<ActionResult<{ shipmentId: string; shipmentNumber: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("orders.ship");
    const parsedId = orderIdSchema.safeParse(orderId);
    if (!parsedId.success) return fail("Invalid order id.");
    const parsed = createShipmentSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await createShipment({ orderId: parsedId.data, actor, values: parsed.data });
    revalidateOrder(parsedId.data);
    return ok({ shipmentId: result.shipmentId, shipmentNumber: result.shipmentNumber }, `Shipment ${result.shipmentNumber} created.`);
  });
}

export async function updateShipmentStatusAction(
  orderId: string,
  shipmentId: string,
  input: UpdateShipmentStatusInput,
): Promise<ActionResult<{ shipmentId: string; status: string; orderStatus: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("orders.ship");
    const parsedId = orderIdSchema.safeParse(orderId);
    const parsedShipmentId = orderIdSchema.safeParse(shipmentId);
    if (!parsedId.success || !parsedShipmentId.success) return fail("Invalid id.");
    const parsed = updateShipmentStatusSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await updateShipmentStatus({
      orderId: parsedId.data,
      shipmentId: parsedShipmentId.data,
      actor,
      values: parsed.data,
    });
    revalidateOrder(parsedId.data);
    return ok(
      { shipmentId: result.shipmentId, status: result.status, orderStatus: result.orderStatus },
      `${result.shipmentNumber} updated.`,
    );
  });
}

export async function rtoReceivedAction(
  orderId: string,
  shipmentId: string,
  note?: string,
): Promise<ActionResult<{ orderStatus: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(["orders.ship", "orders.cancel"]);
    const parsedId = orderIdSchema.safeParse(orderId);
    const parsedShipmentId = orderIdSchema.safeParse(shipmentId);
    if (!parsedId.success || !parsedShipmentId.success) return fail("Invalid id.");

    const result = await rtoReceived({ orderId: parsedId.data, shipmentId: parsedShipmentId.data, actor, note: note ?? null });
    await settleStockChanges(result.stockChanges);
    revalidateOrder(parsedId.data);
    return ok({ orderStatus: result.orderStatus }, "Parcel received back; stock restocked.");
  });
}

/**
 * Load a picked product's variants and customisation options for the manual
 * order form. Read-only, but a Server Action rather than a REST call so the
 * form does not have to hand-roll fetch error handling for something it needs
 * on every product pick.
 */
export async function loadOrderProductAction(productId: string): Promise<ActionResult<ManualProductInfo>> {
  return runAction(async () => {
    await requirePermissionOrThrow("orders.create");
    const parsed = orderIdSchema.safeParse(productId);
    if (!parsed.success) return fail("Invalid product id.");
    const product = await getManualOrderProduct(parsed.data);
    if (!product) return fail("That product no longer exists.");
    return ok(product);
  });
}
