"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { couponBulkSchema, couponFormSchema, couponIdSchema, type CouponBulkInput, type CouponFormInput } from "./schemas";
import {
  bulkCoupons,
  createCoupon,
  deleteCoupon,
  duplicateCoupon,
  setCouponActive,
  updateCoupon,
  type BulkCouponResult,
  type DeleteCouponResult,
} from "./service";

/**
 * Thin Server Action wrappers: permission -> zod -> service (its own tx +
 * audit) -> public cache -> revalidate -> ActionResult. Business rules live in
 * service.ts so the REST routes cannot drift from the screens.
 */

const COUPONS_PATH = "/admin/coupons";

async function afterChange(id?: string): Promise<void> {
  await invalidatePublic(listTagsFor("coupon"));
  revalidatePath(COUPONS_PATH);
  if (id) revalidatePath(`${COUPONS_PATH}/${id}`);
}

export async function createCouponAction(input: CouponFormInput): Promise<ActionResult<{ id: string; code: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("coupons.manage");
    const parsed = couponFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await createCoupon(parsed.data, actor);
    await afterChange();
    return ok({ id: row.id, code: row.code }, `Coupon ${row.code} created.`);
  });
}

export async function updateCouponAction(id: string, input: CouponFormInput): Promise<ActionResult<{ id: string; code: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("coupons.manage");
    const parsedId = couponIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid coupon id.");
    const parsed = couponFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await updateCoupon(parsedId.data, parsed.data, actor);
    await afterChange(row.id);
    return ok({ id: row.id, code: row.code }, `Coupon ${row.code} saved.`);
  });
}

export async function duplicateCouponAction(id: string): Promise<ActionResult<{ id: string; code: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("coupons.manage");
    const parsedId = couponIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid coupon id.");
    const row = await duplicateCoupon(parsedId.data, actor);
    await afterChange();
    return ok({ id: row.id, code: row.code }, `Duplicated as ${row.code} (disabled until you enable it).`);
  });
}

export async function toggleCouponAction(id: string, isActive: boolean): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("coupons.manage");
    const parsedId = couponIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid coupon id.");
    const row = await setCouponActive(parsedId.data, Boolean(isActive), actor);
    await afterChange(row.id);
    return ok({ id: row.id, isActive: row.isActive }, `Coupon ${row.code} ${row.isActive ? "enabled" : "disabled"}.`);
  });
}

export async function deleteCouponAction(id: string, reason?: string): Promise<ActionResult<DeleteCouponResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("coupons.manage");
    const parsedId = couponIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid coupon id.");
    const result = await deleteCoupon(parsedId.data, actor, reason?.trim() || undefined);
    await afterChange(result.id);
    return ok(
      result,
      result.mode === "hard"
        ? `Coupon ${result.code} deleted.`
        : `Coupon ${result.code} archived - its redemption history is kept.`,
    );
  });
}

export async function bulkCouponsAction(input: CouponBulkInput): Promise<ActionResult<BulkCouponResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("coupons.manage");
    const parsed = couponBulkSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await bulkCoupons(parsed.data, actor);
    await afterChange();
    const verb = result.op === "DELETE" ? "deleted" : result.op === "ENABLE" ? "enabled" : "disabled";
    return ok(result, `${result.affected} coupon${result.affected === 1 ? "" : "s"} ${verb}${result.skipped ? `, ${result.skipped} unchanged` : ""}.`);
  });
}
