import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { BANNER_PLACEMENTS, type BannerPlacement } from "@/lib/enums";
import type { EntityRef } from "@/components/shared/entity-picker";
import { toPickedAsset } from "@/features/media/dto";
import { getMediaAssets } from "@/features/media/queries";
import { blogAvailable, categoryAvailable, pageAvailable, productAvailable, safeLinkUrl } from "@/features/storefront/links";

import { BANNER_PLACEMENT_INFO } from "./placements";
import { deriveBannerStatus, type BannerCardRow, type BannerEditorData, type BannerGroup, type BannerListFilters, type BannerMedia, type BannerStatus } from "./schemas";

/**
 * Read side of banners. The board is grouped by placement and ordered by
 * `position`; link targets are resolved with the SAME availability rules the
 * public serializer uses (storefront/links.ts), so an admin sees "target
 * unpublished" exactly when the storefront would drop the link (§11.25).
 */

const MEDIA_SELECT = { select: { id: true, url: true, thumbnailUrl: true, width: true, height: true } } as const;

const CARD_SELECT = {
  id: true,
  title: true,
  subtitle: true,
  placement: true,
  altText: true,
  linkType: true,
  linkUrl: true,
  buttonText: true,
  textColor: true,
  bgColor: true,
  position: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
  clickCount: true,
  impressionCount: true,
  updatedAt: true,
  media: MEDIA_SELECT,
  mobileMedia: MEDIA_SELECT,
  category: { select: { id: true, name: true, path: true, isActive: true } },
  product: { select: { id: true, title: true, slug: true, status: true, deletedAt: true, seller: { select: { status: true, deletedAt: true } } } },
  page: { select: { id: true, title: true, slug: true, status: true } },
} satisfies Prisma.BannerSelect;

type CardSource = Prisma.BannerGetPayload<{ select: typeof CARD_SELECT }>;

function statusWhere(status: BannerStatus, now: Date): Prisma.BannerWhereInput {
  switch (status) {
    case "DISABLED":
      return { isActive: false };
    case "SCHEDULED":
      return { isActive: true, startsAt: { gt: now } };
    case "EXPIRED":
      return { isActive: true, endsAt: { lt: now } };
    case "ACTIVE":
    default:
      return { isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] };
  }
}

function linkSummary(
  row: CardSource,
  blog: { title: string; status: string; publishedAt: Date | null } | undefined,
): { linkLabel: string | null; linkResolves: boolean } {
  switch (row.linkType) {
    case "URL":
      return { linkLabel: row.linkUrl, linkResolves: Boolean(safeLinkUrl(row.linkUrl)) };
    case "CATEGORY":
      return { linkLabel: row.category ? `Category: ${row.category.name}` : "Category (deleted)", linkResolves: categoryAvailable(row.category) };
    case "PRODUCT":
      return { linkLabel: row.product ? `Product: ${row.product.title}` : "Product (deleted)", linkResolves: productAvailable(row.product) };
    case "PAGE":
      return { linkLabel: row.page ? `Page: ${row.page.title}` : "Page (deleted)", linkResolves: pageAvailable(row.page) };
    case "BLOG":
      return {
        linkLabel: blog ? `Post: ${blog.title}` : row.linkUrl ? `Post: ${row.linkUrl}` : "Blog post (missing)",
        linkResolves: blog ? blogAvailable({ slug: row.linkUrl ?? "", status: blog.status, publishedAt: blog.publishedAt }) : Boolean(row.linkUrl && /^https?:\/\//i.test(row.linkUrl)),
      };
    default:
      return { linkLabel: null, linkResolves: true };
  }
}

async function loadBlogTargets(rows: CardSource[]) {
  const slugs = [...new Set(rows.filter((row) => row.linkType === "BLOG" && row.linkUrl && !/^https?:\/\//i.test(row.linkUrl)).map((row) => row.linkUrl as string))];
  if (slugs.length === 0) return new Map<string, { title: string; status: string; publishedAt: Date | null }>();
  const posts = await db.blogPost.findMany({ where: { slug: { in: slugs } }, select: { slug: true, title: true, status: true, publishedAt: true } });
  return new Map(posts.map((post) => [post.slug, post]));
}

function toMedia(media: CardSource["media"]): BannerMedia {
  return media ? { id: media.id, url: media.url, thumbnailUrl: media.thumbnailUrl, width: media.width, height: media.height } : null;
}

export async function listBannerGroups(filters: BannerListFilters, now: Date = new Date()): Promise<{ groups: BannerGroup[]; total: number; statusCounts: Record<BannerStatus, number> }> {
  const clauses: Prisma.BannerWhereInput[] = [];
  if (filters.placement) clauses.push({ placement: filters.placement });
  if (filters.status) clauses.push(statusWhere(filters.status, now));
  if (filters.q) {
    clauses.push({ OR: [{ title: { contains: filters.q, mode: "insensitive" } }, { subtitle: { contains: filters.q, mode: "insensitive" } }, { linkUrl: { contains: filters.q, mode: "insensitive" } }] });
  }
  const where: Prisma.BannerWhereInput = clauses.length > 0 ? { AND: clauses } : {};
  const base: Prisma.BannerWhereInput = { AND: clauses.filter((clause) => !("isActive" in clause)) };

  const [rows, ...counts] = await Promise.all([
    db.banner.findMany({ where, orderBy: [{ placement: "asc" }, { position: "asc" }, { createdAt: "asc" }], take: 1000, select: CARD_SELECT }),
    ...(["ACTIVE", "SCHEDULED", "EXPIRED", "DISABLED"] as BannerStatus[]).map((status) => db.banner.count({ where: { AND: [base, statusWhere(status, now)] } })),
  ]);
  const blogs = await loadBlogTargets(rows);

  const cards: BannerCardRow[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    placement: row.placement as BannerPlacement,
    media: toMedia(row.media),
    mobileMedia: toMedia(row.mobileMedia),
    altText: row.altText,
    linkType: row.linkType as BannerCardRow["linkType"],
    ...linkSummary(row, row.linkUrl ? blogs.get(row.linkUrl) : undefined),
    buttonText: row.buttonText,
    textColor: row.textColor,
    bgColor: row.bgColor,
    position: row.position,
    isActive: row.isActive,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    clickCount: row.clickCount,
    impressionCount: row.impressionCount,
    status: deriveBannerStatus(row, now),
    updatedAt: row.updatedAt,
  }));

  const placements = filters.placement ? [filters.placement] : BANNER_PLACEMENTS;
  const groups: BannerGroup[] = placements.map((placement) => {
    const info = BANNER_PLACEMENT_INFO.find((entry) => entry.placement === placement)!;
    const group = cards.filter((card) => card.placement === placement);
    return { placement, label: info.label, description: info.description, rows: group, liveCount: group.filter((card) => card.status === "ACTIVE").length };
  });

  return {
    groups,
    total: cards.length,
    statusCounts: { ACTIVE: counts[0], SCHEDULED: counts[1], EXPIRED: counts[2], DISABLED: counts[3] },
  };
}

export async function getBannerEditor(id: string, now: Date = new Date()): Promise<BannerEditorData | null> {
  const row = await db.banner.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true, path: true } },
      product: { select: { id: true, title: true, status: true } },
      page: { select: { id: true, title: true, slug: true } },
    },
  });
  if (!row) return null;

  const mediaIds = [row.mediaId, row.mobileMediaId].filter((value): value is string => Boolean(value));
  const [assets, blog] = await Promise.all([
    getMediaAssets(mediaIds),
    row.linkType === "BLOG" && row.linkUrl && !/^https?:\/\//i.test(row.linkUrl)
      ? db.blogPost.findUnique({ where: { slug: row.linkUrl }, select: { id: true, title: true, slug: true } })
      : Promise.resolve(null),
  ]);
  const asset = (mediaId: string | null) => {
    const found = mediaId ? assets.find((entry) => entry.id === mediaId) : undefined;
    return found ? toPickedAsset(found) : null;
  };
  const ref = <T extends { id: string }>(target: T | null, title: (t: T) => string, subtitle?: (t: T) => string | undefined): EntityRef | null =>
    target ? { id: target.id, title: title(target), subtitle: subtitle?.(target) } : null;

  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    placement: row.placement as BannerPlacement,
    media: asset(row.mediaId),
    mobileMedia: asset(row.mobileMediaId),
    altText: row.altText,
    linkType: row.linkType as BannerEditorData["linkType"],
    linkUrl: row.linkUrl,
    category: ref(row.category, (c) => c.name, (c) => c.path),
    product: ref(row.product, (p) => p.title, (p) => p.status),
    page: ref(row.page, (p) => p.title, (p) => `/pages/${p.slug}`),
    blogPost: ref(blog, (b) => b.title, (b) => `/blog/${b.slug}`),
    buttonText: row.buttonText,
    textColor: row.textColor,
    bgColor: row.bgColor,
    position: row.position,
    isActive: row.isActive,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    clickCount: row.clickCount,
    impressionCount: row.impressionCount,
    status: deriveBannerStatus(row, now),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
