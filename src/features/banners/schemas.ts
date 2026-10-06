import { z } from "zod";

import {
  BANNER_PLACEMENTS,
  LINK_TYPES,
  bannerPlacementSchema,
  linkTypeSchema,
  type BadgeTone,
  type BannerPlacement,
  type LinkType,
} from "@/lib/enums";
import type { SearchParams } from "@/lib/list-params";
import { one } from "@/lib/list-params";
import { hexColorSchema, optionalTextSchema, safeUrlSchema, textSchema } from "@/lib/validation";
import type { EntityRef } from "@/components/shared/entity-picker";
import type { PickedAsset } from "@/components/shared/media-picker";

import { DATE_INPUT_PATTERN, istEndOfDay, istStartOfDay } from "@/features/coupons/dates";

import { placementInfo } from "./placements";

/**
 * Banners contract (blueprint §4.7, §11.26, §14.E1, F8). A banner is creative
 * for one placement with an optional schedule and a typed link target; the
 * public `/api/v1/banners` filters by window at read time and the
 * `content.expire` job invalidates the cache at each boundary.
 */

export const BANNER_STATUSES = ["ACTIVE", "SCHEDULED", "EXPIRED", "DISABLED"] as const;
export type BannerStatus = (typeof BANNER_STATUSES)[number];

export const BANNER_STATUS_META: Record<BannerStatus, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: "Live", tone: "success" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  EXPIRED: { label: "Ended", tone: "neutral" },
  DISABLED: { label: "Hidden", tone: "neutral" },
};

export function deriveBannerStatus(row: { isActive: boolean; startsAt: Date | null; endsAt: Date | null }, now: Date = new Date()): BannerStatus {
  if (!row.isActive) return "DISABLED";
  if (row.startsAt && row.startsAt > now) return "SCHEDULED";
  if (row.endsAt && row.endsAt < now) return "EXPIRED";
  return "ACTIVE";
}

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

export type BannerListFilters = { placement?: BannerPlacement; status?: BannerStatus; q?: string };

function pick<T extends string>(values: readonly T[], raw: string | null | undefined): T | undefined {
  return raw && (values as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

export function parseBannerListFilters(params: SearchParams | URLSearchParams): BannerListFilters {
  const get = (key: string) => (params instanceof URLSearchParams ? params.get(key) : one(params, key));
  return {
    placement: pick(BANNER_PLACEMENTS, get("placement")),
    status: pick(BANNER_STATUSES, get("status")),
    q: get("q")?.trim() || undefined,
  };
}

// ---------------------------------------------------------------------------
// Form input
// ---------------------------------------------------------------------------

const optionalDate = (edge: "start" | "end") =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z
      .string()
      .regex(DATE_INPUT_PATTERN, "Enter a date.")
      .nullable()
      .transform((value) => (value ? (edge === "start" ? istStartOfDay(value) : istEndOfDay(value)) : null)),
  );

const optionalId = z.preprocess((value) => (value === "" ? null : value), z.string().trim().min(1).nullable().default(null));
const optionalColor = z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), hexColorSchema.nullable().default(null));

export const bannerFormSchema = z
  .object({
    title: textSchema(120, "Title"),
    subtitle: optionalTextSchema(240),
    placement: bannerPlacementSchema,
    mediaId: optionalId,
    mobileMediaId: optionalId,
    altText: optionalTextSchema(200),
    linkType: linkTypeSchema.default("NONE"),
    linkUrl: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), safeUrlSchema.nullable().default(null)),
    categoryId: optionalId,
    productId: optionalId,
    pageId: optionalId,
    /** BLOG links have no FK on Banner: the service resolves this to the post slug in linkUrl. */
    blogPostId: optionalId,
    buttonText: optionalTextSchema(40),
    textColor: optionalColor,
    bgColor: optionalColor,
    position: z.number().int().min(0).max(10_000).nullable().default(null),
    isActive: z.boolean().default(true),
    startsAt: optionalDate("start"),
    endsAt: optionalDate("end"),
  })
  .superRefine((value, ctx) => {
    if (!value.mediaId && !placementInfo(value.placement).imageOptional) {
      ctx.addIssue({ code: "custom", path: ["mediaId"], message: "This placement needs a desktop image." });
    }
    if (value.linkType === "URL" && !value.linkUrl) ctx.addIssue({ code: "custom", path: ["linkUrl"], message: "Enter the URL to link to." });
    if (value.linkType === "CATEGORY" && !value.categoryId) ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Choose a category." });
    if (value.linkType === "PRODUCT" && !value.productId) ctx.addIssue({ code: "custom", path: ["productId"], message: "Choose a product." });
    if (value.linkType === "PAGE" && !value.pageId) ctx.addIssue({ code: "custom", path: ["pageId"], message: "Choose a page." });
    if (value.linkType === "BLOG" && !value.blogPostId && !value.linkUrl) {
      ctx.addIssue({ code: "custom", path: ["blogPostId"], message: "Choose a blog post." });
    }
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The banner must end after it starts." });
    }
  })
  .transform((value) => ({
    ...value,
    // Only the target matching the link type survives, so switching types leaves no ghost FK behind.
    linkUrl: value.linkType === "URL" || value.linkType === "BLOG" ? value.linkUrl : null,
    categoryId: value.linkType === "CATEGORY" ? value.categoryId : null,
    productId: value.linkType === "PRODUCT" ? value.productId : null,
    pageId: value.linkType === "PAGE" ? value.pageId : null,
    blogPostId: value.linkType === "BLOG" ? value.blogPostId : null,
  }));

export type BannerFormInput = z.input<typeof bannerFormSchema>;
export type BannerFormValues = z.output<typeof bannerFormSchema>;

export const bannerIdSchema = z.string().trim().min(1, "Missing banner id.");

export const bannerReorderSchema = z.object({
  placement: bannerPlacementSchema,
  ids: z.array(bannerIdSchema).min(1).max(500),
});
export type BannerReorderInput = z.input<typeof bannerReorderSchema>;

// ---------------------------------------------------------------------------
// Read shapes
// ---------------------------------------------------------------------------

export type BannerMedia = { id: string; url: string; thumbnailUrl: string | null; width: number | null; height: number | null } | null;

export type BannerCardRow = {
  id: string;
  title: string;
  subtitle: string | null;
  placement: BannerPlacement;
  media: BannerMedia;
  mobileMedia: BannerMedia;
  altText: string | null;
  linkType: LinkType;
  /** "Category: Jewellery", "/sale", "Product: Terracotta Diya" - resolved server-side. */
  linkLabel: string | null;
  /** False when the link points at something unpublished/deleted (§11.25). */
  linkResolves: boolean;
  buttonText: string | null;
  textColor: string | null;
  bgColor: string | null;
  position: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  clickCount: number;
  impressionCount: number;
  status: BannerStatus;
  updatedAt: Date;
};

export type BannerGroup = {
  placement: BannerPlacement;
  label: string;
  description: string;
  rows: BannerCardRow[];
  liveCount: number;
};

export type BannerEditorData = {
  id: string;
  title: string;
  subtitle: string | null;
  placement: BannerPlacement;
  media: PickedAsset | null;
  mobileMedia: PickedAsset | null;
  altText: string | null;
  linkType: LinkType;
  linkUrl: string | null;
  category: EntityRef | null;
  product: EntityRef | null;
  page: EntityRef | null;
  blogPost: EntityRef | null;
  buttonText: string | null;
  textColor: string | null;
  bgColor: string | null;
  position: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  clickCount: number;
  impressionCount: number;
  status: BannerStatus;
  createdAt: Date;
  updatedAt: Date;
};

export { BANNER_PLACEMENTS, LINK_TYPES };
