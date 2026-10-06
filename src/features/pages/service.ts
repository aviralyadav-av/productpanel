import type { CmsPage, Prisma } from "@prisma/client";

import { conflict, forbiddenError, notFound, validationError } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";
import { SYSTEM_CMS_PAGE_SLUGS, type CmsPageStatus } from "@/lib/enums";
import { createPreviewToken } from "@/lib/preview-token";
import { sanitizeHtml } from "@/lib/sanitize/html";

import type { PageFormValues } from "./schemas";
import { nextAvailableSlug } from "./text";

/**
 * CMS page mutations (blueprint §4.8, §11.21/23/24, §14.E5/E6, D13).
 *
 * Rules that live here and nowhere else:
 *   - content is sanitised with the `rich` profile on every write (§11.21);
 *   - a duplicate slug is auto-suffixed on create and a 422 on edit (§11.23);
 *   - system pages (E5) keep their slug, cannot be deleted and CAN be
 *     unpublished - the warning is the UI's job, the service just allows it;
 *   - changing status requires `pages.publish`; the caller passes
 *     `canPublish` so this module stays free of next/auth imports while the
 *     check still runs inside the same transaction as the write.
 *
 * No `server-only` / `next/*` imports: cache invalidation and revalidatePath
 * happen in actions.ts and the REST routes after the transaction commits.
 */

type Db = Prisma.TransactionClient;

export type PageActorContext = { actor: AuditActor; canPublish: boolean };

function auditSnapshot(row: CmsPage): Record<string, unknown> {
  const { createdAt, updatedAt, content, ...rest } = row;
  void createdAt;
  void updatedAt;
  // The body can be tens of kilobytes; the diff records that it changed, not what it became.
  return { ...rest, contentLength: content.length };
}

async function loadPage(tx: Db, id: string): Promise<CmsPage> {
  const row = await tx.cmsPage.findUnique({ where: { id } });
  if (!row) throw notFound("Page");
  return row;
}

export function isSystemPageSlug(slug: string): boolean {
  return (SYSTEM_CMS_PAGE_SLUGS as readonly string[]).includes(slug);
}

/** Create-time de-duplication (§11.23): about-us → about-us-2 → about-us-3. */
export async function uniquePageSlug(tx: Db, wanted: string): Promise<string> {
  const taken = await tx.cmsPage.findMany({ where: { slug: { startsWith: wanted } }, select: { slug: true } });
  return nextAvailableSlug(wanted, taken.map((row) => row.slug));
}

/**
 * The publish timestamp that goes with a status: PUBLISHED needs one (now
 * unless the operator chose a date), the other states keep whatever history
 * they had so re-publishing later does not lose the original date.
 */
function publishedAtFor(status: CmsPageStatus, requested: Date | null, existing: Date | null, now: Date): Date | null {
  if (status === "PUBLISHED") return requested ?? existing ?? now;
  return requested ?? existing;
}

function assertCanPublish(ctx: PageActorContext, from: CmsPageStatus | null, to: CmsPageStatus): void {
  if (from === to || ctx.canPublish) return;
  throw forbiddenError("You need the 'Publish pages' permission to change a page's status.");
}

function toData(input: PageFormValues, opts: { slug: string; publishedAt: Date | null }): Omit<Prisma.CmsPageUncheckedCreateInput, "isSystem"> {
  return {
    title: input.title,
    slug: opts.slug,
    excerpt: input.excerpt ?? null,
    content: sanitizeHtml(input.content, "rich"),
    template: input.template,
    status: input.status,
    publishedAt: opts.publishedAt,
    showInFooter: input.showInFooter,
    metaTitle: input.metaTitle ?? null,
    metaDescription: input.metaDescription ?? null,
    metaKeywords: input.metaKeywords ?? null,
    canonicalUrl: input.canonicalUrl ?? null,
    ogImageMediaId: input.ogImageMediaId ?? null,
    noIndex: input.noIndex,
  };
}

function authorIdOf(actor: AuditActor): string | null {
  // Jobs and scripts write as SYSTEM_ACTOR whose id is not a real User row for FK purposes here.
  return actor.id === "system" ? null : actor.id;
}

export async function createPage(input: PageFormValues, ctx: PageActorContext, now: Date = new Date()): Promise<CmsPage> {
  assertCanPublish(ctx, "DRAFT", input.status);
  return db.$transaction(async (tx) => {
    const slug = await uniquePageSlug(tx, input.slug);
    const row = await tx.cmsPage.create({
      data: {
        ...toData(input, { slug, publishedAt: publishedAtFor(input.status, input.publishedAt, null, now) }),
        // A custom page never claims a system slug's protections; the seed owns those rows.
        isSystem: false,
        authorId: authorIdOf(ctx.actor),
      },
    });
    await writeAudit(tx, {
      actor: ctx.actor,
      action: "page.create",
      entityType: "CmsPage",
      entityId: row.id,
      entityLabel: row.title,
      summary: `Created page "${row.title}" (/pages/${row.slug}) as ${row.status.toLowerCase()}.`,
      diff: diffOf(null, auditSnapshot(row)),
    });
    return row;
  });
}

export async function updatePage(id: string, input: PageFormValues, ctx: PageActorContext, now: Date = new Date()): Promise<CmsPage> {
  return db.$transaction(async (tx) => {
    const before = await loadPage(tx, id);
    assertCanPublish(ctx, before.status as CmsPageStatus, input.status);

    // E5: a system page's slug is part of the storefront's routing contract.
    if (before.isSystem && input.slug !== before.slug) {
      throw validationError({ slug: "This is a system page; its address cannot change." });
    }
    if (input.slug !== before.slug) {
      const clash = await tx.cmsPage.findUnique({ where: { slug: input.slug }, select: { id: true } });
      if (clash) throw validationError({ slug: "Another page already uses this slug." });
    }

    const row = await tx.cmsPage.update({
      where: { id },
      data: toData(input, { slug: input.slug, publishedAt: publishedAtFor(input.status, input.publishedAt, before.publishedAt, now) }),
    });
    const statusChanged = before.status !== row.status;
    await writeAudit(tx, {
      actor: ctx.actor,
      action: statusChanged ? "page.status_change" : "page.update",
      entityType: "CmsPage",
      entityId: row.id,
      entityLabel: row.title,
      summary: statusChanged
        ? `Updated page "${row.title}" and changed status ${before.status} → ${row.status}.`
        : `Updated page "${row.title}".`,
      diff: diffOf(auditSnapshot(before), auditSnapshot(row)),
    });
    return row;
  });
}

/** Publish / unpublish / archive from the list or the header button (pages.publish). */
export async function setPageStatus(
  id: string,
  input: { status: CmsPageStatus; publishedAt?: Date | null },
  ctx: PageActorContext,
  now: Date = new Date(),
): Promise<CmsPage> {
  return db.$transaction(async (tx) => {
    const before = await loadPage(tx, id);
    assertCanPublish(ctx, before.status as CmsPageStatus, input.status);
    if (before.status === input.status && !input.publishedAt) return before;
    const row = await tx.cmsPage.update({
      where: { id },
      data: { status: input.status, publishedAt: publishedAtFor(input.status, input.publishedAt ?? null, before.publishedAt, now) },
    });
    const verb = row.status === "PUBLISHED" ? "Published" : row.status === "ARCHIVED" ? "Archived" : "Unpublished";
    await writeAudit(tx, {
      actor: ctx.actor,
      action: "page.status_change",
      entityType: "CmsPage",
      entityId: row.id,
      entityLabel: row.title,
      summary: `${verb} page "${row.title}"${before.isSystem ? " (system page)" : ""}.`,
      diff: diffOf({ status: before.status, publishedAt: before.publishedAt }, { status: row.status, publishedAt: row.publishedAt }),
    });
    return row;
  });
}

/** A draft copy with a suffixed slug; never a system page, never published. */
export async function duplicatePage(id: string, ctx: PageActorContext): Promise<CmsPage> {
  return db.$transaction(async (tx) => {
    const source = await loadPage(tx, id);
    const slug = await uniquePageSlug(tx, `${source.slug}-copy`);
    const { id: _id, createdAt, updatedAt, ...rest } = source;
    void _id;
    void createdAt;
    void updatedAt;
    const row = await tx.cmsPage.create({
      data: {
        ...rest,
        slug,
        title: `${source.title} (copy)`,
        status: "DRAFT",
        publishedAt: null,
        isSystem: false,
        showInFooter: false,
        authorId: authorIdOf(ctx.actor),
      },
    });
    await writeAudit(tx, {
      actor: ctx.actor,
      action: "page.duplicate",
      entityType: "CmsPage",
      entityId: row.id,
      entityLabel: row.title,
      summary: `Duplicated page "${source.title}" as "${row.title}".`,
      diff: diffOf(null, { sourceId: source.id, slug: row.slug }),
    });
    return row;
  });
}

export type DeletePageResult = { id: string; title: string; slug: string; detachedNavigationItems: number; detachedBanners: number };

/**
 * Hard delete (pages are not soft-deleted in the schema). System pages are
 * refused with a 409 (E5). Navigation items and banners pointing here have
 * `onDelete: SetNull`; the counts are returned so the toast can say
 * "3 menu links now point nowhere" instead of failing silently.
 */
export async function deletePage(id: string, ctx: PageActorContext): Promise<DeletePageResult> {
  return db.$transaction(async (tx) => {
    const row = await loadPage(tx, id);
    if (row.isSystem) throw conflict("System pages cannot be deleted. Unpublish it instead.");
    const [detachedNavigationItems, detachedBanners] = await Promise.all([
      tx.navigationItem.count({ where: { pageId: id } }),
      tx.banner.count({ where: { pageId: id } }),
    ]);
    await tx.cmsPage.delete({ where: { id } });
    await writeAudit(tx, {
      actor: ctx.actor,
      action: "page.delete",
      entityType: "CmsPage",
      entityId: row.id,
      entityLabel: row.title,
      summary: `Deleted page "${row.title}" (/pages/${row.slug}).`,
      diff: diffOf(auditSnapshot(row), null),
    });
    return { id: row.id, title: row.title, slug: row.slug, detachedNavigationItems, detachedBanners };
  });
}

/** E6: a short-lived HMAC token the storefront accepts as `?preview=`; audited because it exposes a draft. */
export async function issuePagePreviewToken(id: string, actor: AuditActor, ttlSeconds?: number): Promise<{ token: string; expiresAt: Date; slug: string }> {
  const row = await db.cmsPage.findUnique({ where: { id }, select: { slug: true, title: true, status: true } });
  if (!row) throw notFound("Page");
  const { token, expiresAt } = createPreviewToken({ entity: "page", id, ttlSeconds });
  await writeAudit({
    actor,
    action: "page.preview",
    entityType: "CmsPage",
    entityId: id,
    entityLabel: row.title,
    summary: `Issued a preview link for page "${row.title}" (${row.status.toLowerCase()}), valid until ${expiresAt.toISOString()}.`,
  });
  return { token, expiresAt, slug: row.slug };
}
