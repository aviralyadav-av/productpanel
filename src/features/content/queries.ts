import "server-only";

import { db } from "@/lib/db";
import { asArray, asObject } from "@/lib/json";
import { buildPageMeta } from "@/lib/list-params";
import { filenameFromUrl } from "@/lib/media";

/**
 * Read side of the Content module.
 *
 * Everything here is a straight read of ContentSection / ContentBlock /
 * CmsPage / Faq / FooterConfig / MediaAsset / Review. jsonb columns come back
 * from Prisma already parsed, so they are narrowed with the helpers in
 * lib/json rather than JSON.parse'd, and a row whose payload has drifted from
 * its schema still renders instead of throwing.
 *
 * Prisma types are deliberately not re-exported. The tab components are Client
 * Components, and handing them a plain serialisable shape keeps the boundary
 * obvious and the props stable if a column is added.
 */

/** Structurally identical to ListParams from lib/list-params. */
type ListInput = {
  page: number;
  pageSize: number;
  q: string;
  sort: string;
  order: "asc" | "desc";
  skip: number;
};

// ---------------------------------------------------------------------------
// Homepage sections
// ---------------------------------------------------------------------------

export type BlockRow = {
  id: string;
  legacyId: string | null;
  position: number;
  enabled: boolean;
  payload: Record<string, unknown>;
  mediaId: string | null;
  mediaUrl: string | null;
};

export type SectionRow = {
  id: string;
  key: string;
  page: string;
  type: string;
  title: string;
  position: number;
  enabled: boolean;
  payload: Record<string, unknown>;
  blocks: BlockRow[];
  updatedAt: Date;
};

export async function getSections(): Promise<SectionRow[]> {
  const rows = await db.contentSection.findMany({
    orderBy: [{ position: "asc" }, { key: "asc" }],
    include: {
      blocks: {
        orderBy: { position: "asc" },
        include: { media: { select: { url: true } } },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    page: row.page,
    type: row.type,
    title: row.title,
    position: row.position,
    enabled: row.enabled,
    payload: asObject<Record<string, unknown>>(row.payload, {}),
    updatedAt: row.updatedAt,
    blocks: row.blocks.map((block) => ({
      id: block.id,
      legacyId: block.legacyId,
      position: block.position,
      enabled: block.enabled,
      payload: asObject<Record<string, unknown>>(block.payload, {}),
      mediaId: block.mediaId,
      mediaUrl: block.media?.url ?? null,
    })),
  }));
}

// ---------------------------------------------------------------------------
// CMS pages
// ---------------------------------------------------------------------------

export type CmsPageRow = {
  id: string;
  slug: string;
  title: string;
  eyebrow: string;
  intro: string;
  body: Array<{ id?: string; title: string; content: string }>;
  /** Pretty-printed for the read-only panel in the editor. */
  extraJson: string;
  extraKeys: string[];
  status: string;
  metaTitle: string;
  metaDescription: string;
  updatedAt: Date;
};

export async function getCmsPages(): Promise<CmsPageRow[]> {
  const rows = await db.cmsPage.findMany({ orderBy: { slug: "asc" } });

  return rows.map((row) => {
    const extra = asObject<Record<string, unknown>>(row.extra, {});

    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      eyebrow: row.eyebrow ?? "",
      intro: row.intro ?? "",
      body: asArray<Record<string, unknown>>(row.body).map((block) => ({
        id: typeof block.id === "string" ? block.id : undefined,
        title: typeof block.title === "string" ? block.title : "",
        content: typeof block.content === "string" ? block.content : "",
      })),
      extraJson: JSON.stringify(extra, null, 2),
      extraKeys: Object.keys(extra),
      status: row.status,
      metaTitle: row.metaTitle ?? "",
      metaDescription: row.metaDescription ?? "",
      updatedAt: row.updatedAt,
    };
  });
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

export type FaqRow = {
  id: string;
  question: string;
  answer: string;
  group: string;
  position: number;
  enabled: boolean;
  updatedAt: Date;
};

export async function getFaqs(input: { q: string; group?: string }): Promise<{
  rows: FaqRow[];
  groups: Array<{ value: string; label: string; count: number }>;
  total: number;
}> {
  const [rows, grouped, total] = await Promise.all([
    db.faq.findMany({
      where: {
        ...(input.group ? { group: input.group } : {}),
        ...(input.q
          ? {
              OR: [
                { question: { contains: input.q, mode: "insensitive" } },
                { answer: { contains: input.q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    db.faq.groupBy({
      by: ["group"],
      _count: { _all: true },
      orderBy: { group: "asc" },
    }),
    db.faq.count(),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      group: row.group,
      position: row.position,
      enabled: row.enabled,
      updatedAt: row.updatedAt,
    })),
    groups: grouped.map((entry) => ({
      value: entry.group,
      label: entry.group,
      count: entry._count._all,
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

export type FooterRow = {
  id: string;
  brandName: string;
  brandDescription: string;
  copyright: string;
  socialLinks: Array<{ id: string | number; platform: string; url: string }>;
  sections: Array<{
    id: string | number;
    title: string;
    links: Array<{ id: string | number; label: string; path: string }>;
  }>;
  legalLinks: Array<{ id: string | number; label: string; path: string }>;
  customerService: { heading: string; description: string; email: string };
  updatedAt: Date;
};

function toLinkList(
  value: unknown,
): Array<{ id: string | number; label: string; path: string }> {
  return asArray<Record<string, unknown>>(value).map((item, index) => ({
    id:
      typeof item.id === "string" || typeof item.id === "number"
        ? item.id
        : index + 1,
    label: typeof item.label === "string" ? item.label : "",
    path: typeof item.path === "string" ? item.path : "",
  }));
}

export async function getFooter(): Promise<FooterRow | null> {
  const row = await db.footerConfig.findFirst();
  if (!row) return null;

  const service = asObject<Record<string, unknown>>(row.customerService, {});

  return {
    id: row.id,
    brandName: row.brandName,
    brandDescription: row.brandDescription,
    copyright: row.copyright,
    socialLinks: asArray<Record<string, unknown>>(row.socialLinks).map(
      (item, index) => ({
        id:
          typeof item.id === "string" || typeof item.id === "number"
            ? item.id
            : index + 1,
        platform: typeof item.platform === "string" ? item.platform : "",
        url: typeof item.url === "string" ? item.url : "",
      }),
    ),
    sections: asArray<Record<string, unknown>>(row.sections).map(
      (item, index) => ({
        id:
          typeof item.id === "string" || typeof item.id === "number"
            ? item.id
            : index + 1,
        title: typeof item.title === "string" ? item.title : "",
        links: toLinkList(item.links),
      }),
    ),
    legalLinks: toLinkList(row.legalLinks),
    customerService: {
      heading: typeof service.heading === "string" ? service.heading : "",
      description:
        typeof service.description === "string" ? service.description : "",
      email: typeof service.email === "string" ? service.email : "",
    },
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

export type MediaRow = {
  id: string;
  url: string;
  filename: string;
  kind: string;
  folder: string;
  source: string;
  alt: string;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  createdAt: Date;
  productImageCount: number;
  contentBlockCount: number;
  categoryCount: number;
  usageCount: number;
};

export type Facet = { value: string; label: string; count: number };

export async function getMedia(input: {
  list: ListInput;
  kind?: string;
  folder?: string;
}): Promise<{
  rows: MediaRow[];
  meta: ReturnType<typeof buildPageMeta>;
  kinds: Facet[];
  folders: Facet[];
  total: number;
}> {
  const where = {
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.folder ? { folder: input.folder } : {}),
    ...(input.list.q
      ? {
          OR: [
            { filename: { contains: input.list.q, mode: "insensitive" as const } },
            { url: { contains: input.list.q, mode: "insensitive" as const } },
            { alt: { contains: input.list.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, matching, total, kindGroups, folderGroups] = await Promise.all([
    db.mediaAsset.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { filename: "asc" }],
      skip: input.list.skip,
      take: input.list.pageSize,
    }),
    db.mediaAsset.count({ where }),
    db.mediaAsset.count(),
    db.mediaAsset.groupBy({
      by: ["kind"],
      _count: { _all: true },
      orderBy: { kind: "asc" },
    }),
    db.mediaAsset.groupBy({
      by: ["folder"],
      _count: { _all: true },
      orderBy: { folder: "asc" },
    }),
  ]);

  // Usage is counted only for the page being rendered - a reference count for
  // every asset in the library would be three full table scans per page load,
  // and nothing off-screen needs the number.
  const ids = rows.map((row) => row.id);

  const [productRefs, blockRefs, categoryRefs] = await Promise.all([
    db.productImage.groupBy({
      by: ["mediaId"],
      where: { mediaId: { in: ids } },
      _count: { _all: true },
    }),
    db.contentBlock.groupBy({
      by: ["mediaId"],
      where: { mediaId: { in: ids } },
      _count: { _all: true },
    }),
    db.category.groupBy({
      by: ["imageMediaId"],
      where: { imageMediaId: { in: ids } },
      _count: { _all: true },
    }),
  ]);

  const productCount = new Map<string, number>(
    productRefs.map((ref) => [ref.mediaId, ref._count._all] as const),
  );
  const blockCount = new Map<string, number>(
    blockRefs.map((ref) => [ref.mediaId ?? "", ref._count._all] as const),
  );
  const categoryCount = new Map<string, number>(
    categoryRefs.map(
      (ref) => [ref.imageMediaId ?? "", ref._count._all] as const,
    ),
  );

  return {
    rows: rows.map((row) => {
      const productImageCount = productCount.get(row.id) ?? 0;
      const contentBlockCount = blockCount.get(row.id) ?? 0;
      const categoryRefCount = categoryCount.get(row.id) ?? 0;

      return {
        id: row.id,
        url: row.url,
        filename: row.filename || filenameFromUrl(row.url),
        kind: row.kind,
        folder: row.folder,
        source: row.source,
        alt: row.alt ?? "",
        sizeBytes: row.sizeBytes,
        width: row.width,
        height: row.height,
        createdAt: row.createdAt,
        productImageCount,
        contentBlockCount,
        categoryCount: categoryRefCount,
        usageCount:
          productImageCount + contentBlockCount + categoryRefCount,
      };
    }),
    meta: buildPageMeta(matching, input.list),
    kinds: kindGroups.map((entry) => ({
      value: entry.kind,
      label: entry.kind === "video" ? "Video" : "Image",
      count: entry._count._all,
    })),
    folders: folderGroups.map((entry) => ({
      value: entry.folder,
      label: entry.folder,
      count: entry._count._all,
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export type ReviewRow = {
  id: string;
  authorName: string;
  authorLocation: string;
  rating: number | null;
  title: string;
  body: string;
  status: string;
  isFeatured: boolean;
  isTestimonial: boolean;
  position: number;
  createdAt: Date;
  productId: string | null;
  productTitle: string | null;
};

export async function getReviews(input: {
  list: ListInput;
  status?: string;
}): Promise<{
  rows: ReviewRow[];
  meta: ReturnType<typeof buildPageMeta>;
  statusCounts: Record<string, number>;
  total: number;
}> {
  const where = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.list.q
      ? {
          OR: [
            {
              authorName: {
                contains: input.list.q,
                mode: "insensitive" as const,
              },
            },
            { body: { contains: input.list.q, mode: "insensitive" as const } },
            {
              authorLocation: {
                contains: input.list.q,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
  };

  const [rows, matching, total, grouped] = await Promise.all([
    db.review.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { position: "asc" }],
      skip: input.list.skip,
      take: input.list.pageSize,
      include: { product: { select: { id: true, title: true } } },
    }),
    db.review.count({ where }),
    db.review.count(),
    db.review.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const entry of grouped) statusCounts[entry.status] = entry._count._all;

  return {
    rows: rows.map((row) => ({
      id: row.id,
      authorName: row.authorName,
      authorLocation: row.authorLocation ?? "",
      rating: row.rating,
      title: row.title ?? "",
      body: row.body,
      status: row.status,
      isFeatured: row.isFeatured,
      isTestimonial: row.isTestimonial,
      position: row.position,
      createdAt: row.createdAt,
      productId: row.product?.id ?? null,
      productTitle: row.product?.title ?? null,
    })),
    meta: buildPageMeta(matching, input.list),
    statusCounts,
    total,
  };
}

// ---------------------------------------------------------------------------
// Tab counts
// ---------------------------------------------------------------------------

export type ContentCounts = {
  sections: number;
  enabledSections: number;
  pages: number;
  faqs: number;
  media: number;
  reviews: number;
  pendingReviews: number;
};

export async function getContentCounts(): Promise<ContentCounts> {
  const [
    sections,
    enabledSections,
    pages,
    faqs,
    media,
    reviews,
    pendingReviews,
  ] = await Promise.all([
    db.contentSection.count(),
    db.contentSection.count({ where: { enabled: true } }),
    db.cmsPage.count(),
    db.faq.count(),
    db.mediaAsset.count(),
    db.review.count(),
    db.review.count({ where: { status: "PENDING" } }),
  ]);

  return {
    sections,
    enabledSections,
    pages,
    faqs,
    media,
    reviews,
    pendingReviews,
  };
}
