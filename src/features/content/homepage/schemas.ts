import { z } from "zod";

import { LINK_TYPES, contentSectionTypeSchema, type LinkType } from "@/lib/enums";
import { isSafeUrl } from "@/lib/validation";
import type { EntityRef } from "@/components/shared/entity-picker";
import type { PickedAsset } from "@/components/shared/media-picker";
import type { ScheduleState } from "@/features/content/registry";

/**
 * Client-safe zod schemas + shared row types for /admin/homepage (blueprint
 * §4.8, §11.26, §14.E1).
 *
 * Only the COMMON section columns are validated here. The type-specific
 * `payload` is validated in the service against the registry's own
 * `sectionSchema` / `blockSchema`, because which schema applies depends on the
 * row's `type` - something a static zod object cannot know.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Ids are cuids in production but `demo_*` strings in the seed, so no format check. */
export const contentIdSchema = z.string().trim().min(1, "Missing id.").max(64);

const nullableId = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => (typeof value === "string" && value.trim() ? value.trim() : null));

const optionalText = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => (typeof value === "string" ? value.trim() : ""))
    .pipe(z.string().max(max))
    .transform((value) => (value === "" ? null : value));

/**
 * Publish-window instants arrive as ISO strings from the form (the browser
 * converts its `datetime-local` value to UTC before sending) or as Dates from
 * server callers. Empty means "no boundary".
 */
export const dateTimeSchema = z
  .union([z.string(), z.date(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date and time." });
      return z.NEVER;
    }
    return date;
  });

export const ENTITY_LINK_TYPES: readonly LinkType[] = ["CATEGORY", "PRODUCT", "PAGE", "BLOG"];

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export const sectionCommonSchema = z
  .object({
    title: z.string().trim().min(1, "Give the section a title.").max(160),
    subtitle: optionalText(300),
    enabled: z.boolean().default(true),
    publishAt: dateTimeSchema,
    unpublishAt: dateTimeSchema,
    imageMediaId: nullableId,
    linkType: z.enum(LINK_TYPES).default("NONE"),
    linkUrl: optionalText(2000),
    linkTargetId: nullableId,
    buttonText: optionalText(60),
  })
  .superRefine((value, ctx) => {
    if (value.publishAt && value.unpublishAt && value.unpublishAt <= value.publishAt) {
      ctx.addIssue({ code: "custom", path: ["unpublishAt"], message: "Unpublish must be after publish." });
    }
    if (value.linkType === "URL") {
      if (!value.linkUrl) ctx.addIssue({ code: "custom", path: ["linkUrl"], message: "Enter the URL to link to." });
      else if (!isSafeUrl(value.linkUrl)) {
        ctx.addIssue({ code: "custom", path: ["linkUrl"], message: "Only http(s) or site-relative URLs are allowed." });
      }
    }
    if (ENTITY_LINK_TYPES.includes(value.linkType) && !value.linkTargetId) {
      ctx.addIssue({ code: "custom", path: ["linkTargetId"], message: "Choose what the section links to." });
    }
  });

/** The type-specific settings; validated per type in the service. */
export const payloadSchema = z.record(z.string(), z.unknown()).default({});

export const sectionUpdateSchema = z.object({
  common: sectionCommonSchema,
  payload: payloadSchema,
});
export type SectionUpdateInput = z.input<typeof sectionUpdateSchema>;
export type SectionUpdateValues = z.output<typeof sectionUpdateSchema>;

export const sectionCreateSchema = z.object({
  type: contentSectionTypeSchema,
  /** Optional; the registry label is used when blank. */
  title: z.string().trim().max(160).optional(),
});
export type SectionCreateInput = z.input<typeof sectionCreateSchema>;

export const sectionEnabledSchema = z.object({ id: contentIdSchema, enabled: z.boolean() });

export const sectionReorderSchema = z.object({
  ids: z.array(contentIdSchema).min(1).max(200),
});
export type SectionReorderInput = z.input<typeof sectionReorderSchema>;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export const blockInputSchema = z.object({
  payload: payloadSchema,
  enabled: z.boolean().default(true),
  publishAt: dateTimeSchema,
  unpublishAt: dateTimeSchema,
  mediaId: nullableId,
});
export type BlockInput = z.input<typeof blockInputSchema>;
export type BlockValues = z.output<typeof blockInputSchema>;

export const blockReorderSchema = z.object({ ids: z.array(contentIdSchema).min(1).max(100) });

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => value === "" || /^https?:\/\//i.test(value), "Enter a full http(s) URL.");

const sitePathOrUrl = z
  .string()
  .trim()
  .min(1, "Enter a path or URL.")
  .max(2000)
  .refine(
    (value) => value.startsWith("/") || /^https?:\/\//i.test(value),
    "Use a site path like /pages/privacy-policy or a full URL.",
  );

/**
 * Payment icon keys the storefront knows how to draw. The website maps these
 * to its own artwork; the admin only needs a stable vocabulary to pick from.
 */
export const PAYMENT_ICON_OPTIONS = [
  { value: "visa", label: "Visa" },
  { value: "mastercard", label: "Mastercard" },
  { value: "rupay", label: "RuPay" },
  { value: "amex", label: "American Express" },
  { value: "upi", label: "UPI" },
  { value: "netbanking", label: "Net banking" },
  { value: "wallet", label: "Wallets" },
  { value: "cod", label: "Cash on delivery" },
] as const;

export const SOCIAL_PLATFORM_OPTIONS = [
  "facebook",
  "instagram",
  "youtube",
  "twitter",
  "pinterest",
  "whatsapp",
  "linkedin",
  "threads",
] as const;

export const footerFormSchema = z.object({
  brandName: z.string().trim().min(1, "Enter the brand name.").max(120),
  brandDescription: z.string().trim().max(600),
  copyright: z.string().trim().max(200),
  socialLinks: z
    .array(
      z.object({
        platform: z.string().trim().min(1, "Choose a platform.").max(40),
        url: z
          .string()
          .trim()
          .min(1, "Enter the profile URL.")
          .max(2000)
          .refine((value) => /^https?:\/\//i.test(value), "Enter a full http(s) URL."),
      }),
    )
    .max(12, "12 social links is the limit."),
  customerService: z.object({
    heading: z.string().trim().max(120),
    description: z.string().trim().max(300),
    email: z.union([z.literal(""), z.email("Enter a valid email address.")]),
  }),
  legalLinks: z
    .array(z.object({ label: z.string().trim().min(1, "Enter a label.").max(60), path: sitePathOrUrl }))
    .max(10, "10 legal links is the limit."),
  paymentIcons: z.array(z.string().trim().min(1).max(40)).max(12),
  appLinks: z.object({ playStore: httpUrl, appStore: httpUrl }),
});
export type FooterFormInput = z.input<typeof footerFormSchema>;
export type FooterFormValues = z.output<typeof footerFormSchema>;

// ---------------------------------------------------------------------------
// Tabs (URL state)
// ---------------------------------------------------------------------------

export const HOMEPAGE_TABS = ["sections", "footer"] as const;
export type HomepageTab = (typeof HOMEPAGE_TABS)[number];

export function resolveHomepageTab(raw: string | undefined): HomepageTab {
  return raw === "footer" ? "footer" : "sections";
}

// ---------------------------------------------------------------------------
// Read-model row types (produced by queries.ts, consumed by components)
// ---------------------------------------------------------------------------

export type SectionBoardRow = {
  id: string;
  key: string;
  type: string;
  title: string;
  subtitle: string | null;
  position: number;
  enabled: boolean;
  publishAt: Date | null;
  unpublishAt: Date | null;
  linkType: string;
  buttonText: string | null;
  hasImage: boolean;
  /** ContentBlock rows for repeatable types; 0 otherwise. */
  blockCount: number;
  state: ScheduleState;
  /** Registry label, or the "unrecognised" fallback. */
  typeLabel: string;
  typeKnown: boolean;
  /** Where the items come from: a Banner placement, a data rule, or the blocks. */
  sourceNote: string;
  updatedAt: Date;
};

export type BlockEditorRow = {
  id: string;
  position: number;
  enabled: boolean;
  publishAt: string | null;
  unpublishAt: string | null;
  payload: Record<string, unknown>;
  media: PickedAsset | null;
  label: string;
  state: ScheduleState;
};

export type SectionEditorData = {
  id: string;
  key: string;
  type: string;
  title: string;
  subtitle: string | null;
  position: number;
  enabled: boolean;
  publishAt: string | null;
  unpublishAt: string | null;
  image: PickedAsset | null;
  linkType: LinkType;
  linkUrl: string | null;
  linkTargetId: string | null;
  linkTarget: EntityRef | null;
  buttonText: string | null;
  payload: Record<string, unknown>;
  /** Hydrated chips for `entity` / `entity-list` payload fields, by field name. */
  refs: Record<string, EntityRef[]>;
  /** Hydrated assets for `media` / `image` payload fields, by field name. */
  media: Record<string, PickedAsset | null>;
  blocks: BlockEditorRow[];
  state: ScheduleState;
  updatedAt: string;
};

export type FooterEditorData = FooterFormValues & { updatedAt: string | null };

/** What GET /api/admin/homepage/sections/:id/preview and the editor's Preview pane show. */
export type SectionPreviewData = {
  id: string;
  key: string;
  type: string;
  title: string;
  state: ScheduleState;
  resolver: string;
  /** Payload after the registry schema filled in defaults. */
  settings: Record<string, unknown>;
  items: unknown[];
  /** Set when the resolver threw; items is then []. */
  error: string | null;
};
