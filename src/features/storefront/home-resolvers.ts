import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { asObject } from "@/lib/json";
import { MEDIA_SELECT, REVIEW_SELECT, serializeImage, serializeReview } from "@/lib/serializers/public";
import { inPublishWindow, sectionDefinition, type HomeResolver, type HomeResolverName } from "@/features/content/registry";
import { safeLinkUrl } from "./links";
import { getBanners } from "./queries/banners";
import { getCategoryTiles } from "./queries/categories";
import { getFooter } from "./queries/footer";
import { getProductCards, productOrderBy } from "./queries/products";
import { getSellerCards } from "./queries/sellers";
import { APPROVED_REVIEW_WHERE, categorySubtreeWhere } from "./queries/shared";

/**
 * `/api/v1/home` item resolvers (blueprint §14.E1, last table column).
 *
 * The registry (features/content/registry.ts) says WHICH resolver a section
 * type uses; this file says WHAT each resolver returns. Keyed by
 * HomeResolverName so adding a name to the registry without a resolver here
 * is a compile error, not a homepage that silently renders an empty strip.
 *
 * Payloads are parsed through the section's own registry schema, so a limit
 * the operator never set falls back to the registry default and a corrupt
 * value falls back to the whole default payload - never to a thrown error.
 */

type Db = Prisma.TransactionClient;
type Section = Parameters<HomeResolver>[0];

function settingsOf(section: Section): Record<string, unknown> {
  const definition = sectionDefinition(section.type);
  const parsed = definition.sectionSchema.safeParse(section.payload);
  if (parsed.success) return parsed.data;
  const defaults = definition.sectionSchema.safeParse({});
  return defaults.success ? defaults.data : asObject<Record<string, unknown>>(section.payload, {});
}

function idList(value: unknown, max = 50): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").slice(0, max)
    : [];
}

function limitOf(value: unknown, fallback: number, max = 48): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(max, Math.floor(parsed)) : fallback;
}

function sourceOf(value: unknown): "auto" | "manual" {
  return value === "manual" ? "manual" : "auto";
}

async function subtreeClause(client: Db, categoryId: unknown): Promise<Prisma.ProductWhereInput[]> {
  if (typeof categoryId !== "string" || !categoryId) return [];
  const category = await client.category.findFirst({
    where: { id: categoryId, isActive: true },
    select: { path: true },
  });
  return category ? [categorySubtreeWhere(category.path)] : [];
}

/** Payload keys a block may pass through, by section type; everything else stays server-side. */
const BLOCK_FIELDS: Record<string, readonly string[]> = {
  trust_badges: ["iconName", "title", "text"],
  announcement_bar: ["text", "linkUrl"],
};
const BLOCK_LINK_FIELDS = new Set(["linkUrl", "url", "href"]);

function publicBlockPayload(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  const allowed = BLOCK_FIELDS[type];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (allowed ? !allowed.includes(key) : /Ids?$/.test(key)) continue;
    if (BLOCK_LINK_FIELDS.has(key)) out[key] = safeLinkUrl(typeof value === "string" ? value : null);
    else if (value === null || ["string", "number", "boolean"].includes(typeof value)) out[key] = value;
  }
  return out;
}

export const HOME_RESOLVERS: Record<HomeResolverName, HomeResolver> = {
  /** hero_slider / promo_banners: the Banner placement named in the payload. */
  banners: async (section, ctx) => {
    const settings = settingsOf(section);
    const placement =
      typeof settings.placement === "string" && settings.placement
        ? settings.placement
        : section.type === "promo_banners"
          ? "HOME_PROMO"
          : "HOME_HERO";
    return getBanners({ placement, limit: limitOf(settings.limit, 5, 12), now: ctx.now }, ctx.tx);
  },

  /** featured_categories: isFeatured categories, or the listed ids in order. */
  categories: async (section, ctx) => {
    const settings = settingsOf(section);
    return getCategoryTiles(
      { source: sourceOf(settings.source), categoryIds: idList(settings.categoryIds), limit: limitOf(settings.limit, 8, 24) },
      ctx.tx,
    );
  },

  /** new_arrivals / best_sellers / trending / featured_products. */
  products: async (section, ctx) => {
    const client = ctx.tx ?? db;
    const settings = settingsOf(section);
    const limit = limitOf(settings.limit, 8);
    const productIds = idList(settings.productIds);
    if (sourceOf(settings.source) === "manual" && productIds.length > 0) {
      return getProductCards({ ids: productIds, take: limit }, client);
    }
    const where = await subtreeClause(client, settings.categoryId);
    switch (section.type) {
      case "best_sellers":
        return getProductCards({ where, orderBy: productOrderBy("popular"), take: limit }, client);
      case "trending":
        return getProductCards({ where: [...where, { isTrending: true }], orderBy: productOrderBy("position"), take: limit }, client);
      case "featured_products":
        return getProductCards({ where: [...where, { isFeatured: true }], orderBy: productOrderBy("position"), take: limit }, client);
      case "new_arrivals":
      default:
        return getProductCards({ where, orderBy: productOrderBy("newest"), take: limit }, client);
    }
  },

  /** product_collection: listed products first, then the category, then the tag, deduplicated. */
  collection: async (section, ctx) => {
    const client = ctx.tx ?? db;
    const settings = settingsOf(section);
    const limit = limitOf(settings.limit, 8);
    const listed = await getProductCards({ ids: idList(settings.productIds), take: limit }, client);
    const seen = new Set(listed.map((card) => card.id));
    const items = [...listed];

    const fill = async (where: Prisma.ProductWhereInput[]) => {
      if (items.length >= limit) return;
      const more = await getProductCards(
        { where: [...where, ...(seen.size ? [{ id: { notIn: [...seen] } }] : [])], orderBy: productOrderBy("position"), take: limit - items.length },
        client,
      );
      for (const card of more) {
        if (seen.has(card.id)) continue;
        seen.add(card.id);
        items.push(card);
      }
    };

    const subtree = await subtreeClause(client, settings.categoryId);
    if (subtree.length > 0) await fill(subtree);
    if (typeof settings.tag === "string" && settings.tag.trim()) {
      await fill([{ tags: { some: { slug: settings.tag.trim() } } }]);
    }
    return items.slice(0, limit);
  },

  /** seller_highlights: ACTIVE sellers by rating, or the listed ids. */
  sellers: async (section, ctx) => {
    const settings = settingsOf(section);
    return getSellerCards(
      { source: sourceOf(settings.source), sellerIds: idList(settings.sellerIds), limit: limitOf(settings.limit, 6, 24) },
      ctx.tx,
    );
  },

  /** testimonials: APPROVED reviews flagged isTestimonial, or the listed ids. */
  testimonials: async (section, ctx) => {
    const client = ctx.tx ?? db;
    const settings = settingsOf(section);
    const limit = limitOf(settings.limit, 6, 24);
    const reviewIds = idList(settings.reviewIds);
    const manual = sourceOf(settings.source) === "manual" && reviewIds.length > 0;
    const rows = await client.review.findMany({
      where: { ...APPROVED_REVIEW_WHERE, ...(manual ? { id: { in: reviewIds } } : { isTestimonial: true }) },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
      take: manual ? undefined : limit,
      select: REVIEW_SELECT,
    });
    const ordered = manual
      ? reviewIds.map((id) => rows.find((row) => row.id === id)).filter((row): row is (typeof rows)[number] => Boolean(row))
      : rows;
    return ordered.slice(0, limit).map(serializeReview);
  },

  /** product_reviews: APPROVED reviews flagged isFeatured at or above minRating. */
  featuredReviews: async (section, ctx) => {
    const client = ctx.tx ?? db;
    const settings = settingsOf(section);
    const rows = await client.review.findMany({
      where: { ...APPROVED_REVIEW_WHERE, isFeatured: true, rating: { gte: limitOf(settings.minRating, 4, 5) } },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
      take: limitOf(settings.limit, 6, 24),
      select: REVIEW_SELECT,
    });
    return rows.map(serializeReview);
  },

  /** promo_section / newsletter / rich_text: the content travels in `settings`, items stay empty. */
  stored: async () => [],

  /** trust_badges / announcement_bar: the section's in-window ContentBlock rows. */
  blocks: async (section, ctx) => {
    const client = ctx.tx ?? db;
    const rows = await client.contentBlock.findMany({
      where: { sectionId: section.id, enabled: true },
      orderBy: { position: "asc" },
      select: {
        id: true,
        position: true,
        enabled: true,
        publishAt: true,
        unpublishAt: true,
        payload: true,
        media: { select: MEDIA_SELECT },
      },
    });
    return rows
      .filter((row) => inPublishWindow(row, ctx.now))
      .map((row) => ({
        id: row.id,
        position: row.position,
        image: serializeImage(row.media),
        ...publicBlockPayload(section.type, asObject<Record<string, unknown>>(row.payload, {})),
      }));
  },

  /** footer: the same payload as /api/v1/footer, as a single item. */
  footer: async (_section, ctx) => [await getFooter(ctx.tx)],
};
