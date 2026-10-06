import { z } from "zod";

import {
  CMS_PAGE_STATUSES,
  CMS_PAGE_TEMPLATES,
  cmsPageStatusSchema,
  cmsPageTemplateSchema,
  type CmsPageStatus,
  type CmsPageTemplate,
} from "@/lib/enums";
import { one, type SearchParams } from "@/lib/list-params";
import { optionalTextSchema, optionalUrlSchema, slugSchema, textSchema } from "@/lib/validation";
import type { PickedAsset } from "@/components/shared/media-picker";

/**
 * CMS pages contract (blueprint §4.8 CmsPage, §11.21/23/24, §14.E5/E6).
 * Client-safe: the form validates with the same schema the action does, so a
 * field error appears before the round trip and identically after it.
 */

export const PAGE_SORTS = ["title", "template", "status", "updatedAt", "publishedAt", "createdAt"] as const;
export type PageSort = (typeof PAGE_SORTS)[number];

export const pageIdSchema = z.string().trim().min(1, "Missing page id.");

/** HTML is accepted raw here; the SERVICE sanitises it (§11.21). 2 MB is far beyond any real page. */
export const htmlSchema = z.string().max(2_000_000, "Content is too large.").default("");

export const optionalIdSchema = z.preprocess((value) => (value === "" ? null : value), z.string().trim().min(1).nullable().default(null));

/**
 * `optionalTextSchema` accepts "" and null but not an ABSENT key, which is
 * fine for a form (every control sends its value) and hostile to a REST
 * client that simply omits the SEO fields it does not set. Defaulting to null
 * makes "no excerpt" and "no meta title" expressible the obvious way, in one
 * place, for both CMS modules.
 */
export function optionalText(max: number) {
  return optionalTextSchema(max).default(null);
}

/** ISO datetime or "" → Date | null. The editor sends the datetime-local value already converted to ISO. */
export const optionalDateTimeSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.coerce.date().nullable().default(null),
);

export const pageFormSchema = z.object({
  title: textSchema(200, "Title"),
  slug: slugSchema,
  excerpt: optionalText(500),
  content: htmlSchema,
  template: cmsPageTemplateSchema.default("DEFAULT"),
  status: cmsPageStatusSchema.default("DRAFT"),
  /** Null = "now" when publishing; kept as the historical date on later saves. */
  publishedAt: optionalDateTimeSchema,
  showInFooter: z.boolean().default(false),
  metaTitle: optionalText(160),
  metaDescription: optionalText(320),
  metaKeywords: optionalText(500),
  canonicalUrl: optionalUrlSchema.default(null),
  ogImageMediaId: optionalIdSchema,
  noIndex: z.boolean().default(false),
});

export type PageFormInput = z.input<typeof pageFormSchema>;
export type PageFormValues = z.output<typeof pageFormSchema>;

export const pageStatusInputSchema = z.object({
  status: cmsPageStatusSchema,
  /** Optional explicit publish date; PUBLISHED without one uses now (or keeps the existing date). */
  publishedAt: optionalDateTimeSchema,
});
export type PageStatusInput = z.input<typeof pageStatusInputSchema>;

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

export type PageListFilters = {
  status?: CmsPageStatus;
  template?: CmsPageTemplate;
  /** true = system pages only, false = custom pages only. */
  system?: boolean;
  footer?: boolean;
  authorId?: string;
  q?: string;
};

export function pickEnum<T extends string>(values: readonly T[], raw: string | null | undefined): T | undefined {
  return raw && (values as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

export function parseFlag(raw: string | null | undefined): boolean | undefined {
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return undefined;
}

export function parsePageListFilters(params: SearchParams | URLSearchParams): PageListFilters {
  const get = (key: string) => (params instanceof URLSearchParams ? params.get(key) : one(params, key));
  return {
    status: pickEnum(CMS_PAGE_STATUSES, get("status")),
    template: pickEnum(CMS_PAGE_TEMPLATES, get("template")),
    system: parseFlag(get("system")),
    footer: parseFlag(get("footer")),
    authorId: get("authorId")?.trim() || undefined,
    q: get("q")?.trim() || undefined,
  };
}

export function resolvePageSort(raw: string | undefined): PageSort {
  return pickEnum(PAGE_SORTS, raw) ?? "updatedAt";
}

// ---------------------------------------------------------------------------
// Read shapes
// ---------------------------------------------------------------------------

export type PageListRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  template: CmsPageTemplate;
  status: CmsPageStatus;
  publishedAt: Date | null;
  isSystem: boolean;
  showInFooter: boolean;
  noIndex: boolean;
  authorName: string | null;
  wordCount: number;
  updatedAt: Date;
  createdAt: Date;
};

export type PageEditorData = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  template: CmsPageTemplate;
  status: CmsPageStatus;
  publishedAt: Date | null;
  isSystem: boolean;
  showInFooter: boolean;
  metaTitle: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
  canonicalUrl: string | null;
  ogImage: PickedAsset | null;
  noIndex: boolean;
  author: { id: string; name: string | null; email: string } | null;
  /** How many navigation items / banners point here - shown before delete. */
  usage: { navigationItems: number; banners: number };
  createdAt: Date;
  updatedAt: Date;
};

/** Audit rows for the Activity tab (shared shape with blog). */
export type ContentAuditRow = {
  id: string;
  action: string;
  summary: string;
  actorEmail: string;
  actorName: string | null;
  diff: unknown;
  createdAt: string;
};

/** Active admin users offered as authors (pages + blog). */
export type AuthorOption = { id: string; name: string | null; email: string };

export const PAGE_TABS = ["editor", "preview", "activity"] as const;
export type PageTab = (typeof PAGE_TABS)[number];
export function resolvePageTab(raw: string | undefined): PageTab {
  return pickEnum(PAGE_TABS, raw) ?? "editor";
}

/** `${base}/pages/${slug}` with a trailing-slash-safe base (E6 URL pattern). */
export function storefrontPageUrl(baseUrl: string, slug: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/pages/${slug}`;
}

export { CMS_PAGE_STATUSES, CMS_PAGE_TEMPLATES };
