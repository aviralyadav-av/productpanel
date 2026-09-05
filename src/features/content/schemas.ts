import { z } from "zod";

import { CMS_PAGE_STATUSES, reviewStatusSchema } from "@/lib/enums";

/**
 * Input schemas for every content Server Action.
 *
 * Section and block PAYLOADS are not validated here - they are validated by the
 * per-type schema in registry.ts, which is the only place that knows what a
 * "hero slide" is. These schemas validate the envelope: which row, which order,
 * which flag.
 */

export const idSchema = z.string().min(1, "Missing id.");
export const idListSchema = z
  .array(idSchema)
  .min(1, "Nothing selected.")
  .max(200, "Too many rows at once.");

/** A free-form jsonb payload, checked properly by the registry schema next. */
const rawPayloadSchema = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------------------
// Link validation
//
// A footer or button link is one of three things: an internal path, an absolute
// http(s) URL, or a mailto: address. Anything else is a typo that would render
// as a dead link on the storefront.
//
// "#" is allowed as well, and only as an exact match: three of the four seeded
// social links are literally "#" because the store has no social accounts
// wired up yet. Rejecting it would make the footer form unable to save the data
// it was handed.
// ---------------------------------------------------------------------------

const INTERNAL_PATH = /^\/(?!\/)[^\s]*$/;
const ABSOLUTE_URL = /^https?:\/\/[^\s]+$/i;
const MAILTO = /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const TEL = /^tel:\+?[\d\s-]{6,20}$/i;

export function isValidLink(value: string): boolean {
  return (
    INTERNAL_PATH.test(value) ||
    ABSOLUTE_URL.test(value) ||
    MAILTO.test(value) ||
    TEL.test(value)
  );
}

const LINK_MESSAGE =
  "Use an internal path like /shop, a full https:// URL, or mailto:someone@example.com.";

export const linkPathSchema = z
  .string()
  .trim()
  .min(1, "A link is required.")
  .max(500)
  .refine(isValidLink, LINK_MESSAGE);

/** Same rule, plus the "#" placeholder the seeded social links use. */
export const socialUrlSchema = z
  .string()
  .trim()
  .min(1, "A link is required.")
  .max(500)
  .refine(
    (value) => value === "#" || isValidLink(value),
    `${LINK_MESSAGE} Use # for a social account that does not exist yet.`,
  );

/**
 * Ids inside jsonb arrays. The seeded footer stores them as numbers (1, 2, 3)
 * and the storefront only uses them as React keys, so both are accepted and
 * neither is rewritten - churning them would produce a pointless diff against
 * the file the storefront still reads.
 */
const jsonIdSchema = z.union([z.string().trim().min(1).max(64), z.number()]);

// ---------------------------------------------------------------------------
// Homepage sections and blocks
// ---------------------------------------------------------------------------

export const toggleSectionSchema = z.object({
  id: idSchema,
  enabled: z.boolean(),
});

export const reorderSectionsSchema = z.object({ ids: idListSchema });

export const updateSectionPayloadSchema = z.object({
  id: idSchema,
  values: rawPayloadSchema,
});

export const createBlockSchema = z.object({
  sectionId: idSchema,
  payload: rawPayloadSchema,
});

export const updateBlockSchema = z.object({
  id: idSchema,
  payload: rawPayloadSchema,
});

export const deleteBlockSchema = z.object({ id: idSchema });

export const reorderBlocksSchema = z.object({
  sectionId: idSchema,
  ids: idListSchema,
});

export const toggleBlockSchema = z.object({
  id: idSchema,
  enabled: z.boolean(),
});

// ---------------------------------------------------------------------------
// CMS pages
// ---------------------------------------------------------------------------

export const cmsBodyBlockSchema = z.object({
  id: z.string().trim().max(120).optional(),
  title: z.string().trim().min(1, "Give the block a heading.").max(200),
  content: z.string().trim().min(1, "Give the block some copy.").max(8000),
});

export type CmsBodyBlock = z.infer<typeof cmsBodyBlockSchema>;

export const updateCmsPageSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1, "A page needs a title.").max(200),
  eyebrow: z.string().trim().max(120),
  intro: z.string().trim().max(2000),
  body: z.array(cmsBodyBlockSchema).max(40, "That is too many blocks."),
  metaTitle: z.string().trim().max(200),
  metaDescription: z.string().trim().max(400),
});

export const setCmsPageStatusSchema = z.object({
  id: idSchema,
  status: z.enum(CMS_PAGE_STATUSES),
});

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

const faqFieldsSchema = z.object({
  question: z.string().trim().min(1, "Enter the question.").max(300),
  answer: z.string().trim().min(1, "Enter the answer.").max(4000),
  group: z.string().trim().min(1).max(60).default("General"),
});

export const createFaqSchema = faqFieldsSchema;
export const updateFaqSchema = faqFieldsSchema.extend({ id: idSchema });
export const deleteFaqSchema = z.object({ id: idSchema });
export const reorderFaqsSchema = z.object({ ids: idListSchema });
export const toggleFaqSchema = z.object({ id: idSchema, enabled: z.boolean() });

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

export const footerLinkSchema = z.object({
  id: jsonIdSchema,
  label: z.string().trim().min(1, "Enter a label.").max(80),
  path: linkPathSchema,
});

export const footerSectionSchema = z.object({
  id: jsonIdSchema,
  title: z.string().trim().min(1, "Enter a column heading.").max(80),
  links: z.array(footerLinkSchema).max(12, "12 links is the limit."),
});

export const socialLinkSchema = z.object({
  id: jsonIdSchema,
  platform: z.string().trim().min(1, "Name the platform.").max(40),
  url: socialUrlSchema,
});

export const customerServiceSchema = z.object({
  heading: z.string().trim().max(120),
  description: z.string().trim().max(300),
  email: z
    .string()
    .trim()
    .max(200)
    .refine(
      (value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      "Enter a valid email address.",
    ),
});

export const updateFooterConfigSchema = z.object({
  brandName: z.string().trim().min(1, "The brand name is required.").max(80),
  brandDescription: z.string().trim().max(600),
  copyright: z.string().trim().max(200),
  socialLinks: z.array(socialLinkSchema).max(10),
  sections: z.array(footerSectionSchema).max(6),
  legalLinks: z.array(footerLinkSchema).max(10),
  customerService: customerServiceSchema,
});

export type FooterFormValues = z.infer<typeof updateFooterConfigSchema>;
export type FooterLinkValue = z.infer<typeof footerLinkSchema>;
export type FooterSectionValue = z.infer<typeof footerSectionSchema>;
export type SocialLinkValue = z.infer<typeof socialLinkSchema>;

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export const MEDIA_KINDS = ["image", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const addMediaByUrlSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Paste a URL or a storefront path.")
    .max(2000)
    .refine(
      (value) => INTERNAL_PATH.test(value) || ABSOLUTE_URL.test(value),
      "Use a full https:// URL or a storefront path starting with /.",
    ),
  alt: z.string().trim().max(300).default(""),
  folder: z.string().trim().min(1).max(80).default("uncategorised"),
  kind: z.enum(MEDIA_KINDS).optional(),
});

export const updateMediaAltSchema = z.object({
  id: idSchema,
  alt: z.string().trim().max(300),
});

export const deleteMediaSchema = z.object({ id: idSchema });

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export const setReviewStatusSchema = z.object({
  ids: idListSchema,
  status: reviewStatusSchema,
});

export const toggleReviewFeaturedSchema = z.object({
  id: idSchema,
  isFeatured: z.boolean(),
});

export const createTestimonialSchema = z.object({
  authorName: z.string().trim().min(1, "Who said it?").max(120),
  authorLocation: z.string().trim().max(120).default(""),
  body: z.string().trim().min(1, "Enter the quote.").max(2000),
  // Nullable rather than defaulted: the three seeded testimonials have no
  // rating at all, and CustomerReviews.jsx renders `rating || 5`.
  rating: z.number().int().min(1).max(5).nullable().default(null),
  isFeatured: z.boolean().default(true),
});

export const deleteReviewSchema = z.object({ id: idSchema });
