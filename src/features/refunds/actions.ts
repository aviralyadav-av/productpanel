"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { clientIp } from "@/lib/client-ip";
import { REFUND_STATUS_META, type RefundStatus } from "@/lib/enums";
import { formatPaise } from "@/lib/money";

import {
  createRefundSchema,
  refundNoteSchema,
  refundTransitionSchema,
  type CreateRefundInput,
  type RefundNoteInput,
  type RefundTransitionInput,
} from "./schemas";
import { addRefundNote, createRefund, transitionRefund } from "./service";

/**
 * Permission split (D14): `refunds.view` reads, `refunds.process` is the right
 * to move money — creating, approving, processing, completing, failing and
 * cancelling all require it, because each of them changes what the customer
 * is owed or what the seller is paid.
 */

const LIST_PATH = "/admin/refunds";

async function requestIp(): Promise<string> {
  return clientIp(await headers());
}

function revalidateRefund(refundId?: string, orderId?: string): void {
  revalidatePath(LIST_PATH);
  if (refundId) revalidatePath(`${LIST_PATH}/${refundId}`);
  revalidatePath("/admin/returns");
  revalidatePath("/admin/payments");
  if (orderId) revalidatePath(`/admin/orders/${orderId}`);
}

export async function createRefundAction(
  input: CreateRefundInput,
): Promise<ActionResult<{ refundId: string; refundNumber: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("refunds.process");
    const parsed = createRefundSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const refund = await createRefund({ values: parsed.data, actor, ip: await requestIp() });
    revalidateRefund(refund.id, refund.orderId);
    return ok(
      { refundId: refund.id, refundNumber: refund.refundNumber },
      `Refund ${refund.refundNumber} for ${formatPaise(refund.amountPaise)} created and is awaiting approval.`,
    );
  });
}

export async function transitionRefundAction(
  refundId: string,
  input: RefundTransitionInput,
): Promise<ActionResult<{ refundId: string; status: string; gatewayPending: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("refunds.process");
    const parsed = refundTransitionSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await transitionRefund({ refundId, actor, values: parsed.data, ip: await requestIp() });
    revalidateRefund(result.refundId, result.orderId);

    const label = REFUND_STATUS_META[result.toStatus as RefundStatus].label.toLowerCase();
    return ok(
      { refundId: result.refundId, status: result.toStatus, gatewayPending: result.gatewayPending },
      result.gatewayPending
        ? `${result.refundNumber} has been sent to the gateway and is still settling.`
        : `${result.refundNumber} is now ${label}.`,
    );
  });
}

export async function addRefundNoteAction(refundId: string, input: RefundNoteInput): Promise<ActionResult<{ refundId: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("refunds.process");
    const parsed = refundNoteSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await addRefundNote({ refundId, message: parsed.data.message, actor, ip: await requestIp() });
    revalidateRefund(refundId);
    return ok(result, "Note added.");
  });
}
