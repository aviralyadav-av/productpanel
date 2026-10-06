import { z } from "zod";

import { BLOG_STATUSES, blogStatusSchema, type BlogStatus } from "@/lib/enums";
import { one, type SearchParams } from "@/lib/list-params";
import { optionalUrlSchema, slugSchema, textSchema } from "@/lib/validation";
import type { EntityRef } from "@/components/shared/entity-picker";
import type { PickedAsset } from "@/components/shared/media-picker";

import { htmlSchema, optionalDateTimeSchema, optionalIdSchema, optionalText, parseFlag, pickEnum } from "@/features/pages/schemas";
import { normalizeTags } from "@/features/pages/text";

/**
 * Blog contract (blueprint §4.8 BlogPost / BlogCategory, §11.21/23, E6).
 * SCHEDULED means "PUBLISHED from `publishedAt` onwards": the public API
 * treats a SCHEDULED post whose publishedAt has passed as live, so no job is
 * needed to flip the row. The form enforces that a SCHEDULED post carries a
 * FUTURE date; a PUBLISHED post with a future date is coerced to SCHEDULED.
 */

export const BLOG_SORTS = ["title", "status", "publishedAt", "updatedAt", "createdAt", "viewCount"] as const;
export type BlogSort = (typeof BLOG_SORTS)[number];

export const blogPostIdSchema = z.string().trim().min(1, "Missing post id.");
export const blogCategoryIdSchema = z.string().trim().min(1, "Missing category id.");

const idList = z.array(z.string().trim().min(1)).max(50).default([]);

export const blogPostFormSchema = z
  .object({
    title: textSchema(200, "Title"),
    slug: slugSchema,
    excerpt: optionalText(500),
    content: htmlSchema,
    featuredImageMediaId: optionalIdSchema,
    categoryId: optionalIdSchema,
    tags: z.array(z.string().trim().max(40)).max(20).default([]).transform((tags) => normalizeTags(tags)),
    /** Null = the acting admin; the service snapshots the display name into authorName. */
    authorId: optionalIdSchema,
    status: blogStatusSchema.default("DRAFT"),
    publishedAt: optionalDateTimeSchema,
    isFeatured: z.boolean().default(false),
    metaTitle: optionalText(160),
    metaDescription: optionalText(320),
    metaKeywords: optionalText(500),
    canonicalUrl: optionalUrlSchema.default(null),
    relatedProductIds: idList,
    relatedCategoryIds: idList,
  })
  .superRefine((value, ctx) => {
    if (value.status === "SCHEDULED") {
      if (!value.publishedAt) ctx.addIssue({ code: "custom", path: ["publishedAt"], message: "Choose when the post should go live." });
      else if (value.publishedAt.getTime() <= Date.now()) ctx.addIssue({ code: "custom", path: ["publishedAt"], message: "A scheduled post needs a date in the future. Use Published for a date in the past." });
    }
  });

export type BlogPostFormInput = z.input<typeof blogPostFormSchema>;
export type BlogPostFormValues = z.output<typeof blogPostFormSchema>;

export const blogStatusInputSchema = z.object({ status: blogStatusSchema, publishedAt: optionalDateTimeSchema });
export type BlogStatusInput = z.input<typeof blogStatusInputSchema>;

export const blogCategoryFormSchema = z.object({
  name: textSchema(80, "Name"),
  slug: slugSchema.optional(),
  description: optionalText(300),
  isActive: z.boolean().default(true),
});
export type BlogCategoryFormInput = z.input<typeof blogCategoryFormSchema>;
export type BlogCategoryFormValues = z.output<typeof blogCategoryFormSchema>;

export const blogCategoryReorderSchema = z.object({ ids: z.array(blogCategoryIdSchema).min(1).max(500) });
export type BlogCategoryReorderInput = z.input<typeof blogCategoryReorderSchema>;

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

export type BlogListFilters = {
  status?: BlogStatus;
  categoryId?: string;
  tag?: string;
  featured?: boolean;
  authorId?: string;
  q?: string;
};

export function parseBlogListFilters(params: SearchParams | URLSearchParams): BlogListFilters {
  const get = (key: string) => (params instanceof URLSearchParams ? params.get(key) : one(params, key));
  return {
    status: pickEnum(BLOG_STATUSES, get("status")),
    categoryId: get("categoryId")?.trim() || undefined,
    tag: get("tag")?.trim().toLowerCase() || undefined,
    featured: parseFlag(get("featured")),
    authorId: get("authorId")?.trim() || undefined,
    q: get("q")?.trim() || undefined,
  };
}

export function resolveBlogSort(raw: string | undefined): BlogSort {
  return pickEnum(BLOG_SORTS, raw) ?? "updatedAt";
}

export const BLOG_TABS = ["editor", "preview", "activity"] as const;
export type BlogTab = (typeof BLOG_TABS)[number];
export function resolveBlogTab(raw: string | undefined): BlogTab {
  return pickEnum(BLOG_TABS, raw) ?? "editor";
}

/** `${base}/blog/${slug}` (E6 URL pattern). */
export function storefrontBlogUrl(baseUrl: string, slug: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/blog/${slug}`;
}

/**
 * What the storefront shows right now for a status + date pair: a SCHEDULED
 * post whose time has come is live (the public API applies the same rule).
 */
export function effectiveBlogStatus(row: { status: string; publishedAt: Date | string | null }, now: Date = new Date()): BlogStatus {
  const status = row.status as BlogStatus;
  if (status === "SCHEDULED" && row.publishedAt && new Date(row.publishedAt).getTime() <= now.getTime()) return "PUBLISHED";
  if (status === "PUBLISHED" && row.publishedAt && new Date(row.publishedAt).getTime() > now.getTime()) return "SCHEDULED";
  return status;
}

// ---------------------------------------------------------------------------
// Read shapes
// ---------------------------------------------------------------------------

export type BlogPostListRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  status: BlogStatus;
  effectiveStatus: BlogStatus;
  publishedAt: Date | null;
  isFeatured: boolean;
  category: { id: string; name: string } | null;
  tags: string[];
  authorName: string | null;
  readingMinutes: number | null;
  viewCount: number;
  featuredImage: { url: string; thumbnailUrl: string | null; alt: string | null } | null;
  updatedAt: Date;
  createdAt: Date;
};

export type BlogPostEditorData = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  featuredImage: PickedAsset | null;
  categoryId: string | null;
  tags: string[];
  authorId: string | null;
  authorName: string | null;
  status: BlogStatus;
  publishedAt: Date | null;
  readingMinutes: number | null;
  viewCount: number;
  isFeatured: boolean;
  metaTitle: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
  canonicalUrl: string | null;
  relatedProducts: EntityRef[];
  relatedCategories: EntityRef[];
  createdAt: Date;
  updatedAt: Date;
};

export type BlogCategoryRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  position: number;
  isActive: boolean;
  postCount: number;
  publishedCount: number;
  updatedAt: Date;
};

export { BLOG_STATUSES };
