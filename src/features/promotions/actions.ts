"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { promotionFormSchema, promotionIdSchema, type PromotionFormInput } from "./schemas";
import { createPromotion, deletePromotion, setPromotionActive, updatePromotion, type DeletePromotionResult } from "./service";

/**
 * Server Actions for /admin/promotions. The service re-prices products inside
 * its transaction; here we only invalidate the public cache (catalog +
 * content, per listTagsFor('promotion')) and refresh the admin screens.
 */

const PATH = "/admin/promotions";

async function afterChange(id?: string): Promise<void> {
  await invalidatePublic(listTagsFor("promotion"));
  revalidatePath(PATH);
  revalidatePath("/admin/products");
  if (id) revalidatePath(`${PATH}/${id}`);
}

type Saved = { id: string; name: string; repriced: number };

function repricedNote(count: number): string {
  return `${count} product${count === 1 ? "" : "s"} re-priced.`;
}

export async function createPromotionAction(input: PromotionFormInput): Promise<ActionResult<Saved>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("promotions.manage");
    const parsed = promotionFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await createPromotion(parsed.data, actor);
    await afterChange();
    return ok({ id: result.promotion.id, name: result.promotion.name, repriced: result.repriced }, `Promotion created. ${repricedNote(result.repriced)}`);
  });
}

export async function updatePromotionAction(id: string, input: PromotionFormInput): Promise<ActionResult<Saved>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("promotions.manage");
    const parsedId = promotionIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid promotion id.");
    const parsed = promotionFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await updatePromotion(parsedId.data, parsed.data, actor);
    await afterChange(result.promotion.id);
    return ok({ id: result.promotion.id, name: result.promotion.name, repriced: result.repriced }, `Promotion saved. ${repricedNote(result.repriced)}`);
  });
}

export async function togglePromotionAction(id: string, isActive: boolean): Promise<ActionResult<Saved & { isActive: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("promotions.manage");
    const parsedId = promotionIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid promotion id.");
    const result = await setPromotionActive(parsedId.data, Boolean(isActive), actor);
    await afterChange(result.promotion.id);
    return ok(
      { id: result.promotion.id, name: result.promotion.name, repriced: result.repriced, isActive: result.promotion.isActive },
      `Promotion ${result.promotion.isActive ? "enabled" : "disabled"}. ${repricedNote(result.repriced)}`,
    );
  });
}

export async function deletePromotionAction(id: string, reason?: string): Promise<ActionResult<DeletePromotionResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("promotions.manage");
    const parsedId = promotionIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid promotion id.");
    const result = await deletePromotion(parsedId.data, actor, reason?.trim() || undefined);
    await afterChange(result.id);
    return ok(result, `Promotion "${result.name}" deleted. ${repricedNote(result.repriced)}`);
  });
}
