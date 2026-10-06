import type { Banner, Prisma } from "@prisma/client";

import { badRequest, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";

import type { BannerFormValues } from "./schemas";

/**
 * Banner mutations (blueprint §4.7, §11.25/26, §14.E1, F8).
 *
 * `position` is per placement: a new banner lands at the end of its placement,
 * a move to another placement re-appends it, and `reorderBanners` rewrites
 * positions for one placement from the ids the board hands back. BLOG links
 * have no FK on Banner (schema), so the chosen post's slug is stored in
 * `linkUrl` - exactly what the public serializer resolves.
 *
 * No `server-only` / `next/*` imports; cache invalidation and the
 * `content.expire` scheduling happen in actions.ts / the REST routes.
 */

type Db = Prisma.TransactionClient;

function auditSnapshot(row: Banner): Record<string, unknown> {
  const { createdAt, updatedAt, clickCount, impressionCount, ...rest } = row;
  void createdAt;
  void updatedAt;
  void clickCount;
  void impressionCount;
  return rest;
}

async function loadBanner(tx: Db, id: string): Promise<Banner> {
  const row = await tx.banner.findUnique({ where: { id } });
  if (!row) throw notFound("Banner");
  return row;
}

async function nextPosition(tx: Db, placement: string): Promise<number> {
  const last = await tx.banner.findFirst({ where: { placement }, orderBy: { position: "desc" }, select: { position: true } });
  return last ? last.position + 1 : 0;
}

/** BLOG banners store the post slug in linkUrl (no FK); anything else keeps the typed URL. */
async function resolveLinkUrl(tx: Db, input: BannerFormValues): Promise<string | null> {
  if (input.linkType === "BLOG" && input.blogPostId) {
    const post = await tx.blogPost.findUnique({ where: { id: input.blogPostId }, select: { slug: true } });
    if (!post) throw badRequest("That blog post no longer exists.", { blogPostId: "Choose another post." });
    return post.slug;
  }
  return input.linkUrl;
}

async function toData(tx: Db, input: BannerFormValues): Promise<Omit<Prisma.BannerUncheckedCreateInput, "position">> {
  return {
    title: input.title,
    subtitle: input.subtitle ?? null,
    placement: input.placement,
    mediaId: input.mediaId,
    mobileMediaId: input.mobileMediaId,
    altText: input.altText ?? null,
    linkType: input.linkType,
    linkUrl: await resolveLinkUrl(tx, input),
    categoryId: input.categoryId,
    productId: input.productId,
    pageId: input.pageId,
    buttonText: input.buttonText ?? null,
    textColor: input.textColor,
    bgColor: input.bgColor,
    isActive: input.isActive,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  };
}

export async function createBanner(input: BannerFormValues, actor: AuditActor): Promise<Banner> {
  return db.$transaction(async (tx) => {
    const data = await toData(tx, input);
    const position = input.position ?? (await nextPosition(tx, input.placement));
    const row = await tx.banner.create({ data: { ...data, position } });
    await writeAudit(tx, {
      actor,
      action: "banner.create",
      entityType: "banner",
      entityId: row.id,
      entityLabel: row.title,
      summary: `Created banner "${row.title}" in ${row.placement}.`,
      diff: diffOf(null, auditSnapshot(row)),
    });
    return row;
  });
}

export async function updateBanner(id: string, input: BannerFormValues, actor: AuditActor): Promise<Banner> {
  return db.$transaction(async (tx) => {
    const before = await loadBanner(tx, id);
    const data = await toData(tx, input);
    const movedPlacement = before.placement !== input.placement;
    const position = input.position ?? (movedPlacement ? await nextPosition(tx, input.placement) : before.position);
    const row = await tx.banner.update({ where: { id }, data: { ...data, position } });
    await writeAudit(tx, {
      actor,
      action: "banner.update",
      entityType: "banner",
      entityId: row.id,
      entityLabel: row.title,
      summary: `Updated banner "${row.title}".`,
      diff: diffOf(auditSnapshot(before), auditSnapshot(row)),
    });
    return row;
  });
}

export async function setBannerActive(id: string, isActive: boolean, actor: AuditActor): Promise<Banner> {
  return db.$transaction(async (tx) => {
    const before = await loadBanner(tx, id);
    if (before.isActive === isActive) return before;
    const row = await tx.banner.update({ where: { id }, data: { isActive } });
    await writeAudit(tx, {
      actor,
      action: isActive ? "banner.show" : "banner.hide",
      entityType: "banner",
      entityId: row.id,
      entityLabel: row.title,
      summary: `${isActive ? "Showed" : "Hid"} banner "${row.title}".`,
      diff: diffOf({ isActive: before.isActive }, { isActive }),
    });
    return row;
  });
}

/** A hidden copy at the end of the same placement, counters reset. */
export async function duplicateBanner(id: string, actor: AuditActor): Promise<Banner> {
  return db.$transaction(async (tx) => {
    const source = await loadBanner(tx, id);
    const { id: _id, createdAt, updatedAt, clickCount, impressionCount, position, ...rest } = source;
    void _id;
    void createdAt;
    void updatedAt;
    void clickCount;
    void impressionCount;
    void position;
    const row = await tx.banner.create({
      data: { ...rest, title: `${source.title} (copy)`, isActive: false, position: await nextPosition(tx, source.placement) },
    });
    await writeAudit(tx, {
      actor,
      action: "banner.duplicate",
      entityType: "banner",
      entityId: row.id,
      entityLabel: row.title,
      summary: `Duplicated banner "${source.title}".`,
      diff: diffOf(null, { sourceId: source.id }),
    });
    return row;
  });
}

export async function deleteBanner(id: string, actor: AuditActor): Promise<{ id: string; title: string; placement: string }> {
  return db.$transaction(async (tx) => {
    const row = await loadBanner(tx, id);
    await tx.banner.delete({ where: { id } });
    await writeAudit(tx, {
      actor,
      action: "banner.delete",
      entityType: "banner",
      entityId: row.id,
      entityLabel: row.title,
      summary: `Deleted banner "${row.title}" from ${row.placement}.`,
      diff: diffOf(auditSnapshot(row), null),
    });
    return { id: row.id, title: row.title, placement: row.placement };
  });
}

export async function resetBannerCounters(id: string, actor: AuditActor): Promise<Banner> {
  return db.$transaction(async (tx) => {
    const before = await loadBanner(tx, id);
    const row = await tx.banner.update({ where: { id }, data: { clickCount: 0, impressionCount: 0 } });
    await writeAudit(tx, {
      actor,
      action: "banner.reset_counters",
      entityType: "banner",
      entityId: row.id,
      entityLabel: row.title,
      summary: `Reset counters for banner "${row.title}" (${before.impressionCount} impressions, ${before.clickCount} clicks).`,
      diff: diffOf({ clickCount: before.clickCount, impressionCount: before.impressionCount }, { clickCount: 0, impressionCount: 0 }),
    });
    return row;
  });
}

/**
 * Rewrite positions for one placement. Ids not in the placement are ignored
 * and banners of the placement missing from `ids` keep their relative order
 * after the listed ones, so a stale board (someone else added a banner) never
 * loses a row.
 */
export async function reorderBanners(input: { placement: string; ids: string[] }, actor: AuditActor): Promise<{ placement: string; moved: number }> {
  return db.$transaction(async (tx) => {
    const rows = await tx.banner.findMany({ where: { placement: input.placement }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, position: true } });
    const known = new Set(rows.map((row) => row.id));
    const ordered = [...input.ids.filter((id) => known.has(id)), ...rows.map((row) => row.id).filter((id) => !input.ids.includes(id))];

    let moved = 0;
    for (const [index, id] of ordered.entries()) {
      const current = rows.find((row) => row.id === id);
      if (current && current.position !== index) {
        await tx.banner.update({ where: { id }, data: { position: index } });
        moved += 1;
      }
    }

    if (moved > 0) {
      await writeAudit(tx, {
        actor,
        action: "banner.reorder",
        entityType: "banner",
        summary: `Reordered ${moved} banner${moved === 1 ? "" : "s"} in ${input.placement}.`,
        diff: diffOf(null, { placement: input.placement, order: ordered }),
      });
    }
    return { placement: input.placement, moved };
  });
}
