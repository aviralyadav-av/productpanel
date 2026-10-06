import {
  Blocks,
  Grid2x2,
  Images,
  LayoutTemplate,
  Mail,
  Megaphone,
  MessageSquareQuote,
  PanelBottom,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Store,
  TextQuote,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

import { CONTENT_SECTION_TYPES, LINK_TYPES, type ContentSectionType, type LinkType } from "@/lib/enums";

/**
 * THE SECTION REGISTRY (blueprint §14.E1 - frozen for wave 3 except the
 * content agent).
 *
 * ContentSection is one table with a `type` string and a jsonb payload, and
 * ContentBlock is one table for every repeatable item. Everything that makes a
 * section type what it is - its name, its fields, how those fields validate,
 * how many items it may hold, which resolver fills its `items` on `/home` -
 * lives here in code. Adding a section type is ONE new entry and NO migration;
 * removing one is safe because unknown rows fall back to UNKNOWN_SECTION and
 * render read-only instead of taking the page down.
 *
 * Banners stay the single editor for slide content: hero_slider and
 * promo_banners hold no blocks and READ the Banner placements. Homepage
 * controls order, enable, schedule and title.
 */

// ---------------------------------------------------------------------------
// Field descriptors - what the generic editor renders
// ---------------------------------------------------------------------------

export type EntityKind = "category" | "product" | "seller" | "review" | "page" | "blog" | "media";

export type FieldType =
  | "text"
  | "textarea"
  | "richtext"
  | "url"
  | "image"
  | "media"
  | "number"
  | "boolean"
  | "select"
  | "entity"
  | "entity-list"
  | "link"
  | "color";

export type FieldDescriptor = {
  name: string;
  label: string;
  type: FieldType;
  helpText?: string;
  required?: boolean;
  placeholder?: string;
  /** Textarea height in rows. Ignored by every other control. */
  rows?: number;
  /** Fixed choices for `select` (also honoured on `text` for legacy rows). */
  options?: readonly string[];
  /** For `entity` / `entity-list`: what the picker searches. */
  entityKind?: EntityKind;
  /** For `entity-list`: cap on picked ids. */
  maxItems?: number;
  /**
   * Multi-value fields are edited as one string and converted on save:
   *   "lines" -> string[]      (one per line)
   *   "list"  -> string[]      (comma or newline separated ids)
   *   "pairs" -> [{value,label}] ("25+ | Pieces of craft")
   */
  format?: "lines" | "list" | "pairs";
  /** Only meaningful for `link`: the type field this URL/target pairs with. */
  linkTypeField?: string;
};

/** Section-level link, resolved by the public API into `{ type, url }`. */
export type SectionLink = {
  linkType: LinkType;
  linkUrl: string | null;
  linkTargetId: string | null;
};

/**
 * Signature the public API engineer implements per section type (E1 table's
 * last column). `section` is the ContentSection row; the result becomes
 * `items[]` on `/api/v1/home`. Only the TYPE lives here.
 */
export type HomeResolverContext = {
  tx?: Prisma.TransactionClient;
  now: Date;
};

export type HomeResolver = (
  section: {
    id: string;
    key: string;
    type: string;
    title: string;
    subtitle: string | null;
    payload: Record<string, unknown>;
    linkType: string;
    linkUrl: string | null;
    linkTargetId: string | null;
    buttonText: string | null;
    imageMediaId: string | null;
  },
  ctx: HomeResolverContext,
) => Promise<unknown[]>;

export type HomeResolverName =
  | "banners"
  | "categories"
  | "products"
  | "collection"
  | "sellers"
  | "testimonials"
  | "featuredReviews"
  | "stored"
  | "blocks"
  | "footer";

export type SectionDefinition = {
  type: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** True when the section owns ordered ContentBlock children. */
  repeatable: boolean;
  minBlocks: number;
  maxBlocks: number;
  /** Singular noun for buttons and confirmations: "Add badge". */
  blockNoun: string;
  /** Validates ContentSection.payload. */
  sectionSchema: z.ZodType<Record<string, unknown>>;
  /** Validates ContentBlock.payload. */
  blockSchema: z.ZodType<Record<string, unknown>>;
  fields: FieldDescriptor[];
  blockFields: FieldDescriptor[];
  /** Block payload key holding the media id / url used for the row preview. */
  previewKey?: string;
  /** Block payload key used as the row label in the list. */
  blockTitleKey?: string;
  /** Which /home resolver fills `items[]`. */
  resolver: HomeResolverName;
  /** Whether the common title/subtitle/link/button fields apply. */
  supportsLink: boolean;
};

// ---------------------------------------------------------------------------
// Schema helpers - looseObject so an unknown key survives a save
// ---------------------------------------------------------------------------

const text = (max = 500) => z.string().trim().max(max).default("");
const required = (max = 500) => z.string().trim().min(1, "This field is required.").max(max);
const idList = (max = 50) => z.array(z.string().trim().min(1)).max(max).default([]);
const optionalId = z.string().trim().max(64).nullable().default(null);
const count = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const source = z.enum(["auto", "manual"]).default("auto");

const NO_BLOCKS = z.looseObject({});

const idListField = (name: string, label: string, entityKind: EntityKind, helpText?: string): FieldDescriptor => ({
  name,
  label,
  type: "entity-list",
  entityKind,
  format: "list",
  maxItems: 50,
  helpText,
});

const sourceField: FieldDescriptor = {
  name: "source",
  label: "Source",
  type: "select",
  options: ["auto", "manual"],
  helpText: "auto picks items by rule; manual shows exactly the ones listed below.",
};

const limitField = (fallback: number, label = "Maximum items"): FieldDescriptor => ({
  name: "limit",
  label,
  type: "number",
  helpText: `Up to this many items are sent to the storefront (default ${fallback}).`,
});

/**
 * Fields every section carries on its own columns (not in the payload). Listed
 * so the editor can render them from data like everything else.
 */
export const COMMON_SECTION_FIELDS: FieldDescriptor[] = [
  { name: "title", label: "Title", type: "text", required: true },
  { name: "subtitle", label: "Subtitle", type: "text" },
  { name: "enabled", label: "Enabled", type: "boolean" },
  { name: "publishAt", label: "Publish from", type: "text", helpText: "Leave empty to show immediately." },
  { name: "unpublishAt", label: "Unpublish at", type: "text", helpText: "Leave empty to never expire." },
  { name: "imageMediaId", label: "Image", type: "media" },
  { name: "linkType", label: "Link type", type: "select", options: LINK_TYPES },
  { name: "linkUrl", label: "Link URL", type: "url", linkTypeField: "linkType" },
  { name: "linkTargetId", label: "Link target", type: "entity", linkTypeField: "linkType" },
  { name: "buttonText", label: "Button label", type: "text" },
];

// ---------------------------------------------------------------------------
// Product-list sections share one shape
// ---------------------------------------------------------------------------

const productListSchema = z.looseObject({
  source,
  productIds: idList(),
  categoryId: optionalId,
  limit: count(1, 48, 8),
});

const productListFields: FieldDescriptor[] = [
  sourceField,
  idListField("productIds", "Products", "product", "Used when source is manual; order is kept."),
  { name: "categoryId", label: "Limit to category", type: "entity", entityKind: "category", helpText: "Optional: only products under this category (auto mode)." },
  limitField(8, "Products shown"),
];

function productSection(
  type: ContentSectionType,
  label: string,
  description: string,
  icon: LucideIcon,
): SectionDefinition {
  return {
    type,
    label,
    description,
    icon,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "item",
    sectionSchema: productListSchema,
    blockSchema: NO_BLOCKS,
    fields: productListFields,
    blockFields: [],
    resolver: "products",
    supportsLink: true,
  };
}

// ---------------------------------------------------------------------------
// The registry (E1)
// ---------------------------------------------------------------------------

export const SECTION_REGISTRY: Record<ContentSectionType, SectionDefinition> = {
  hero_slider: {
    type: "hero_slider",
    label: "Hero slider",
    description: "Full-width slides at the top of the homepage, taken from Banners placed in HOME_HERO.",
    icon: Images,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "slide",
    sectionSchema: z.looseObject({
      placement: z.literal("HOME_HERO").default("HOME_HERO"),
      limit: count(1, 10, 5),
      autoplaySeconds: count(0, 60, 6),
    }),
    blockSchema: NO_BLOCKS,
    fields: [
      limitField(5, "Slides shown"),
      { name: "autoplaySeconds", label: "Advance every (s)", type: "number", helpText: "0 turns autoplay off." },
    ],
    blockFields: [],
    resolver: "banners",
    supportsLink: false,
  },

  promo_banners: {
    type: "promo_banners",
    label: "Promo banners",
    description: "Promotional tiles from Banners placed in HOME_PROMO.",
    icon: LayoutTemplate,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "banner",
    sectionSchema: z.looseObject({
      placement: z.literal("HOME_PROMO").default("HOME_PROMO"),
      limit: count(1, 12, 3),
      layout: z.enum(["grid", "strip"]).default("grid"),
    }),
    blockSchema: NO_BLOCKS,
    fields: [
      limitField(3, "Banners shown"),
      { name: "layout", label: "Layout", type: "select", options: ["grid", "strip"] },
    ],
    blockFields: [],
    resolver: "banners",
    supportsLink: true,
  },

  featured_categories: {
    type: "featured_categories",
    label: "Featured categories",
    description: "Shop-by-category tiles: categories flagged Featured, or a hand-picked list.",
    icon: Grid2x2,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "category",
    sectionSchema: z.looseObject({ source, categoryIds: idList(), limit: count(1, 24, 8) }),
    blockSchema: NO_BLOCKS,
    fields: [
      sourceField,
      idListField("categoryIds", "Categories", "category", "Used when source is manual."),
      limitField(8, "Tiles shown"),
    ],
    blockFields: [],
    resolver: "categories",
    supportsLink: true,
  },

  new_arrivals: productSection("new_arrivals", "New arrivals", "Newest published products (auto) or a chosen list.", Sparkles),
  best_sellers: productSection("best_sellers", "Best sellers", "Products by order count (auto) or a chosen list.", ShoppingBag),
  trending: productSection("trending", "Trending", "Products flagged Trending (auto) or a chosen list.", TrendingUp),
  featured_products: productSection("featured_products", "Featured products", "Products flagged Featured (auto) or a chosen list.", Star),

  product_collection: {
    type: "product_collection",
    label: "Product collection",
    description: "A custom strip: listed products, a category, or a tag.",
    icon: ShoppingBag,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "item",
    sectionSchema: z.looseObject({
      productIds: idList(),
      categoryId: optionalId,
      tag: text(60),
      limit: count(1, 48, 8),
    }),
    blockSchema: NO_BLOCKS,
    fields: [
      idListField("productIds", "Products", "product"),
      { name: "categoryId", label: "Category", type: "entity", entityKind: "category" },
      { name: "tag", label: "Tag slug", type: "text", helpText: "Products carrying this tag are added after the listed ones." },
      limitField(8, "Products shown"),
    ],
    blockFields: [],
    resolver: "collection",
    supportsLink: true,
  },

  seller_highlights: {
    type: "seller_highlights",
    label: "Seller highlights",
    description: "Artisan spotlight: top-rated active sellers, or a chosen list.",
    icon: Store,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "seller",
    sectionSchema: z.looseObject({ source, sellerIds: idList(), limit: count(1, 24, 6) }),
    blockSchema: NO_BLOCKS,
    fields: [sourceField, idListField("sellerIds", "Sellers", "seller"), limitField(6, "Sellers shown")],
    blockFields: [],
    resolver: "sellers",
    supportsLink: true,
  },

  testimonials: {
    type: "testimonials",
    label: "Testimonials",
    description: "Approved reviews flagged Testimonial, or a chosen list.",
    icon: MessageSquareQuote,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "testimonial",
    sectionSchema: z.looseObject({ source, reviewIds: idList(), limit: count(1, 24, 6) }),
    blockSchema: NO_BLOCKS,
    fields: [sourceField, idListField("reviewIds", "Reviews", "review"), limitField(6, "Testimonials shown")],
    blockFields: [],
    resolver: "testimonials",
    supportsLink: true,
  },

  product_reviews: {
    type: "product_reviews",
    label: "Product reviews",
    description: "Approved reviews flagged Featured, filtered by a minimum rating.",
    icon: Star,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "review",
    sectionSchema: z.looseObject({ limit: count(1, 24, 6), minRating: count(1, 5, 4) }),
    blockSchema: NO_BLOCKS,
    fields: [limitField(6, "Reviews shown"), { name: "minRating", label: "Minimum rating", type: "number" }],
    blockFields: [],
    resolver: "featuredReviews",
    supportsLink: true,
  },

  promo_section: {
    type: "promo_section",
    label: "Promo section",
    description: "A full-bleed image with heading, text and one call to action.",
    icon: Megaphone,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "item",
    sectionSchema: z.looseObject({
      imageMediaId: text(64),
      mobileImageMediaId: text(64),
      heading: text(200),
      text: text(600),
      buttonText: text(60),
      linkType: z.enum(LINK_TYPES).default("NONE"),
      linkUrl: text(2000),
      linkTargetId: text(64),
      align: z.enum(["left", "center", "right"]).default("left"),
    }),
    blockSchema: NO_BLOCKS,
    fields: [
      { name: "imageMediaId", label: "Image", type: "media", required: true },
      { name: "mobileImageMediaId", label: "Mobile image", type: "media" },
      { name: "heading", label: "Heading", type: "textarea", rows: 2 },
      { name: "text", label: "Text", type: "textarea", rows: 3 },
      { name: "buttonText", label: "Button label", type: "text" },
      { name: "linkType", label: "Link type", type: "select", options: LINK_TYPES },
      { name: "linkUrl", label: "Link URL", type: "url", linkTypeField: "linkType" },
      { name: "linkTargetId", label: "Link target", type: "entity", linkTypeField: "linkType" },
      { name: "align", label: "Text alignment", type: "select", options: ["left", "center", "right"] },
    ],
    blockFields: [],
    resolver: "stored",
    supportsLink: false,
  },

  newsletter: {
    type: "newsletter",
    label: "Newsletter",
    description: "The sign-up block. Submissions land in Newsletter subscribers.",
    icon: Mail,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "item",
    sectionSchema: z.looseObject({
      heading: text(160),
      text: text(400),
      placeholder: text(80),
      buttonText: text(60),
    }),
    blockSchema: NO_BLOCKS,
    fields: [
      { name: "heading", label: "Heading", type: "text" },
      { name: "text", label: "Text", type: "textarea", rows: 3 },
      { name: "placeholder", label: "Input placeholder", type: "text" },
      { name: "buttonText", label: "Button label", type: "text" },
    ],
    blockFields: [],
    resolver: "stored",
    supportsLink: false,
  },

  trust_badges: {
    type: "trust_badges",
    label: "Trust badges",
    description: "The shipping / returns / secure-payment strip. Each badge is an item.",
    icon: ShieldCheck,
    repeatable: true,
    minBlocks: 1,
    maxBlocks: 8,
    blockNoun: "badge",
    blockTitleKey: "title",
    sectionSchema: z.looseObject({}),
    blockSchema: z.looseObject({ iconName: text(40), title: required(60), text: text(120) }),
    fields: [],
    blockFields: [
      { name: "iconName", label: "Icon", type: "text", helpText: "A lucide icon name, e.g. truck, shield-check, refresh-cw." },
      { name: "title", label: "Title", type: "text", required: true },
      { name: "text", label: "Supporting line", type: "text" },
    ],
    resolver: "blocks",
    supportsLink: false,
  },

  announcement_bar: {
    type: "announcement_bar",
    label: "Announcement bar",
    description: "The rotating strip above the header. Each message is an item.",
    icon: Megaphone,
    repeatable: true,
    minBlocks: 1,
    maxBlocks: 8,
    blockNoun: "message",
    blockTitleKey: "text",
    sectionSchema: z.looseObject({ rotateSeconds: count(1, 60, 5) }),
    blockSchema: z.looseObject({ text: required(160), linkUrl: text(2000) }),
    fields: [{ name: "rotateSeconds", label: "Rotate every (s)", type: "number" }],
    blockFields: [
      { name: "text", label: "Message", type: "text", required: true, placeholder: "Free shipping above ₹999" },
      { name: "linkUrl", label: "Link", type: "url" },
    ],
    resolver: "blocks",
    supportsLink: false,
  },

  rich_text: {
    type: "rich_text",
    label: "Rich text",
    description: "Free HTML content, sanitised on save.",
    icon: TextQuote,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "item",
    sectionSchema: z.looseObject({ html: z.string().max(50_000).default("") }),
    blockSchema: NO_BLOCKS,
    fields: [{ name: "html", label: "Content", type: "richtext", rows: 10 }],
    blockFields: [],
    resolver: "stored",
    supportsLink: false,
  },

  footer: {
    type: "footer",
    label: "Footer",
    description: "Reads FooterConfig and the footer-1..3 menus; edit them on the Footer tab.",
    icon: PanelBottom,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "item",
    sectionSchema: z.looseObject({}),
    blockSchema: NO_BLOCKS,
    fields: [],
    blockFields: [],
    resolver: "footer",
    supportsLink: false,
  },
};

/**
 * A row whose `type` is not in the registry still renders - read only, and
 * saying so - instead of throwing the whole Homepage page.
 */
export const UNKNOWN_SECTION: SectionDefinition = {
  type: "unknown",
  label: "Unrecognised section",
  description: "This row's type is not in the section registry, so there is no editor for it.",
  icon: Blocks,
  repeatable: false,
  minBlocks: 0,
  maxBlocks: 0,
  blockNoun: "item",
  sectionSchema: z.looseObject({}),
  blockSchema: z.looseObject({}),
  fields: [],
  blockFields: [],
  resolver: "stored",
  supportsLink: false,
};

export const SECTION_TYPES: readonly string[] = CONTENT_SECTION_TYPES;

export function isSectionType(type: string): type is ContentSectionType {
  return (CONTENT_SECTION_TYPES as readonly string[]).includes(type);
}

export function sectionDefinition(type: string): SectionDefinition {
  return isSectionType(type) ? SECTION_REGISTRY[type] : UNKNOWN_SECTION;
}

/** Sections whose payload carries its own link (promo_section) resolve from the payload; the rest from the row. */
export function sectionLinkOf(section: {
  type: string;
  linkType: string;
  linkUrl: string | null;
  linkTargetId: string | null;
  payload: Record<string, unknown>;
}): SectionLink {
  const definition = sectionDefinition(section.type);
  const fromPayload = !definition.supportsLink && typeof section.payload.linkType === "string";
  const linkTypeRaw = fromPayload ? (section.payload.linkType as string) : section.linkType;
  const linkType = (LINK_TYPES as readonly string[]).includes(linkTypeRaw) ? (linkTypeRaw as LinkType) : "NONE";
  const linkUrl = fromPayload ? (section.payload.linkUrl as string | undefined) ?? null : section.linkUrl;
  const linkTargetId = fromPayload ? (section.payload.linkTargetId as string | undefined) ?? null : section.linkTargetId;
  return { linkType, linkUrl: linkUrl || null, linkTargetId: linkTargetId || null };
}

/** Is a section (or block) inside its publish window right now? */
export function inPublishWindow(
  row: { enabled: boolean; publishAt: Date | null; unpublishAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (!row.enabled) return false;
  if (row.publishAt && row.publishAt > now) return false;
  if (row.unpublishAt && row.unpublishAt <= now) return false;
  return true;
}

export type ScheduleState = "live" | "scheduled" | "expired" | "disabled";

export function scheduleState(
  row: { enabled: boolean; publishAt: Date | null; unpublishAt: Date | null },
  now: Date = new Date(),
): ScheduleState {
  if (!row.enabled) return "disabled";
  if (row.publishAt && row.publishAt > now) return "scheduled";
  if (row.unpublishAt && row.unpublishAt <= now) return "expired";
  return "live";
}

// Payload <-> form value conversion lives in ./registry-forms; re-exported so
// the existing editor imports keep working.
export {
  blockLabel,
  emptyBlockPayload,
  formValuesToPayload,
  payloadToFormValues,
  type FormValue,
  type FormValues,
} from "./registry-forms";

/** Stable ContentSection.key for a new homepage section of a type. */
export function sectionKeyFor(type: ContentSectionType, suffix?: string): string {
  return suffix ? `home.${type}.${suffix}` : `home.${type}`;
}
