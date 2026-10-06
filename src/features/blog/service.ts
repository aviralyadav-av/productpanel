import type { BlogCategory, BlogPost, Prisma } from "@prisma/client";

import { forbiddenError, notFound, validationError } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";
import type { BlogStatus } from "@/lib/enums";
import { createPreviewToken } from "@/lib/preview-token";
import { sanitizeHtml } from "@/lib/sanitize/html";
import { slugify } from "@/lib/validation";

import { nextAvailableSlug, readingMinutes } from "@/features/pages/text";

import type { BlogCategoryFormValues, BlogPostFormValues } from "./schemas";

/**
 * Blog mutations (blueprint §4.8, §11.21/23, E6, D13): posts and categories.
 *
 *   - content is sanitised (`rich`) and `readingMinutes` recomputed on every
 *     write, so the storefront's "4 min read" is never stale;
 *   - `authorName` is a snapshot of the chosen admin's display name at save
 *     time - a renamed or deactivated user does not rewrite old bylines;
 *   - SCHEDULED needs a future `publishedAt`; PUBLISHED stamps now when no
 *     date is given. There is no publish job: the public API treats
 *     SCHEDULED + publishedAt ≤ now as live;
 *   - status changes need `blog.publish`, passed in as `canPublish`.
 *
 * No `server-only` / `next/*` imports; the callers invalidate caches.
 */

type Db = Prisma.TransactionClient;

export type BlogActorContext = { actor: AuditActor; canPublish: boolean };

function postSnapshot(row: BlogPost): Record<string, unknown> {
  const { createdAt, updatedAt, content, viewCount, ...rest } = row;
  void createdAt;
  void updatedAt;
  void viewCount;
  return { ...rest, contentLength: content.length };
}

async function loadPost(tx: Db, id: string): Promise<BlogPost> {
  const row = await tx.blogPost.findUnique({ where: { id } });
  if (!row) throw notFound("Blog post");
  return row;
}

export async function uniqueBlogSlug(tx: Db, wanted: string): Promise<string> {
  const taken = await tx.blogPost.findMany({ where: { slug: { startsWith: wanted } }, select: { slug: true } });
  return nextAvailableSlug(wanted, taken.map((row) => row.slug));
}

function assertCanPublish(ctx: BlogActorContext, from: BlogStatus | null, to: BlogStatus): void {
  if (from === to || ctx.canPublish) return;
  throw forbiddenError("You need the 'Publish blog' permission to change a post's status.");
}

/**
 * Status + date normalisation. A PUBLISHED post dated in the future is really
 * scheduled; saying so in the row keeps the admin list honest and lets the
 * public API use one rule (status ∈ {PUBLISHED, SCHEDULED} AND publishedAt ≤ now).
 */
function resolvePublishing(status: BlogStatus, requested: Date | null, existing: Date | null, now: Date): { status: BlogStatus; publishedAt: Date | null } {
  if (status === "PUBLISHED") {
    const at = requested ?? existing ?? now;
    return at.getTime() > now.getTime() ? { status: "SCHEDULED", publishedAt: at } : { status, publishedAt: at };
  }
  if (status === "SCHEDULED") {
    const at = requested ?? existing;
    if (!at) throw validationError({ publishedAt: "Choose when the post should go live." });
    return at.getTime() <= now.getTime() ? { status: "PUBLISHED", publishedAt: at } : { status, publishedAt: at };
  }
  return { status, publishedAt: requested ?? existing };
}

/** The byline snapshot for an author id; null author → the acting admin. */
async function resolveAuthor(tx: Db, authorId: string | null, actor: AuditActor): Promise<{ authorId: string | null; authorName: string | null }> {
  const wanted = authorId ?? (actor.id === "system" ? null : actor.id);
  if (!wanted) return { authorId: null, authorName: null };
  const user = await tx.user.findUnique({ where: { id: wanted }, select: { id: true, name: true, email: true, isActive: true, deletedAt: true } });
  if (!user || user.deletedAt) throw validationError({ authorId: "That author no longer exists." });
  return { authorId: user.id, authorName: user.name ?? user.email };
}

async function assertCategory(tx: Db, categoryId: string | null): Promise<void> {
  if (!categoryId) return;
  const found = await tx.blogCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
  if (!found) throw validationError({ categoryId: "That category no longer exists." });
}

async function toPostData(tx: Db, input: BlogPostFormValues, opts: { slug: string; publishing: { status: BlogStatus; publishedAt: Date | null }; actor: AuditActor }): Promise<Prisma.BlogPostUncheckedCreateInput> {
  await assertCategory(tx, input.categoryId);
  const author = await resolveAuthor(tx, input.authorId, opts.actor);
  const content = sanitizeHtml(input.content, "rich");
  const minutes = readingMinutes(content);
  return {
    title: input.title,
    slug: opts.slug,
    excerpt: input.excerpt ?? null,
    content,
    featuredImageMediaId: input.featuredImageMediaId ?? null,
    categoryId: input.categoryId ?? null,
    tags: input.tags,
    authorId: author.authorId,
    authorName: author.authorName,
    status: opts.publishing.status,
    publishedAt: opts.publishing.publishedAt,
    readingMinutes: minutes > 0 ? minutes : null,
    isFeatured: input.isFeatured,
    metaTitle: input.metaTitle ?? null,
    metaDescription: input.metaDescription ?? null,
    metaKeywords: input.metaKeywords ?? null,
    canonicalUrl: input.canonicalUrl ?? null,
    relatedProductIds: [...new Set(input.relatedProductIds)],
    relatedCategoryIds: [...new Set(input.relatedCategoryIds)],
  };
}

export async function createBlogPost(input: BlogPostFormValues, ctx: BlogActorContext, now: Date = new Date()): Promise<BlogPost> {
  assertCanPublish(ctx, "DRAFT", input.status);
  return db.$transaction(async (tx) => {
    const slug = await uniqueBlogSlug(tx, input.slug);
    const publishing = resolvePublishing(input.status, input.publishedAt, null, now);
    const row = await tx.blogPost.create({ data: await toPostData(tx, input, { slug, publishing, actor: ctx.actor }) });
    await writeAudit(tx, {
      actor: ctx.actor,
      action: "blog.create",
      entityType: "BlogPost",
      entityId: row.id,
      entityLabel: row.title,
      summary: `Created post "${row.title}" (/blog/${row.slug}) as ${row.status.toLowerCase()}.`,
      diff: diffOf(null, postSnapshot(row)),
    });
    return row;
  });
}

export async function updateBlogPost(id: string, input: BlogPostFormValues, ctx: BlogActorContext, now: Date = new Date()): Promise<BlogPost> {
  return db.$transaction(async (tx) => {
    const before = await loadPost(tx, id);
    assertCanPublish(ctx, before.status as BlogStatus, input.status);
    if (input.slug !== before.slug) {
      const clash = await tx.blogPost.findUnique({ where: { slug: input.slug }, select: { id: true } });
      if (clash) throw validationError({ slug: "Another post already uses this slug." });
    }
    const publishing = resolvePublishing(input.status, input.publishedAt, before.publishedAt, now);
    const row = await tx.blogPost.update({ where: { id }, data: await toPostData(tx, input, { slug: input.slug, publishing, actor: ctx.actor }) });
    const statusChanged = before.status !== row.status;
    await writeAudit(tx, {
      actor: ctx.actor,
      action: statusChanged ? "blog.status_change" : "blog.update",
      entityType: "BlogPost",
      entityId: row.id,
      entityLabel: row.title,
      summary: statusChanged ? `Updated post "${row.title}" and changed status ${before.status} → ${row.status}.` : `Updated post "${row.title}".`,
      diff: diffOf(postSnapshot(before), postSnapshot(row)),
    });
    return row;
  });
}

export async function setBlogPostStatus(id: string, input: { status: BlogStatus; publishedAt?: Date | null }, ctx: BlogActorContext, now: Date = new Date()): Promise<BlogPost> {
  return db.$transaction(async (tx) => {
    const before = await loadPost(tx, id);
    assertCanPublish(ctx, before.status as BlogStatus, input.status);
    const publishing = resolvePublishing(input.status, input.publishedAt ?? null, before.publishedAt, now);
    if (before.status === publishing.status && before.publishedAt?.getTime() === publishing.publishedAt?.getTime()) return before;
    const row = await tx.blogPost.update({ where: { id }, data: publishing });
    await writeAudit(tx, {
      actor: ctx.actor,
      action: "blog.status_change",
      entityType: "BlogPost",
      entityId: row.id,
      entityLabel: row.title,
      summary: `Changed post "${row.title}" status ${before.status} → ${row.status}.`,
      diff: diffOf({ status: before.status, publishedAt: before.publishedAt }, { status: row.status, publishedAt: row.publishedAt }),
    });
    return row;
  });
}

export async function setBlogPostFeatured(id: string, isFeatured: boolean, ctx: BlogActorContext): Promise<BlogPost> {
  return db.$transaction(async (tx) => {
    const before = await loadPost(tx, id);
    if (before.isFeatured === isFeatured) return before;
    const row = await tx.blogPost.update({ where: { id }, data: { isFeatured } });
    await writeAudit(tx, {
      actor: ctx.actor,
      action: "blog.feature",
      entityType: "BlogPost",
      entityId: row.id,
      entityLabel: row.title,
      summary: `${isFeatured ? "Featured" : "Unfeatured"} post "${row.title}".`,
      diff: diffOf({ isFeatured: before.isFeatured }, { isFeatured }),
    });
    return row;
  });
}

export async function duplicateBlogPost(id: string, ctx: BlogActorContext): Promise<BlogPost> {
  return db.$transaction(async (tx) => {
    const source = await loadPost(tx, id);
    const slug = await uniqueBlogSlug(tx, `${source.slug}-copy`);
    const { id: _id, createdAt, updatedAt, viewCount, ...rest } = source;
    void _id;
    void createdAt;
    void updatedAt;
    void viewCount;
    const row = await tx.blogPost.create({ data: { ...rest, slug, title: `${source.title} (copy)`, status: "DRAFT", publishedAt: null, isFeatured: false } });
    await writeAudit(tx, {
      actor: ctx.actor,
      action: "blog.duplicate",
      entityType: "BlogPost",
      entityId: row.id,
      entityLabel: row.title,
      summary: `Duplicated post "${source.title}" as "${row.title}".`,
      diff: diffOf(null, { sourceId: source.id, slug: row.slug }),
    });
    return row;
  });
}

export async function deleteBlogPost(id: string, ctx: BlogActorContext): Promise<{ id: string; title: string; slug: string }> {
  return db.$transaction(async (tx) => {
    const row = await loadPost(tx, id);
    await tx.blogPost.delete({ where: { id } });
    await writeAudit(tx, {
      actor: ctx.actor,
      action: "blog.delete",
      entityType: "BlogPost",
      entityId: row.id,
      entityLabel: row.title,
      summary: `Deleted post "${row.title}" (/blog/${row.slug}).`,
      diff: diffOf(postSnapshot(row), null),
    });
    return { id: row.id, title: row.title, slug: row.slug };
  });
}

/** E6 preview token for a post; audited because it exposes a draft. */
export async function issueBlogPreviewToken(id: string, actor: AuditActor, ttlSeconds?: number): Promise<{ token: string; expiresAt: Date; slug: string }> {
  const row = await db.blogPost.findUnique({ where: { id }, select: { slug: true, title: true, status: true } });
  if (!row) throw notFound("Blog post");
  const { token, expiresAt } = createPreviewToken({ entity: "blog", id, ttlSeconds });
  await writeAudit({
    actor,
    action: "blog.preview",
    entityType: "BlogPost",
    entityId: id,
    entityLabel: row.title,
    summary: `Issued a preview link for post "${row.title}" (${row.status.toLowerCase()}), valid until ${expiresAt.toISOString()}.`,
  });
  return { token, expiresAt, slug: row.slug };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

async function loadCategory(tx: Db, id: string): Promise<BlogCategory> {
  const row = await tx.blogCategory.findUnique({ where: { id } });
  if (!row) throw notFound("Blog category");
  return row;
}

async function uniqueCategorySlug(tx: Db, wanted: string): Promise<string> {
  const taken = await tx.blogCategory.findMany({ where: { slug: { startsWith: wanted } }, select: { slug: true } });
  return nextAvailableSlug(wanted, taken.map((row) => row.slug));
}

export async function createBlogCategory(input: BlogCategoryFormValues, actor: AuditActor): Promise<BlogCategory> {
  return db.$transaction(async (tx) => {
    const slug = await uniqueCategorySlug(tx, input.slug ?? slugify(input.name));
    const last = await tx.blogCategory.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
    const row = await tx.blogCategory.create({ data: { name: input.name, slug, description: input.description ?? null, isActive: input.isActive, position: last ? last.position + 1 : 0 } });
    await writeAudit(tx, {
      actor,
      action: "blog_category.create",
      entityType: "BlogCategory",
      entityId: row.id,
      entityLabel: row.name,
      summary: `Created blog category "${row.name}".`,
      diff: diffOf(null, { name: row.name, slug: row.slug, isActive: row.isActive }),
    });
    return row;
  });
}

export async function updateBlogCategory(id: string, input: BlogCategoryFormValues, actor: AuditActor): Promise<BlogCategory> {
  return db.$transaction(async (tx) => {
    const before = await loadCategory(tx, id);
    const slug = input.slug ?? before.slug;
    if (slug !== before.slug) {
      const clash = await tx.blogCategory.findUnique({ where: { slug }, select: { id: true } });
      if (clash) throw validationError({ slug: "Another category already uses this slug." });
    }
    const row = await tx.blogCategory.update({ where: { id }, data: { name: input.name, slug, description: input.description ?? null, isActive: input.isActive } });
    await writeAudit(tx, {
      actor,
      action: "blog_category.update",
      entityType: "BlogCategory",
      entityId: row.id,
      entityLabel: row.name,
      summary: `Updated blog category "${row.name}".`,
      diff: diffOf(
        { name: before.name, slug: before.slug, description: before.description, isActive: before.isActive },
        { name: row.name, slug: row.slug, description: row.description, isActive: row.isActive },
      ),
    });
    return row;
  });
}

/** Posts keep existing (categoryId → null via onDelete SetNull); the count is returned for the toast. */
export async function deleteBlogCategory(id: string, actor: AuditActor): Promise<{ id: string; name: string; detachedPosts: number }> {
  return db.$transaction(async (tx) => {
    const row = await loadCategory(tx, id);
    const detachedPosts = await tx.blogPost.count({ where: { categoryId: id } });
    await tx.blogCategory.delete({ where: { id } });
    await writeAudit(tx, {
      actor,
      action: "blog_category.delete",
      entityType: "BlogCategory",
      entityId: row.id,
      entityLabel: row.name,
      summary: `Deleted blog category "${row.name}"; ${detachedPosts} post${detachedPosts === 1 ? "" : "s"} left uncategorised.`,
      diff: diffOf({ name: row.name, slug: row.slug, detachedPosts }, null),
    });
    return { id: row.id, name: row.name, detachedPosts };
  });
}

/** Rewrite positions from the ids the board hands back; unknown ids are ignored, missing ones keep their relative order after. */
export async function reorderBlogCategories(ids: string[], actor: AuditActor): Promise<{ moved: number }> {
  return db.$transaction(async (tx) => {
    const rows = await tx.blogCategory.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, position: true } });
    const known = new Set(rows.map((row) => row.id));
    const ordered = [...ids.filter((id) => known.has(id)), ...rows.map((row) => row.id).filter((id) => !ids.includes(id))];
    let moved = 0;
    for (const [index, id] of ordered.entries()) {
      const current = rows.find((row) => row.id === id);
      if (current && current.position !== index) {
        await tx.blogCategory.update({ where: { id }, data: { position: index } });
        moved += 1;
      }
    }
    if (moved > 0) {
      await writeAudit(tx, {
        actor,
        action: "blog_category.reorder",
        entityType: "BlogCategory",
        summary: `Reordered ${moved} blog categor${moved === 1 ? "y" : "ies"}.`,
        diff: diffOf(null, { order: ordered }),
      });
    }
    return { moved };
  });
}
