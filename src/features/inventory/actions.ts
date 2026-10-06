"use server";

import { revalidatePath } from "next/cache";

import { ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import {
  adjustStockForActor,
  bulkAdjustStockForActor,
  bulkSetThresholdForActor,
  setThresholdForActor,
  type AdjustOutcome,
  type BulkAdjustOutcome,
  type ThresholdOutcome,
} from "./mutations";
import {
  adjustStockSchema,
  bulkAdjustStockSchema,
  bulkSetThresholdSchema,
  setThresholdSchema,
  type AdjustStockInput,
  type BulkAdjustStockInput,
  type BulkSetThresholdInput,
  type SetThresholdInput,
} from "./schemas";

/**
 * Server Actions behind the inventory dialogs. Each is the same four lines:
 * permission → zod → shared mutation (service in a tx + audit + side effects)
 * → revalidate. The REST routes call the same mutations, so the UI and the
 * API cannot disagree about what an adjustment does.
 *
 * THE LEDGER IS THE SOURCE OF TRUTH: nothing here touches InventoryItem
 * directly. Every unit that moves goes through applyStockMovement and leaves
 * a StockMovement row behind (F7).
 */

const INVENTORY_PATH = "/admin/inventory";

function revalidate(productIds: Iterable<string>): void {
  revalidatePath(INVENTORY_PATH);
  // The dashboard alerts and the sidebar low-stock badge read stockState.
  revalidatePath("/admin/dashboard");
  for (const productId of new Set(productIds)) revalidatePath(`/admin/products/${productId}`);
}

export async function adjustStock(input: AdjustStockInput): Promise<ActionResult<AdjustOutcome>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("inventory.adjust");
    const parsed = adjustStockSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const outcome = await adjustStockForActor(actor, parsed.data);
    revalidate([outcome.productId]);
    return ok(outcome, outcome.message);
  });
}

export async function bulkAdjustStock(
  input: BulkAdjustStockInput,
): Promise<ActionResult<BulkAdjustOutcome>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("inventory.adjust");
    const parsed = bulkAdjustStockSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const outcome = await bulkAdjustStockForActor(actor, parsed.data);
    revalidate([]);
    return ok(outcome, outcome.message);
  });
}

export async function setThreshold(input: SetThresholdInput): Promise<ActionResult<ThresholdOutcome>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("inventory.adjust");
    const parsed = setThresholdSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const outcome = await setThresholdForActor(actor, parsed.data);
    revalidate([]);
    return ok(outcome, outcome.message);
  });
}

export async function bulkSetThreshold(
  input: BulkSetThresholdInput,
): Promise<ActionResult<{ updated: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("inventory.adjust");
    const parsed = bulkSetThresholdSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const outcome = await bulkSetThresholdForActor(actor, parsed.data);
    revalidate([]);
    return ok({ updated: outcome.updated }, outcome.message);
  });
}
