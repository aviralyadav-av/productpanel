import { z } from "zod";

import { REVIEW_STATUSES, reviewStatusSchema, type ReviewStatus } from "@/lib/enums";
import { one, type SearchParams } from "@/lib/list-params";
import { emailSchema, optionalTextSchema, textSchema } from "@/lib/validation";
import type { ColumnDef } from "@/components/shared/column-visibility";

/**
 * Client-safe contracts for the reviews module (blueprint §1 Reviews, §14.D9,
 * D12). Shared by the Server Actions, the REST handlers and the public intake
 * route so every write path validates identically.
 */

export const looseIdSchema = z.string().trim().min(1, "Missing id.").max(64);

// ---------------------------------------------------------------------------
// List state (URL)
// ---------------------------------------------------------------------------

export const REVIEW_SORTS = ["createdAt", "rating", "product", "author", "status"] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

export function parseReviewSort(value: string | undefined): ReviewSort {
  return (REVIEW_SORTS as readonly string[]).includes(value ?? "") ? (value as ReviewSort) : "createdAt";
}

export const REVIEW_TABS = ["reviews", "testimonials"] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];

export function parseReviewTab(value: string | undefined): ReviewTab {
  return value === "testimonials" ? "testimonials" : "reviews";
}

export type ReviewListFilters = {
  q: string;
  status?: ReviewStatus;
  rating?: number;
  productId?: string;
  sellerId?: string;
  customerId?: string;
  verified?: boolean;
  hasImages?: boolean;
  featured?: boolean;
  from?: Date;
  to?: Date;
};

function parseBool(value: string | undefined): boolean | undefined {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return undefined;
}

/** `from`/`to` are IST calendar days (the DateRangePicker writes yyyy-mm-dd). */
export function parseIstDayParam(value: string | undefined, end: boolean): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseReviewFilters(params: SearchParams): ReviewListFilters {
  const status = one(params, "status");
  const rating = Number(one(params, "rating"));
  return {
    q: (one(params, "q") ?? "").trim(),
    status: (REVIEW_STATUSES as readonly string[]).includes(status ?? "") ? (status as ReviewStatus) : undefined,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : undefined,
    productId: one(params, "product"),
    sellerId: one(params, "seller"),
    customerId: one(params, "customer"),
    verified: parseBool(one(params, "verified")),
    hasImages: parseBool(one(params, "images")),
    featured: parseBool(one(params, "featured")),
    from: parseIstDayParam(one(params, "from"), false),
    to: parseIstDayParam(one(params, "to"), true),
  };
}

export function hasReviewFilters(filters: ReviewListFilters): boolean {
  return Boolean(
    filters.q ||
      filters.status ||
      filters.rating ||
      filters.productId ||
      filters.sellerId ||
      filters.customerId ||
      filters.verified !== undefined ||
      filters.hasImages !== undefined ||
      filters.featured !== undefined ||
      filters.from ||
      filters.to,
  );
}

export const REVIEW_COLUMNS: readonly ColumnDef[] = [
  { key: "product", label: "Product", locked: true },
  { key: "author", label: "Author" },
  { key: "rating", label: "Rating" },
  { key: "content", label: "Review", locked: true },
  { key: "images", label: "Images" },
  { key: "flags", label: "Verified / featured" },
  { key: "status", label: "Status", locked: true },
  { key: "replied", label: "Replied" },
  { key: "date", label: "Date" },
];

// ---------------------------------------------------------------------------
// Admin mutations
// ---------------------------------------------------------------------------

export const ratingSchema = z.coerce.number().int().min(1).max(5);

export const setReviewStatusSchema = z.object({ id: looseIdSchema, status: reviewStatusSchema });
export type SetReviewStatusInput = z.input<typeof setReviewStatusSchema>;

export const setReviewFeaturedSchema = z.object({ id: looseIdSchema, isFeatured: z.boolean() });
export type SetReviewFeaturedInput = z.input<typeof setReviewFeaturedSchema>;

/** `null` clears an existing reply. */
export const replyReviewSchema = z.object({
  id: looseIdSchema,
  reply: z.union([
    z.string().trim().min(1, "Write a reply first.").max(4000, "Keep the reply under 4,000 characters."),
    z.null(),
  ]),
});
export type ReplyReviewInput = z.input<typeof replyReviewSchema>;

export const reviewPatchSchema = z.object({
  authorName: textSchema(80, "Author name").optional(),
  authorLocation: optionalTextSchema(80).optional(),
  rating: ratingSchema.nullable().optional(),
  title: optionalTextSchema(160).optional(),
  body: textSchema(4000, "Review text").optional(),
  isFeatured: z.boolean().optional(),
  isTestimonial: z.boolean().optional(),
  position: z.coerce.number().int().min(0).max(100000).optional(),
  status: reviewStatusSchema.optional(),
});
export type ReviewPatchInput = z.input<typeof reviewPatchSchema>;
export type ReviewPatchValues = z.output<typeof reviewPatchSchema>;

export const updateReviewSchema = z.object({ id: looseIdSchema, patch: reviewPatchSchema });
export type UpdateReviewInput = z.input<typeof updateReviewSchema>;

export const REVIEW_BULK_OPS = ["approve", "reject", "delete"] as const;
export type ReviewBulkOp = (typeof REVIEW_BULK_OPS)[number];
export const REVIEW_BULK_MAX = 500;

export const bulkReviewSchema = z.object({
  ids: z.array(looseIdSchema).min(1, "Select at least one review.").max(REVIEW_BULK_MAX),
  op: z.enum(REVIEW_BULK_OPS),
  reason: optionalTextSchema(500).optional(),
});
export type BulkReviewInput = z.input<typeof bulkReviewSchema>;

export const REVIEW_BULK_PERMISSION: Record<ReviewBulkOp, string> = {
  approve: "reviews.moderate",
  reject: "reviews.moderate",
  delete: "reviews.delete",
};

export const testimonialSchema = z.object({
  authorName: textSchema(80, "Author name"),
  // `.optional().default(null)` (not a bare optionalTextSchema) so a REST client may OMIT the key, not just send "".
  authorLocation: optionalTextSchema(80).optional().default(null),
  body: textSchema(2000, "Testimonial"),
  rating: ratingSchema.nullable().optional(),
  position: z.coerce.number().int().min(0).max(100000).default(0),
  isFeatured: z.boolean().default(false),
  status: reviewStatusSchema.default("APPROVED"),
});
export type TestimonialInput = z.input<typeof testimonialSchema>;
export type TestimonialValues = z.output<typeof testimonialSchema>;

// ---------------------------------------------------------------------------
// Public intake (POST /api/v1/products/:slug/reviews)
// ---------------------------------------------------------------------------

export const PUBLIC_REVIEW_MAX_IMAGES = 5;

export const publicReviewSchema = z.object({
  authorName: textSchema(80, "Your name"),
  email: emailSchema.optional(),
  rating: ratingSchema,
  title: optionalTextSchema(160).optional(),
  body: z
    .string()
    .trim()
    .min(10, "Please write at least 10 characters.")
    .max(4000, "Keep the review under 4,000 characters."),
  images: z
    .array(z.string().trim().min(1).max(200))
    .max(PUBLIC_REVIEW_MAX_IMAGES, `At most ${PUBLIC_REVIEW_MAX_IMAGES} photos.`)
    .optional(),
  orderNumber: z.string().trim().max(32).optional(),
  token: z.string().trim().max(200).optional(),
  /** Honeypot: real forms leave it empty. */
  website: z.string().max(200).optional(),
});
export type PublicReviewInput = z.input<typeof publicReviewSchema>;
export type PublicReviewValues = z.output<typeof publicReviewSchema>;

export const REVIEW_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const REVIEW_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
