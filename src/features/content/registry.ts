import {
  Blocks,
  Clapperboard,
  Grid2x2,
  Hammer,
  Images,
  LayoutTemplate,
  Mail,
  Megaphone,
  MessageSquareQuote,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { z } from "zod";

/**
 * THE SECTION REGISTRY
 *
 * ContentSection is one table with a `type` string and a jsonb payload, and
 * ContentBlock is one table for every repeatable item. Everything that makes a
 * section type what it is - its name, its fields, how those fields validate,
 * how many items it may hold - lives here in code.
 *
 * That is the point: adding a new homepage section type later is ONE new entry
 * in this file and NO database migration. The row goes into the same two
 * tables, the generic editor renders it from the descriptors below, and the
 * public serializer picks up the new key. Deleting an entry is equally safe -
 * existing rows fall back to UNKNOWN_SECTION and render read-only instead of
 * taking down the page.
 *
 * The payload shapes are not invented. They are exactly what the seeder wrote
 * from prisma/seed/source/home.json and exactly what src/lib/serializers/
 * public.ts reads back out, so an admin edit survives the round trip into the
 * storefront's own JSON shape.
 */

// ---------------------------------------------------------------------------
// Field descriptors - what the generic editor renders
// ---------------------------------------------------------------------------

export type FieldType =
  | "text"
  | "textarea"
  | "url"
  | "image"
  | "number"
  | "boolean"
  | "link";

export type FieldDescriptor = {
  name: string;
  label: string;
  type: FieldType;
  helpText?: string;
  required?: boolean;
  placeholder?: string;
  /** Textarea height in rows. Ignored by every other control. */
  rows?: number;
  /** Renders a fixed-choice select instead of a free-text input. */
  options?: readonly string[];
  /**
   * Two seeded payload keys hold arrays rather than scalars
   * (brand_craftsmanship.description is string[], .stats is [{value,label}]).
   * Rather than invent a nested repeater field type for two fields, they are
   * edited as a textarea with a line-per-item convention and converted back to
   * the exact stored shape on save:
   *   "lines" -> ["para one", "para two"]
   *   "pairs" -> [{ value: "25+", label: "Pieces of craft" }]
   */
  format?: "lines" | "pairs";
};

export type SectionDefinition = {
  type: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** True when the section owns ordered ContentBlock children. */
  repeatable: boolean;
  minBlocks: number;
  maxBlocks: number;
  /** Singular noun for buttons and confirmations: "Add slide". */
  blockNoun: string;
  /** Validates ContentSection.payload. */
  sectionSchema: z.ZodType<Record<string, unknown>>;
  /** Validates ContentBlock.payload. */
  blockSchema: z.ZodType<Record<string, unknown>>;
  fields: FieldDescriptor[];
  blockFields: FieldDescriptor[];
  /** Block payload key holding the image or video used for the row preview. */
  previewKey?: string;
  /** Block payload key used as the row label in the list. */
  blockTitleKey?: string;
};

// ---------------------------------------------------------------------------
// Schema helpers
//
// Payloads validate through looseObject so a key nobody has built a field for
// yet - a future flag, a leftover from the import - survives a save instead of
// being silently dropped.
// ---------------------------------------------------------------------------

const text = (max = 500) => z.string().trim().max(max).default("");
const required = (max = 500) =>
  z.string().trim().min(1, "This field is required.").max(max);
const asset = z.string().trim().max(2000).default("");
const linkValue = z.string().trim().max(2000).default("");
const count = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const NO_BLOCKS = z.looseObject({});

const statSchema = z.object({
  value: z.string().trim().max(40),
  label: z.string().trim().max(120),
});

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export const SECTION_REGISTRY: Record<string, SectionDefinition> = {
  announcement_bar: {
    type: "announcement_bar",
    label: "Announcement bar",
    description:
      "The rotating strip above the header. Each message is a separate item.",
    icon: Megaphone,
    repeatable: true,
    minBlocks: 1,
    maxBlocks: 8,
    blockNoun: "message",
    blockTitleKey: "text",
    sectionSchema: z.looseObject({ rotateSeconds: count(1, 60, 4) }),
    blockSchema: z.looseObject({ text: required(160) }),
    fields: [
      {
        name: "rotateSeconds",
        label: "Rotate every",
        type: "number",
        helpText: "Seconds each message stays on screen before the next one.",
      },
    ],
    blockFields: [
      {
        name: "text",
        label: "Message",
        type: "text",
        required: true,
        placeholder: "Complimentary shipping on all orders",
      },
    ],
  },

  hero: {
    type: "hero",
    label: "Hero banner",
    description:
      "The full-width slider at the top of the homepage. One item per slide.",
    icon: Images,
    repeatable: true,
    minBlocks: 1,
    maxBlocks: 6,
    blockNoun: "slide",
    blockTitleKey: "title",
    previewKey: "image",
    sectionSchema: z.looseObject({ autoplaySeconds: count(2, 60, 6) }),
    blockSchema: z.looseObject({
      title: required(200),
      subtitle: text(300),
      buttonText: text(60),
      buttonLink: linkValue,
      image: asset,
    }),
    fields: [
      {
        name: "autoplaySeconds",
        label: "Advance every",
        type: "number",
        helpText: "Seconds before the slider moves to the next slide.",
      },
    ],
    blockFields: [
      {
        name: "title",
        label: "Headline",
        type: "textarea",
        rows: 2,
        required: true,
        helpText: "A line break here becomes a line break on the storefront.",
      },
      { name: "subtitle", label: "Subtitle", type: "textarea", rows: 2 },
      { name: "buttonText", label: "Button label", type: "text" },
      { name: "buttonLink", label: "Button link", type: "link" },
      {
        name: "image",
        label: "Background image",
        type: "image",
        helpText: "A storefront path such as /products/bags/... or a full URL.",
      },
    ],
  },

  categories: {
    type: "categories",
    label: "Category grid",
    description: "The shop-by-category tiles under the hero.",
    icon: Grid2x2,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "item",
    sectionSchema: z.looseObject({
      heading: text(120),
      source: z.enum(["derived", "pinned"]).default("derived"),
      limit: count(1, 24, 8),
    }),
    blockSchema: NO_BLOCKS,
    blockFields: [],
    fields: [
      { name: "heading", label: "Heading", type: "text" },
      {
        name: "source",
        label: "Source",
        type: "text",
        options: ["derived", "pinned"],
        helpText:
          "derived builds the tiles from the products' own categories. pinned is not read by the storefront yet.",
      },
      { name: "limit", label: "Maximum tiles", type: "number" },
    ],
  },

  featured_products: {
    type: "featured_products",
    label: "Featured products",
    description: "The product strip driven by the Featured flag on a product.",
    icon: ShoppingBag,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "item",
    sectionSchema: z.looseObject({
      heading: text(120),
      limit: count(1, 24, 4),
      note: text(400),
    }),
    blockSchema: NO_BLOCKS,
    blockFields: [],
    fields: [
      { name: "heading", label: "Heading", type: "text" },
      {
        name: "limit",
        label: "Products shown",
        type: "number",
        helpText:
          "FeaturedProducts.jsx slices to 4 regardless of this number until the storefront reads the API.",
      },
      { name: "note", label: "Internal note", type: "textarea", rows: 3 },
    ],
  },

  trust_badges: {
    type: "trust_badges",
    label: "Trust badges",
    description: "The shipping, warranty and returns strip.",
    icon: ShieldCheck,
    repeatable: true,
    minBlocks: 1,
    maxBlocks: 6,
    blockNoun: "badge",
    blockTitleKey: "title",
    sectionSchema: z.looseObject({ marquee: z.boolean().default(true) }),
    blockSchema: z.looseObject({
      icon: text(40),
      title: required(60),
      text: text(120),
    }),
    fields: [
      {
        name: "marquee",
        label: "Scroll the strip",
        type: "boolean",
        helpText: "Off renders the badges as a static row.",
      },
    ],
    blockFields: [
      {
        name: "icon",
        label: "Icon",
        type: "text",
        options: [
          "package",
          "shield",
          "refresh-cw",
          "circle-help",
          "truck",
          "sparkles",
        ],
        helpText: "Icon name the storefront maps to a component.",
      },
      { name: "title", label: "Title", type: "text", required: true },
      {
        name: "text",
        label: "Supporting line",
        type: "text",
        helpText:
          "The seeded Free Shipping badge advertises orders over Rs 10,000; the storefront's own checkout gives free shipping above Rs 2,000.",
      },
    ],
  },

  campaign_spotlight: {
    type: "campaign_spotlight",
    label: "Campaign spotlight",
    description: "The full-bleed campaign panel with one call to action.",
    icon: Sparkles,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "item",
    sectionSchema: z.looseObject({
      eyebrow: text(120),
      title: text(200),
      description: text(600),
      image: asset,
      buttonText: text(60),
      buttonLink: linkValue,
    }),
    blockSchema: NO_BLOCKS,
    blockFields: [],
    fields: [
      { name: "eyebrow", label: "Eyebrow", type: "text" },
      {
        name: "title",
        label: "Title",
        type: "textarea",
        rows: 2,
        helpText: "A line break here becomes a line break on the storefront.",
      },
      { name: "description", label: "Description", type: "textarea", rows: 4 },
      { name: "image", label: "Image", type: "image" },
      { name: "buttonText", label: "Button label", type: "text" },
      { name: "buttonLink", label: "Button link", type: "link" },
    ],
  },

  reels: {
    type: "reels",
    label: "Reels",
    description: "The short-video row. One item per clip.",
    icon: Clapperboard,
    repeatable: true,
    minBlocks: 1,
    maxBlocks: 8,
    blockNoun: "reel",
    blockTitleKey: "title",
    previewKey: "video",
    sectionSchema: z.looseObject({ heading: text(120) }),
    blockSchema: z.looseObject({
      title: required(120),
      video: asset,
      caption: text(200),
      link: linkValue,
    }),
    fields: [{ name: "heading", label: "Heading", type: "text" }],
    blockFields: [
      { name: "title", label: "Title", type: "text", required: true },
      {
        name: "video",
        label: "Video",
        type: "url",
        helpText:
          "An .mp4 path under /products or a full URL. Only title and video reach the storefront today.",
      },
      { name: "caption", label: "Caption", type: "text" },
      { name: "link", label: "Link", type: "link" },
    ],
  },

  brand_craftsmanship: {
    type: "brand_craftsmanship",
    label: "Brand / craftsmanship",
    description: "The two-column brand story with its statistics.",
    icon: Hammer,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "item",
    sectionSchema: z.looseObject({
      eyebrow: text(120),
      title: text(200),
      description: z.array(z.string().trim().max(600)).default([]),
      stats: z.array(statSchema).max(6).default([]),
      image: asset,
      imageAlt: text(200),
      buttonText: text(60),
      buttonLink: linkValue,
    }),
    blockSchema: NO_BLOCKS,
    blockFields: [],
    fields: [
      { name: "eyebrow", label: "Eyebrow", type: "text" },
      {
        name: "title",
        label: "Title",
        type: "textarea",
        rows: 2,
        helpText: "A line break here becomes a line break on the storefront.",
      },
      {
        name: "description",
        label: "Paragraphs",
        type: "textarea",
        rows: 5,
        format: "lines",
        helpText: "One paragraph per line. Blank lines are ignored.",
      },
      {
        name: "stats",
        label: "Statistics",
        type: "textarea",
        rows: 4,
        format: "pairs",
        helpText: "One per line, written as   25+ | Pieces of craft",
      },
      { name: "image", label: "Image", type: "image" },
      { name: "imageAlt", label: "Image alt text", type: "text" },
      { name: "buttonText", label: "Button label", type: "text" },
      { name: "buttonLink", label: "Button link", type: "link" },
    ],
  },

  customer_reviews: {
    type: "customer_reviews",
    label: "Customer reviews",
    description:
      "The testimonial carousel. Its content comes from the Reviews tab, not from this section.",
    icon: MessageSquareQuote,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "item",
    sectionSchema: z.looseObject({
      heading: text(120),
      source: z.enum(["featured", "latest"]).default("featured"),
      limit: count(1, 24, 3),
    }),
    blockSchema: NO_BLOCKS,
    blockFields: [],
    fields: [
      { name: "heading", label: "Heading", type: "text" },
      {
        name: "source",
        label: "Source",
        type: "text",
        options: ["featured", "latest"],
        helpText:
          "featured uses approved reviews flagged Featured. Edit them on the Reviews tab.",
      },
      { name: "limit", label: "Reviews shown", type: "number" },
    ],
  },

  newsletter: {
    type: "newsletter",
    label: "Newsletter",
    description:
      "The sign-up block at the foot of the homepage. Nothing stores the submissions yet.",
    icon: Mail,
    repeatable: false,
    minBlocks: 0,
    maxBlocks: 0,
    blockNoun: "item",
    sectionSchema: z.looseObject({
      eyebrow: text(120),
      title: text(160),
      description: text(400),
      placeholder: text(80),
      buttonText: text(60),
    }),
    blockSchema: NO_BLOCKS,
    blockFields: [],
    fields: [
      { name: "eyebrow", label: "Eyebrow", type: "text" },
      { name: "title", label: "Title", type: "text" },
      { name: "description", label: "Description", type: "textarea", rows: 3 },
      { name: "placeholder", label: "Input placeholder", type: "text" },
      { name: "buttonText", label: "Button label", type: "text" },
    ],
  },

  promo_banner: {
    type: "promo_banner",
    label: "Promo banners",
    description:
      "Targeted banners. Each one names the page and the slot it drops into.",
    icon: LayoutTemplate,
    repeatable: true,
    minBlocks: 0,
    maxBlocks: 6,
    blockNoun: "banner",
    blockTitleKey: "title",
    previewKey: "image",
    // The seeded payload carries a `slots` list describing which page/position
    // pairs the storefront knows how to render. It is not operator-editable, so
    // it gets no field descriptor - looseObject carries it through a save.
    sectionSchema: z.looseObject({}),
    blockSchema: z.looseObject({
      page: z.enum(["home", "shop", "wishlist"]).default("home"),
      position: z.enum(["after-hero", "after-products"]).default("after-hero"),
      image: asset,
      title: text(120),
      alt: text(200),
    }),
    fields: [],
    blockFields: [
      {
        name: "page",
        label: "Page",
        type: "text",
        options: ["home", "shop", "wishlist"],
        required: true,
      },
      {
        name: "position",
        label: "Slot",
        type: "text",
        options: ["after-hero", "after-products"],
        required: true,
      },
      { name: "image", label: "Image", type: "image" },
      { name: "title", label: "Title", type: "text" },
      { name: "alt", label: "Alt text", type: "text" },
    ],
  },
};

/**
 * A row whose `type` is not in the registry still renders - read only, and
 * saying so - instead of throwing the whole Content page.
 */
export const UNKNOWN_SECTION: SectionDefinition = {
  type: "unknown",
  label: "Unrecognised section",
  description:
    "This row's type is not in the section registry, so there is no editor for it.",
  icon: Blocks,
  repeatable: false,
  minBlocks: 0,
  maxBlocks: 0,
  blockNoun: "item",
  sectionSchema: z.looseObject({}),
  blockSchema: z.looseObject({}),
  fields: [],
  blockFields: [],
};

export const SECTION_TYPES = Object.keys(SECTION_REGISTRY);

export function sectionDefinition(type: string): SectionDefinition {
  return SECTION_REGISTRY[type] ?? UNKNOWN_SECTION;
}

// ---------------------------------------------------------------------------
// Payload <-> form value conversion
//
// Form controls speak strings and booleans; payloads hold numbers, arrays and
// objects. Both directions are driven by the same descriptor list, so a field
// can never be read with one shape and written back with another.
// ---------------------------------------------------------------------------

export type FormValue = string | boolean;
export type FormValues = Record<string, FormValue>;

function toLines(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join("\n");
  return value === null || value === undefined ? "" : String(value);
}

function toPairs(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      return `${String(record.value ?? "")} | ${String(record.label ?? "")}`;
    })
    .join("\n");
}

export function payloadToFormValues(
  fields: FieldDescriptor[],
  payload: Record<string, unknown>,
): FormValues {
  const values: FormValues = {};

  for (const field of fields) {
    const raw = payload[field.name];

    if (field.type === "boolean") {
      values[field.name] = raw === true || raw === "true";
      continue;
    }
    if (field.format === "lines") {
      values[field.name] = toLines(raw);
      continue;
    }
    if (field.format === "pairs") {
      values[field.name] = toPairs(raw);
      continue;
    }
    values[field.name] = raw === null || raw === undefined ? "" : String(raw);
  }

  return values;
}

export function formValuesToPayload(
  fields: FieldDescriptor[],
  values: FormValues,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = values[field.name];

    if (field.type === "boolean") {
      payload[field.name] = raw === true;
      continue;
    }

    const value = typeof raw === "string" ? raw : "";

    if (field.type === "number") {
      // An empty number field means "leave it to the schema default" rather
      // than "zero", which would silently switch a carousel off.
      if (value.trim() === "") continue;
      payload[field.name] = Number(value);
      continue;
    }

    if (field.format === "lines") {
      payload[field.name] = value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      continue;
    }

    if (field.format === "pairs") {
      payload[field.name] = value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [head, ...rest] = line.split("|");
          return { value: (head ?? "").trim(), label: rest.join("|").trim() };
        });
      continue;
    }

    payload[field.name] = value;
  }

  return payload;
}

/** An empty payload for a brand new block, so required fields render blank. */
export function emptyBlockPayload(
  definition: SectionDefinition,
): Record<string, unknown> {
  const values: FormValues = {};
  for (const field of definition.blockFields) {
    values[field.name] =
      field.type === "boolean" ? false : (field.options?.[0] ?? "");
  }
  return formValuesToPayload(definition.blockFields, values);
}

/** The label a block row shows in the list. */
export function blockLabel(
  definition: SectionDefinition,
  payload: Record<string, unknown>,
  index: number,
): string {
  const key = definition.blockTitleKey;
  const raw = key ? payload[key] : undefined;
  const label = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (label) return label;
  return `${definition.blockNoun} ${index + 1}`;
}
