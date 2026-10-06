"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { scheduleContentExpiry } from "@/lib/queue/handlers/platform";

import { bannerFormSchema, bannerIdSchema, bannerReorderSchema, type BannerFormInput, type BannerReorderInput } from "./schemas";
import { createBanner, deleteBanner, duplicateBanner, reorderBanners, resetBannerCounters, setBannerActive, updateBanner } from "./service";

/**
 * Server Actions for /admin/banners. After every commit: invalidate the
 * public 'content' cache (the homepage sections read banners) and re-arm the
 * `content.expire` chain so the storefront flips at the next start/end
 * boundary (§11.26, E1).
 */

const PATH = "/admin/banners";

async function afterChange(id?: string): Promise<void> {
  await invalidatePublic(listTagsFor("banner"));
  await scheduleContentExpiry();
  revalidatePath(PATH);
  if (id) revalidatePath(`${PATH}/${id}`);
}

type Saved = { id: string; title: string; placement: string };

export async function createBannerAction(input: BannerFormInput): Promise<ActionResult<Saved>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("banners.manage");
    const parsed = bannerFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await createBanner(parsed.data, actor);
    await afterChange();
    return ok({ id: row.id, title: row.title, placement: row.placement }, `Banner "${row.title}" created.`);
  });
}

export async function updateBannerAction(id: string, input: BannerFormInput): Promise<ActionResult<Saved>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("banners.manage");
    const parsedId = bannerIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid banner id.");
    const parsed = bannerFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await updateBanner(parsedId.data, parsed.data, actor);
    await afterChange(row.id);
    return ok({ id: row.id, title: row.title, placement: row.placement }, `Banner "${row.title}" saved.`);
  });
}

export async function toggleBannerAction(id: string, isActive: boolean): Promise<ActionResult<Saved & { isActive: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("banners.manage");
    const parsedId = bannerIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid banner id.");
    const row = await setBannerActive(parsedId.data, Boolean(isActive), actor);
    await afterChange(row.id);
    return ok({ id: row.id, title: row.title, placement: row.placement, isActive: row.isActive }, `Banner ${row.isActive ? "shown" : "hidden"}.`);
  });
}

export async function duplicateBannerAction(id: string): Promise<ActionResult<Saved>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("banners.manage");
    const parsedId = bannerIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid banner id.");
    const row = await duplicateBanner(parsedId.data, actor);
    await afterChange();
    return ok({ id: row.id, title: row.title, placement: row.placement }, "Duplicated (hidden until you show it).");
  });
}

export async function deleteBannerAction(id: string): Promise<ActionResult<Saved>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("banners.manage");
    const parsedId = bannerIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid banner id.");
    const result = await deleteBanner(parsedId.data, actor);
    await afterChange(result.id);
    return ok(result, `Banner "${result.title}" deleted.`);
  });
}

export async function resetBannerCountersAction(id: string): Promise<ActionResult<Saved>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("banners.manage");
    const parsedId = bannerIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid banner id.");
    const row = await resetBannerCounters(parsedId.data, actor);
    revalidatePath(PATH);
    revalidatePath(`${PATH}/${row.id}`);
    return ok({ id: row.id, title: row.title, placement: row.placement }, "Counters reset to zero.");
  });
}

export async function reorderBannersAction(input: BannerReorderInput): Promise<ActionResult<{ placement: string; moved: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("banners.manage");
    const parsed = bannerReorderSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await reorderBanners(parsed.data, actor);
    await invalidatePublic(listTagsFor("banner"));
    revalidatePath(PATH);
    return ok(result, result.moved > 0 ? "Order saved." : undefined);
  });
}
