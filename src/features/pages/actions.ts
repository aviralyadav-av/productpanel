"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { can, requirePermissionOrThrow } from "@/lib/auth/guards";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { getSettingString } from "@/lib/settings";

import { pageFormSchema, pageIdSchema, pageStatusInputSchema, storefrontPageUrl, type PageFormInput, type PageStatusInput } from "./schemas";
import { createPage, deletePage, duplicatePage, issuePagePreviewToken, setPageStatus, updatePage, type DeletePageResult } from "./service";

/**
 * Server Actions for /admin/pages. Every mutation: permission → zod → service
 * (transaction + audit) → invalidate the public `pages` cache (the storefront
 * footer and /pages/:slug read it) → revalidate the admin list → ActionResult.
 */

const PATH = "/admin/pages";

async function afterChange(id?: string): Promise<void> {
  await invalidatePublic(listTagsFor("page"));
  revalidatePath(PATH);
  if (id) revalidatePath(`${PATH}/${id}`);
}

export type SavedPage = { id: string; title: string; slug: string; status: string };

function saved(row: { id: string; title: string; slug: string; status: string }): SavedPage {
  return { id: row.id, title: row.title, slug: row.slug, status: row.status };
}

export async function createPageAction(input: PageFormInput): Promise<ActionResult<SavedPage>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("pages.manage");
    const parsed = pageFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await createPage(parsed.data, { actor, canPublish: can(actor, "pages.publish") });
    await afterChange();
    return ok(saved(row), `Page "${row.title}" created.`);
  });
}

export async function updatePageAction(id: string, input: PageFormInput): Promise<ActionResult<SavedPage>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("pages.manage");
    const parsedId = pageIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid page id.");
    const parsed = pageFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await updatePage(parsedId.data, parsed.data, { actor, canPublish: can(actor, "pages.publish") });
    await afterChange(row.id);
    return ok(saved(row), `Page "${row.title}" saved.`);
  });
}

export async function setPageStatusAction(id: string, input: PageStatusInput): Promise<ActionResult<SavedPage>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("pages.publish");
    const parsedId = pageIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid page id.");
    const parsed = pageStatusInputSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await setPageStatus(parsedId.data, parsed.data, { actor, canPublish: true });
    await afterChange(row.id);
    const verb = row.status === "PUBLISHED" ? "published" : row.status === "ARCHIVED" ? "archived" : "unpublished";
    return ok(saved(row), `Page "${row.title}" ${verb}.`);
  });
}

export async function duplicatePageAction(id: string): Promise<ActionResult<SavedPage>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("pages.manage");
    const parsedId = pageIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid page id.");
    const row = await duplicatePage(parsedId.data, { actor, canPublish: can(actor, "pages.publish") });
    await afterChange();
    return ok(saved(row), `Duplicated as a draft "${row.title}".`);
  });
}

export async function deletePageAction(id: string): Promise<ActionResult<DeletePageResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("pages.manage");
    const parsedId = pageIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid page id.");
    const result = await deletePage(parsedId.data, { actor, canPublish: can(actor, "pages.publish") });
    await afterChange(result.id);
    const detached = result.detachedNavigationItems + result.detachedBanners;
    return ok(result, detached > 0 ? `Page "${result.title}" deleted. ${detached} link${detached === 1 ? "" : "s"} to it now point nowhere.` : `Page "${result.title}" deleted.`);
  });
}

/** E6: mint a preview token and return the full storefront URL to open. */
export async function pagePreviewUrlAction(id: string): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("pages.view");
    const parsedId = pageIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid page id.");
    const baseUrl = await getSettingString("storefront.base_url");
    if (!baseUrl) return fail("Set the storefront base URL in Settings → Storefront before previewing.");
    const { token, expiresAt, slug } = await issuePagePreviewToken(parsedId.data, actor);
    return ok({ url: `${storefrontPageUrl(baseUrl, slug)}?preview=${encodeURIComponent(token)}`, expiresAt: expiresAt.toISOString() });
  });
}
