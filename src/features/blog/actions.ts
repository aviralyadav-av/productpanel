"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { can, requirePermissionOrThrow } from "@/lib/auth/guards";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { getSettingString } from "@/lib/settings";

import {
  blogCategoryFormSchema,
  blogCategoryIdSchema,
  blogCategoryReorderSchema,
  blogPostFormSchema,
  blogPostIdSchema,
  blogStatusInputSchema,
  storefrontBlogUrl,
  type BlogCategoryFormInput,
  type BlogCategoryReorderInput,
  type BlogPostFormInput,
  type BlogStatusInput,
} from "./schemas";
import {
  createBlogCategory,
  createBlogPost,
  deleteBlogCategory,
  deleteBlogPost,
  duplicateBlogPost,
  issueBlogPreviewToken,
  reorderBlogCategories,
  setBlogPostFeatured,
  setBlogPostStatus,
  updateBlogCategory,
  updateBlogPost,
} from "./service";

/**
 * Server Actions for /admin/blog and /admin/blog/categories. After every
 * commit the public `blog` cache is invalidated (and `content` for posts,
 * since homepage sections may list them) and the admin lists revalidated.
 */

const PATH = "/admin/blog";

async function afterPostChange(id?: string): Promise<void> {
  await invalidatePublic(listTagsFor("blogPost"));
  revalidatePath(PATH);
  if (id) revalidatePath(`${PATH}/${id}`);
}

async function afterCategoryChange(): Promise<void> {
  await invalidatePublic(listTagsFor("blogCategory"));
  revalidatePath(`${PATH}/categories`);
  revalidatePath(PATH);
}

export type SavedPost = { id: string; title: string; slug: string; status: string };
const savedPost = (row: SavedPost): SavedPost => ({ id: row.id, title: row.title, slug: row.slug, status: row.status });

function ctxFor(actor: Awaited<ReturnType<typeof requirePermissionOrThrow>>) {
  return { actor, canPublish: can(actor, "blog.publish") };
}

export async function createBlogPostAction(input: BlogPostFormInput): Promise<ActionResult<SavedPost>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("blog.manage");
    const parsed = blogPostFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await createBlogPost(parsed.data, ctxFor(actor));
    await afterPostChange();
    return ok(savedPost(row), `Post "${row.title}" created.`);
  });
}

export async function updateBlogPostAction(id: string, input: BlogPostFormInput): Promise<ActionResult<SavedPost>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("blog.manage");
    const parsedId = blogPostIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid post id.");
    const parsed = blogPostFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await updateBlogPost(parsedId.data, parsed.data, ctxFor(actor));
    await afterPostChange(row.id);
    return ok(savedPost(row), `Post "${row.title}" saved.`);
  });
}

export async function setBlogPostStatusAction(id: string, input: BlogStatusInput): Promise<ActionResult<SavedPost>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("blog.publish");
    const parsedId = blogPostIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid post id.");
    const parsed = blogStatusInputSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await setBlogPostStatus(parsedId.data, parsed.data, { actor, canPublish: true });
    await afterPostChange(row.id);
    return ok(savedPost(row), `Post "${row.title}" is now ${row.status.toLowerCase()}.`);
  });
}

export async function setBlogPostFeaturedAction(id: string, isFeatured: boolean): Promise<ActionResult<SavedPost>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("blog.manage");
    const parsedId = blogPostIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid post id.");
    const row = await setBlogPostFeatured(parsedId.data, Boolean(isFeatured), ctxFor(actor));
    await afterPostChange(row.id);
    return ok(savedPost(row), row.isFeatured ? "Post featured." : "Post unfeatured.");
  });
}

export async function duplicateBlogPostAction(id: string): Promise<ActionResult<SavedPost>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("blog.manage");
    const parsedId = blogPostIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid post id.");
    const row = await duplicateBlogPost(parsedId.data, ctxFor(actor));
    await afterPostChange();
    return ok(savedPost(row), `Duplicated as a draft "${row.title}".`);
  });
}

export async function deleteBlogPostAction(id: string): Promise<ActionResult<{ id: string; title: string; slug: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("blog.manage");
    const parsedId = blogPostIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid post id.");
    const result = await deleteBlogPost(parsedId.data, ctxFor(actor));
    await afterPostChange(result.id);
    return ok(result, `Post "${result.title}" deleted.`);
  });
}

/** E6: mint a preview token and return the storefront URL to open. */
export async function blogPreviewUrlAction(id: string): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("blog.view");
    const parsedId = blogPostIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid post id.");
    const baseUrl = await getSettingString("storefront.base_url");
    if (!baseUrl) return fail("Set the storefront base URL in Settings → Storefront before previewing.");
    const { token, expiresAt, slug } = await issueBlogPreviewToken(parsedId.data, actor);
    return ok({ url: `${storefrontBlogUrl(baseUrl, slug)}?preview=${encodeURIComponent(token)}`, expiresAt: expiresAt.toISOString() });
  });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type SavedCategory = { id: string; name: string; slug: string };

export async function createBlogCategoryAction(input: BlogCategoryFormInput): Promise<ActionResult<SavedCategory>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("blog.manage");
    const parsed = blogCategoryFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await createBlogCategory(parsed.data, actor);
    await afterCategoryChange();
    return ok({ id: row.id, name: row.name, slug: row.slug }, `Category "${row.name}" created.`);
  });
}

export async function updateBlogCategoryAction(id: string, input: BlogCategoryFormInput): Promise<ActionResult<SavedCategory>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("blog.manage");
    const parsedId = blogCategoryIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid category id.");
    const parsed = blogCategoryFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await updateBlogCategory(parsedId.data, parsed.data, actor);
    await afterCategoryChange();
    return ok({ id: row.id, name: row.name, slug: row.slug }, `Category "${row.name}" saved.`);
  });
}

export async function deleteBlogCategoryAction(id: string): Promise<ActionResult<{ id: string; name: string; detachedPosts: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("blog.manage");
    const parsedId = blogCategoryIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid category id.");
    const result = await deleteBlogCategory(parsedId.data, actor);
    await afterCategoryChange();
    return ok(result, result.detachedPosts > 0 ? `Category "${result.name}" deleted; ${result.detachedPosts} post${result.detachedPosts === 1 ? " is" : "s are"} now uncategorised.` : `Category "${result.name}" deleted.`);
  });
}

export async function reorderBlogCategoriesAction(input: BlogCategoryReorderInput): Promise<ActionResult<{ moved: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("blog.manage");
    const parsed = blogCategoryReorderSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await reorderBlogCategories(parsed.data.ids, actor);
    await afterCategoryChange();
    return ok(result, result.moved > 0 ? "Order saved." : undefined);
  });
}
