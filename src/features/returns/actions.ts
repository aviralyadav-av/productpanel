"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { clientIp } from "@/lib/client-ip";
import { RETURN_REQUEST_STATUS_META, type ReturnRequestStatus } from "@/lib/enums";
import { settleStockChanges } from "@/features/orders/shared";

import {
  bulkReturnsSchema,
  returnNoteSchema,
  returnTransitionSchema,
  type BulkReturnsInput,
  type ReturnNoteInput,
  type ReturnTransitionInput,
} from "./schemas";
import { addReturnNote, bulkReturns, transitionReturn } from "./service";

/**
 * Thin Server Action wrappers: permission → zod → service (its own
 * transaction and audit row) → post-commit stock side effects → revalidate.
 * The REST routes call the same service functions, so the screen and the API
 * can never diverge.
 */

const LIST_PATH = "/admin/returns";

async function requestIp(): Promise<string> {
  return clientIp(await headers());
}

function revalidateReturn(returnRequestId?: string, orderId?: string): void {
  revalidatePath(LIST_PATH);
  if (returnRequestId) revalidatePath(`${LIST_PATH}/${returnRequestId}`);
  revalidatePath("/admin/refunds");
  if (orderId) revalidatePath(`/admin/orders/${orderId}`);
}

export async function transitionReturnAction(
  returnRequestId: string,
  input: ReturnTransitionInput,
): Promise<ActionResult<{ returnRequestId: string; status: string; refundId: string | null }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("returns.manage");
    const parsed = returnTransitionSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await transitionReturn({
      returnRequestId,
      actor,
      values: parsed.data,
      ip: await requestIp(),
    });
    await settleStockChanges(result.stockChanges);
    revalidateReturn(result.returnRequestId, result.orderId);

    return ok(
      { returnRequestId: result.returnRequestId, status: result.toStatus, refundId: result.refund?.id ?? null },
      `${result.rmaNumber} is now ${RETURN_REQUEST_STATUS_META[result.toStatus as ReturnRequestStatus].label.toLowerCase()}.${
        result.refund ? ` Refund ${result.refund.refundNumber} created.` : ""
      }`,
    );
  });
}

export async function addReturnNoteAction(
  returnRequestId: string,
  input: ReturnNoteInput,
): Promise<ActionResult<{ eventId: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("returns.manage");
    const parsed = returnNoteSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await addReturnNote({ returnRequestId, values: parsed.data, actor, ip: await requestIp() });
    revalidateReturn(returnRequestId);
    return ok({ eventId: result.eventId }, result.isInternal ? "Internal note added." : "Note added to the customer's timeline.");
  });
}

export async function bulkReturnsAction(
  input: BulkReturnsInput,
): Promise<ActionResult<{ affected: number; skipped: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("returns.manage");
    const parsed = bulkReturnsSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await bulkReturns({ values: parsed.data, actor, ip: await requestIp() });
    await settleStockChanges(result.stockChanges);
    revalidateReturn();

    return ok(
      { affected: result.affected, skipped: result.skipped.length },
      result.skipped.length === 0
        ? `${result.affected} return(s) updated.`
        : `${result.affected} updated, ${result.skipped.length} skipped (${result.skipped[0]?.reason ?? ""}).`,
    );
  });
}
