import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * "Where is this asset used?" (blueprint §11.22, §14.F1).
 *
 * The schema guarantees every `*MediaId` column is a FK with a back-relation
 * on MediaAsset, so the answer is a FIXED list of relation counts rather than
 * a search. This file is that list. When a new `*MediaId` column is added to
 * the schema its back-relation must be added here too - the `satisfies`
 * clause on USAGE_SELECT fails to compile if a relation named here does not
 * exist, and the check script asserts the list covers every relation Prisma
 * knows about.
 *
 * Three Setting rows point at media by VALUE (`store.logo_media_id`,
 * `store.favicon_media_id`, `seo.og_image_media_id`), so those are checked
 * with an equality query on top.
 *
 * No Next imports: the service (and through it the seed / check script)
 * calls this as plain tsx.
 */

export type MediaUsageItem = {
  id: string;
  label: string;
  href: string;
};

export type MediaUsage = {
  /** Human noun, e.g. "Product image". */
  type: string;
  /** Prisma back-relation name, e.g. "productImages". */
  relation: string;
  count: number;
  /** Where to go to fix it: the first referencing record, or the module list. */
  href: string;
  /** Up to USAGE_SAMPLE referencing records, each with its own link. */
  items: MediaUsageItem[];
};

export const USAGE_SAMPLE = 5;

type Client = Prisma.TransactionClient | typeof db;

// Each relation: the fields to select on the referencing row, and how to turn
// one row into a label + link. `take` bounds the sample; `_count` gives the
// real total.

const USAGE_SELECT = {
  _count: {
    select: {
      categoryImages: true,
      categoryIcons: true,
      categoryBanners: true,
      categoryOgImages: true,
      productImages: true,
      productVideos: true,
      productOgImages: true,
      sellerLogos: true,
      sellerBanners: true,
      sellerDocuments: true,
      promotionBanners: true,
      banners: true,
      bannerMobiles: true,
      contentSections: true,
      contentBlocks: true,
      cmsPageOgImages: true,
      blogFeaturedImages: true,
      reviewImages: true,
    },
  },
  categoryImages: { take: USAGE_SAMPLE, select: { id: true, name: true } },
  categoryIcons: { take: USAGE_SAMPLE, select: { id: true, name: true } },
  categoryBanners: { take: USAGE_SAMPLE, select: { id: true, name: true } },
  categoryOgImages: { take: USAGE_SAMPLE, select: { id: true, name: true } },
  productImages: {
    take: USAGE_SAMPLE,
    select: { id: true, product: { select: { id: true, title: true } } },
  },
  productVideos: { take: USAGE_SAMPLE, select: { id: true, title: true } },
  productOgImages: { take: USAGE_SAMPLE, select: { id: true, title: true } },
  sellerLogos: { take: USAGE_SAMPLE, select: { id: true, displayName: true } },
  sellerBanners: { take: USAGE_SAMPLE, select: { id: true, displayName: true } },
  sellerDocuments: {
    take: USAGE_SAMPLE,
    select: { id: true, type: true, label: true, seller: { select: { id: true, displayName: true } } },
  },
  promotionBanners: { take: USAGE_SAMPLE, select: { id: true, name: true } },
  banners: { take: USAGE_SAMPLE, select: { id: true, title: true } },
  bannerMobiles: { take: USAGE_SAMPLE, select: { id: true, title: true } },
  contentSections: { take: USAGE_SAMPLE, select: { id: true, title: true, page: true } },
  contentBlocks: {
    take: USAGE_SAMPLE,
    select: { id: true, section: { select: { id: true, title: true, page: true } } },
  },
  cmsPageOgImages: { take: USAGE_SAMPLE, select: { id: true, title: true } },
  blogFeaturedImages: { take: USAGE_SAMPLE, select: { id: true, title: true } },
  reviewImages: {
    take: USAGE_SAMPLE,
    select: { id: true, review: { select: { id: true, title: true } } },
  },
} satisfies Prisma.MediaAssetSelect;

type UsageRow = Prisma.MediaAssetGetPayload<{ select: typeof USAGE_SELECT }>;
type RelationName = keyof UsageRow["_count"];

/** Every back-relation the usage check covers - the check script compares this with the schema. */
export const USAGE_RELATIONS = Object.keys(USAGE_SELECT._count.select) as RelationName[];

type Describe = { type: string; listHref: string; items: (row: UsageRow) => MediaUsageItem[] };

const DESCRIBE: Record<RelationName, Describe> = {
  categoryImages: {
    type: "Category image",
    listHref: "/admin/categories",
    items: (row) => row.categoryImages.map((c) => ({ id: c.id, label: c.name, href: `/admin/categories/${c.id}` })),
  },
  categoryIcons: {
    type: "Category icon",
    listHref: "/admin/categories",
    items: (row) => row.categoryIcons.map((c) => ({ id: c.id, label: c.name, href: `/admin/categories/${c.id}` })),
  },
  categoryBanners: {
    type: "Category banner",
    listHref: "/admin/categories",
    items: (row) => row.categoryBanners.map((c) => ({ id: c.id, label: c.name, href: `/admin/categories/${c.id}` })),
  },
  categoryOgImages: {
    type: "Category share image",
    listHref: "/admin/categories",
    items: (row) => row.categoryOgImages.map((c) => ({ id: c.id, label: c.name, href: `/admin/categories/${c.id}` })),
  },
  productImages: {
    type: "Product image",
    listHref: "/admin/products",
    items: (row) =>
      row.productImages.map((img) => ({
        id: img.product.id,
        label: img.product.title,
        href: `/admin/products/${img.product.id}`,
      })),
  },
  productVideos: {
    type: "Product video",
    listHref: "/admin/products",
    items: (row) => row.productVideos.map((p) => ({ id: p.id, label: p.title, href: `/admin/products/${p.id}` })),
  },
  productOgImages: {
    type: "Product share image",
    listHref: "/admin/products",
    items: (row) => row.productOgImages.map((p) => ({ id: p.id, label: p.title, href: `/admin/products/${p.id}` })),
  },
  sellerLogos: {
    type: "Seller logo",
    listHref: "/admin/sellers",
    items: (row) => row.sellerLogos.map((s) => ({ id: s.id, label: s.displayName, href: `/admin/sellers/${s.id}` })),
  },
  sellerBanners: {
    type: "Seller banner",
    listHref: "/admin/sellers",
    items: (row) => row.sellerBanners.map((s) => ({ id: s.id, label: s.displayName, href: `/admin/sellers/${s.id}` })),
  },
  sellerDocuments: {
    type: "Seller KYC document",
    listHref: "/admin/sellers",
    items: (row) =>
      row.sellerDocuments.map((d) => ({
        id: d.id,
        label: `${d.seller.displayName} - ${d.label ?? d.type}`,
        href: `/admin/sellers/${d.seller.id}`,
      })),
  },
  promotionBanners: {
    type: "Promotion banner",
    listHref: "/admin/promotions",
    items: (row) => row.promotionBanners.map((p) => ({ id: p.id, label: p.name, href: `/admin/promotions/${p.id}` })),
  },
  banners: {
    type: "Banner",
    listHref: "/admin/banners",
    items: (row) => row.banners.map((b) => ({ id: b.id, label: b.title, href: `/admin/banners/${b.id}` })),
  },
  bannerMobiles: {
    type: "Banner (mobile)",
    listHref: "/admin/banners",
    items: (row) => row.bannerMobiles.map((b) => ({ id: b.id, label: b.title, href: `/admin/banners/${b.id}` })),
  },
  contentSections: {
    type: "Homepage section",
    listHref: "/admin/homepage",
    items: (row) =>
      row.contentSections.map((s) => ({ id: s.id, label: s.title, href: `/admin/homepage?section=${s.id}` })),
  },
  contentBlocks: {
    type: "Homepage block",
    listHref: "/admin/homepage",
    items: (row) =>
      row.contentBlocks.map((b) => ({
        id: b.id,
        label: b.section.title,
        href: `/admin/homepage?section=${b.section.id}`,
      })),
  },
  cmsPageOgImages: {
    type: "Page share image",
    listHref: "/admin/pages",
    items: (row) => row.cmsPageOgImages.map((p) => ({ id: p.id, label: p.title, href: `/admin/pages/${p.id}` })),
  },
  blogFeaturedImages: {
    type: "Blog featured image",
    listHref: "/admin/blog",
    items: (row) => row.blogFeaturedImages.map((p) => ({ id: p.id, label: p.title, href: `/admin/blog/${p.id}` })),
  },
  reviewImages: {
    type: "Review photo",
    listHref: "/admin/reviews",
    items: (row) =>
      row.reviewImages.map((r) => ({
        id: r.review.id,
        label: r.review.title ?? "Review",
        href: `/admin/reviews/${r.review.id}`,
      })),
  },
};

/** Setting keys whose VALUE is a MediaAsset id. */
export const MEDIA_SETTING_KEYS: Record<string, string> = {
  "store.logo_media_id": "Store logo (Settings)",
  "store.favicon_media_id": "Store favicon (Settings)",
  "seo.og_image_media_id": "Default share image (Settings)",
};

/**
 * Every place the asset is referenced, with counts and sample links. Returns
 * an empty array for an unknown id so callers can treat "not found" and "not
 * used" the same way when all they need is a yes/no.
 */
export async function getMediaUsage(id: string, client: Client = db): Promise<MediaUsage[]> {
  const [row, settings] = await Promise.all([
    client.mediaAsset.findUnique({ where: { id }, select: USAGE_SELECT }),
    client.setting.findMany({
      where: { key: { in: Object.keys(MEDIA_SETTING_KEYS) }, value: id },
      select: { key: true },
    }),
  ]);
  if (!row) return [];

  const usages: MediaUsage[] = [];
  for (const relation of USAGE_RELATIONS) {
    const count = row._count[relation];
    if (count === 0) continue;
    const describe = DESCRIBE[relation];
    const items = describe.items(row);
    usages.push({
      type: describe.type,
      relation,
      count,
      href: items[0]?.href ?? describe.listHref,
      items,
    });
  }

  for (const setting of settings) {
    usages.push({
      type: MEDIA_SETTING_KEYS[setting.key] ?? setting.key,
      relation: `setting:${setting.key}`,
      count: 1,
      href: "/admin/settings",
      items: [{ id: setting.key, label: setting.key, href: "/admin/settings" }],
    });
  }

  return usages;
}

/** Cheap yes/no for bulk operations: one query, no samples. */
export async function isMediaInUse(id: string, client: Client = db): Promise<boolean> {
  const [row, setting] = await Promise.all([
    client.mediaAsset.findUnique({ where: { id }, select: { _count: USAGE_SELECT._count } }),
    client.setting.findFirst({
      where: { key: { in: Object.keys(MEDIA_SETTING_KEYS) }, value: id },
      select: { key: true },
    }),
  ]);
  if (!row) return false;
  if (setting) return true;
  return USAGE_RELATIONS.some((relation) => row._count[relation] > 0);
}

export function totalUsageCount(usages: readonly MediaUsage[]): number {
  return usages.reduce((sum, usage) => sum + usage.count, 0);
}
