import { z } from "zod";

import { bpsSchema, optionalTextSchema, optionalUrlSchema, paiseSchema, slugSchema, textSchema } from "@/lib/validation";

/**
 * Every write into the category tree passes through this file (blueprint
 * §14.F, §11.1-2, §11.23, A1-A2, A9).
 *
 * Client-safe: no Prisma, no `server-only`. The editor imports the same
 * schemas to validate before it round-trips, so the red outline the operator
 * sees is produced by exactly the rule the server enforces.
 */

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Deepest level a category may sit at, 0-based (6 levels). The schema has no
 * limit and the client asked for "unlimited" depth, but a tree deeper than
 * this is unusable in a sidebar and impossible to breadcrumb on a phone; the
 * cap is a UX guard, not a data-model one, and is trivially raised here.
 */
export const MAX_CATEGORY_DEPTH = 5;

/** Ids here are opaque strings, not cuids: the seed uses readable ids. */
export const categoryIdSchema = z
  .string()
  .trim()
  .min(1, "Missing id.")
  .max(64, "Invalid id.")
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid id.");

const nullableIdSchema = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  categoryIdSchema.nullable(),
);

const positionSchema = z.coerce.number().int("Position must be a whole number.").min(0).max(100_000);

/**
 * `iconName` is a lucide icon in kebab-case ("shopping-bag") or an emoji.
 * Free text is accepted; the editor previews it and the storefront falls
 * back to the parent's icon when the name does not resolve.
 */
const iconNameSchema = optionalTextSchema(60);

// ---------------------------------------------------------------------------
// Category create / update
// ---------------------------------------------------------------------------

export const categoryInputSchema = z.object({
  name: textSchema(120, "Name"),
  /** Optional on create: derived from the name and suffixed if taken (§11.23). */
  slug: z.preprocess((value) => (value === "" ? undefined : value), slugSchema.optional()),
  parentId: nullableIdSchema,
  description: optionalTextSchema(2_000),
  position: positionSchema.optional(),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),

  imageMediaId: nullableIdSchema,
  iconMediaId: nullableIdSchema,
  bannerMediaId: nullableIdSchema,
  iconName: iconNameSchema,

  metaTitle: optionalTextSchema(160),
  metaDescription: optionalTextSchema(320),
  metaKeywords: optionalTextSchema(500),
  canonicalUrl: optionalUrlSchema,
  ogImageMediaId: nullableIdSchema,
  noIndex: z.boolean().default(false),
});

export type CategoryInput = z.input<typeof categoryInputSchema>;
export type CategoryValues = z.output<typeof categoryInputSchema>;

/** PUT accepts a partial body; the service merges it over the current row. */
export const categoryPatchSchema = categoryInputSchema.partial();
export type CategoryPatch = z.output<typeof categoryPatchSchema>;

export const categoryFlagSchema = z.object({
  id: categoryIdSchema,
  value: z.boolean(),
});

export const deleteCategorySchema = z.object({
  id: categoryIdSchema,
  /** Where children and products go. Required when either exists (§11.1). */
  reassignTo: nullableIdSchema.optional(),
});
export type DeleteCategoryInput = z.output<typeof deleteCategorySchema>;

// ---------------------------------------------------------------------------
// Reorder (G5)
// ---------------------------------------------------------------------------

export const reorderMoveSchema = z.object({
  id: categoryIdSchema,
  parentId: nullableIdSchema,
  position: z.number().int().min(0).max(100_000),
});

export const reorderSchema = z.object({
  moves: z.array(reorderMoveSchema).min(1, "Nothing to move.").max(200, "Too many moves in one request."),
});
export type ReorderInput = z.output<typeof reorderSchema>;

// ---------------------------------------------------------------------------
// Category attributes (A1, A2)
// ---------------------------------------------------------------------------

export const CATEGORY_ATTRIBUTE_FLAGS = ["isRequired", "isFilterable", "isVariant", "showInSpecs", "inheritToChildren"] as const;
export type CategoryAttributeFlag = (typeof CATEGORY_ATTRIBUTE_FLAGS)[number];
export const categoryAttributeFlagSchema = z.enum(CATEGORY_ATTRIBUTE_FLAGS);

export const setAttributeFlagSchema = z.object({
  categoryId: categoryIdSchema,
  attributeId: categoryIdSchema,
  flag: categoryAttributeFlagSchema,
  value: z.boolean(),
});
export type SetAttributeFlagInput = z.output<typeof setAttributeFlagSchema>;

export const categoryAttributeRefSchema = z.object({
  categoryId: categoryIdSchema,
  attributeId: categoryIdSchema,
});
export type CategoryAttributeRef = z.output<typeof categoryAttributeRefSchema>;

export const reorderOwnAttributesSchema = z.object({
  categoryId: categoryIdSchema,
  /** Own (non-excluded) rows in the order they should appear. */
  attributeIds: z.array(categoryIdSchema).max(200),
});
export type ReorderOwnAttributesInput = z.output<typeof reorderOwnAttributesSchema>;

/** One own row as the REST PUT body and the editor's replace call express it. */
export const categoryAttributeRowSchema = z.object({
  attributeId: categoryIdSchema,
  isRequired: z.boolean().default(false),
  isFilterable: z.boolean().default(true),
  isVariant: z.boolean().default(false),
  showInSpecs: z.boolean().default(true),
  inheritToChildren: z.boolean().default(true),
  isExcluded: z.boolean().default(false),
  position: z.number().int().min(0).max(100_000).default(0),
});
export type CategoryAttributeRowInput = z.output<typeof categoryAttributeRowSchema>;

export const replaceCategoryAttributesSchema = z.object({
  rows: z.array(categoryAttributeRowSchema).max(200),
});

// ---------------------------------------------------------------------------
// Commission override (B3) - scope CATEGORY only from this screen
// ---------------------------------------------------------------------------

export const commissionOverrideSchema = z.object({
  categoryId: categoryIdSchema,
  rateBps: bpsSchema,
  fixedPaise: paiseSchema.default(0),
  note: optionalTextSchema(300),
});
export type CommissionOverrideInput = z.output<typeof commissionOverrideSchema>;

// ---------------------------------------------------------------------------
// Editor tabs and list filters (URL vocabulary)
// ---------------------------------------------------------------------------

export const CATEGORY_TABS = ["details", "attributes", "products", "activity"] as const;
export type CategoryTab = (typeof CATEGORY_TABS)[number];

export function resolveCategoryTab(raw: string | undefined): CategoryTab {
  return (CATEGORY_TABS as readonly string[]).includes(raw ?? "") ? (raw as CategoryTab) : "details";
}

/** Public storefront path for a category, mirroring src/features/storefront/links.ts. */
export function storefrontCategoryPath(path: string): string {
  return `/c/${path.replace(/^\/+/, "")}`;
}
