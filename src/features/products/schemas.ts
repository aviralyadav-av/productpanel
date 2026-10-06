import { z } from "zod";

import {
  BULK_PRODUCT_OPS,
  CHOICE_CUSTOMIZATION_TYPES,
  FILE_CUSTOMIZATION_TYPES,
  PRODUCT_STATUSES,
  bulkProductOpSchema,
  customizationOptionTypeSchema,
  productStatusSchema,
  type BulkProductOp,
  type CustomizationOptionType,
  type ProductStatus,
} from "@/lib/enums";
import {
  bpsSchema,
  optionalTextSchema,
  optionalUrlSchema,
  paiseSchema,
  slugSchema,
  textSchema,
} from "@/lib/validation";

/**
 * Every write into the catalogue passes through one of these schemas
 * (blueprint §14.F). Client components import the same file so a field that
 * is invalid on the server is also flagged in the browser with the same
 * sentence.
 *
 * Ids are opaque strings rather than cuids: the demo seed uses readable ids
 * ("demo_prod_007") that the admin must be able to address.
 *
 * No Next imports - the seed, the worker and the check script validate with
 * these too.
 */

export { BULK_PRODUCT_OPS, PRODUCT_STATUSES, bulkProductOpSchema, productStatusSchema };
export type { BulkProductOp, ProductStatus };

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Optional text/URL where an ABSENT key means "no value". The editor always
 * sends every field ("" → null), but REST clients and scripts omit what they
 * do not set, and `undefined` must not read as a validation error.
 */
const optionalText = (max: number) => z.preprocess((value) => (value === undefined ? null : value), optionalTextSchema(max));
const optionalUrl = z.preprocess((value) => (value === undefined ? null : value), optionalUrlSchema);

export const looseIdSchema = z
  .string()
  .trim()
  .min(1, "Missing id.")
  .max(64, "Invalid id.")
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid id.");

/** "" | undefined -> null so optional FK columns stay NULL. */
export const nullableIdSchema = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  looseIdSchema.nullable(),
);

/** Optional integer from a form: "", null, undefined -> null. */
export function nullableIntSchema(options: { min?: number; max?: number; label?: string } = {}) {
  const label = options.label ?? "This field";
  let base = z.number({ error: `${label} must be a number.` }).int(`${label} must be a whole number.`);
  if (options.min !== undefined) base = base.min(options.min, `${label} must be at least ${options.min}.`);
  if (options.max !== undefined) base = base.max(options.max, `${label} is too large.`);
  return z.preprocess(
    (value) => (value === "" || value === undefined || (typeof value === "number" && Number.isNaN(value)) ? null : value),
    base.nullable(),
  );
}

export const nullablePaiseSchema = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  paiseSchema.nullable(),
);

export const nullableBpsSchema = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  bpsSchema.nullable(),
);

/** ISO string | Date | "" | null -> Date | null. */
export const nullableDateSchema = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) return null;
    if (value instanceof Date) return value;
    if (typeof value === "string" || typeof value === "number") {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? value : parsed;
    }
    return value;
  },
  z.date({ error: "Enter a valid date." }).nullable(),
);

export const tagSchema = z.string().trim().min(1).max(60, "Tags are at most 60 characters.");

export const customFieldsSchema = z
  .record(z.string().trim().min(1).max(80), z.string().max(2000))
  .refine((record) => Object.keys(record).length <= 50, "At most 50 custom fields.");

// ---------------------------------------------------------------------------
// Attribute values (A8)
// ---------------------------------------------------------------------------

/**
 * One attribute's value(s) on a product. Select types use `valueIds`
 * (MULTI_SELECT may carry several), scalar types use exactly one of the
 * typed columns. The service decides `valueKey` from the attribute's input
 * type; the client never sends it.
 */
export const attributeValueInputSchema = z.object({
  attributeId: looseIdSchema,
  valueIds: z.array(looseIdSchema).max(50).optional(),
  textValue: optionalText(500).optional(),
  numberValue: z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z.number({ error: "Enter a number." }).finite().nullable(),
  ).optional(),
  boolValue: z.boolean().nullable().optional(),
});
export type AttributeValueInput = z.infer<typeof attributeValueInputSchema>;

export const attributeValuesSchema = z.array(attributeValueInputSchema).max(200);

// ---------------------------------------------------------------------------
// Product form (Basics, Pricing, Shipping, Flags, SEO, Custom fields)
// ---------------------------------------------------------------------------

const productFormObject = z
  .object({
    title: textSchema(200, "Title"),
    slug: slugSchema,
    baseSku: optionalText(64),
    shortDescription: optionalText(500),
    description: z.string().max(200_000, "The description is too long.").default(""),
    categoryId: nullableIdSchema,
    sellerId: nullableIdSchema,
    brand: optionalText(120),
    tags: z.array(tagSchema).max(30, "At most 30 tags.").default([]),

    pricePaise: paiseSchema,
    salePricePaise: nullablePaiseSchema,
    saleStartsAt: nullableDateSchema,
    saleEndsAt: nullableDateSchema,
    costPaise: nullablePaiseSchema,
    taxRateBps: nullableBpsSchema,
    hsnCode: optionalText(16),

    weightGrams: nullableIntSchema({ min: 0, max: 1_000_000, label: "Weight" }),
    lengthMm: nullableIntSchema({ min: 0, max: 100_000, label: "Length" }),
    widthMm: nullableIntSchema({ min: 0, max: 100_000, label: "Width" }),
    heightMm: nullableIntSchema({ min: 0, max: 100_000, label: "Height" }),
    shippingNote: optionalText(500),

    isFeatured: z.boolean().default(false),
    isNewArrival: z.boolean().default(false),
    isBestseller: z.boolean().default(false),
    isTrending: z.boolean().default(false),
    minOrderQty: z.number().int().min(1, "Minimum order quantity is at least 1.").max(100_000).default(1),
    maxOrderQty: nullableIntSchema({ min: 1, max: 1_000_000, label: "Maximum order quantity" }),
    position: z.number().int().min(0).max(1_000_000).default(0),

    videoUrl: optionalUrl,
    videoMediaId: nullableIdSchema,

    metaTitle: optionalText(160),
    metaDescription: optionalText(320),
    metaKeywords: z.array(tagSchema).max(30).default([]),
    canonicalUrl: optionalUrl,
    ogImageMediaId: nullableIdSchema,

    customFields: customFieldsSchema.default({}),
    attributeValues: attributeValuesSchema.default([]),
  });

type ProductFormShape = z.output<typeof productFormObject>;

/**
 * Cross-field rules (blueprint 11.6). Written against a Partial so the same
 * function serves the full form and the REST PUT patch: a rule only fires
 * when both sides it compares are present in the payload.
 */
function refineProductForm(value: Partial<ProductFormShape>, ctx: z.RefinementCtx): void {
  if (value.salePricePaise !== null && value.salePricePaise !== undefined && value.pricePaise !== undefined && value.salePricePaise >= value.pricePaise) {
    ctx.addIssue({ code: "custom", path: ["salePricePaise"], message: "The sale price must be lower than the price." });
  }
  if (value.saleStartsAt && value.saleEndsAt && value.saleEndsAt < value.saleStartsAt) {
    ctx.addIssue({ code: "custom", path: ["saleEndsAt"], message: "The sale must end after it starts." });
  }
  if (value.maxOrderQty !== null && value.maxOrderQty !== undefined && value.minOrderQty !== undefined && value.maxOrderQty < value.minOrderQty) {
    ctx.addIssue({ code: "custom", path: ["maxOrderQty"], message: "Maximum must be at least the minimum quantity." });
  }
  if (value.videoUrl && value.videoMediaId) {
    ctx.addIssue({ code: "custom", path: ["videoUrl"], message: "Use either a video URL or a library video, not both." });
  }
}

export const productFormSchema = productFormObject.superRefine(refineProductForm);

export type ProductFormInput = z.input<typeof productFormSchema>;
export type ProductFormValues = z.output<typeof productFormSchema>;

/** The REST PUT accepts any subset; the editor always sends the full form. (zod v4: partial() must precede the refinement.) */
export const productPatchSchema = productFormObject.partial().superRefine(refineProductForm);

// ---------------------------------------------------------------------------
// Status, flags, duplicate, delete
// ---------------------------------------------------------------------------

export const setStatusSchema = z.object({ status: productStatusSchema });

export const flagsSchema = z
  .object({
    isFeatured: z.boolean().optional(),
    isNewArrival: z.boolean().optional(),
    isBestseller: z.boolean().optional(),
    isTrending: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), "Choose at least one flag.");
export type FlagsInput = z.infer<typeof flagsSchema>;

// ---------------------------------------------------------------------------
// Variants (A5)
// ---------------------------------------------------------------------------

export const variantAxesSchema = z.object({
  axes: z
    .array(
      z.object({
        attributeId: looseIdSchema,
        valueIds: z.array(looseIdSchema).min(1, "Choose at least one value.").max(50),
      }),
    )
    .min(1, "Choose at least one attribute.")
    .max(4, "At most four axes."),
});
export type VariantAxesInput = z.infer<typeof variantAxesSchema>;

export const variantFieldsSchema = z.object({
  name: textSchema(120, "Variant name"),
  sku: optionalText(64),
  barcode: optionalText(64),
  pricePaise: nullablePaiseSchema,
  salePricePaise: nullablePaiseSchema,
  costPaise: nullablePaiseSchema,
  weightGrams: nullableIntSchema({ min: 0, max: 1_000_000, label: "Weight" }),
  isActive: z.boolean().default(true),
});

export const createVariantSchema = variantFieldsSchema.extend({
  attributeValues: z
    .array(z.object({ attributeId: looseIdSchema, valueId: looseIdSchema }))
    .max(4)
    .default([]),
  openingStock: z.number().int().min(0).max(1_000_000).default(0),
});
export type CreateVariantInput = z.input<typeof createVariantSchema>;
export type CreateVariantValues = z.output<typeof createVariantSchema>;

export const updateVariantSchema = variantFieldsSchema.partial().superRefine((value, ctx) => {
  if (
    value.pricePaise !== undefined &&
    value.pricePaise !== null &&
    value.salePricePaise !== undefined &&
    value.salePricePaise !== null &&
    value.salePricePaise >= value.pricePaise
  ) {
    ctx.addIssue({ code: "custom", path: ["salePricePaise"], message: "The sale price must be lower than the price." });
  }
});
export type UpdateVariantInput = z.output<typeof updateVariantSchema>;

export const setDefaultVariantSchema = z.object({ variantId: looseIdSchema });

export const variantImagesSchema = z.object({ mediaIds: z.array(looseIdSchema).max(20) });

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export const addImagesSchema = z.object({
  mediaIds: z.array(looseIdSchema).min(1, "Pick at least one image.").max(30),
  variantId: nullableIdSchema.optional(),
});
export type AddImagesInput = z.output<typeof addImagesSchema>;

export const updateImageSchema = z
  .object({
    alt: optionalText(300).optional(),
    isPrimary: z.boolean().optional(),
    variantId: nullableIdSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");
export type UpdateImageInput = z.output<typeof updateImageSchema>;

export const reorderSchema = z.object({
  orderedIds: z.array(looseIdSchema).min(1).max(200),
});
export type ReorderInput = z.infer<typeof reorderSchema>;

export const videoSchema = z
  .object({ videoUrl: optionalUrl, videoMediaId: nullableIdSchema })
  .refine((value) => !(value.videoUrl && value.videoMediaId), "Use either a video URL or a library video, not both.");

// ---------------------------------------------------------------------------
// Customisation options (§4.2, §11.9)
// ---------------------------------------------------------------------------

export const CUSTOMIZATION_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export const customizationChoiceSchema = z.object({
  value: z.string().trim().min(1, "Choice value is required.").max(80),
  label: z.string().trim().min(1, "Choice label is required.").max(120),
  priceDeltaPaise: z.number().int().min(-2_147_483_647).max(2_147_483_647).default(0),
  imageUrl: optionalUrl,
});
export type CustomizationChoice = z.output<typeof customizationChoiceSchema>;

export const customizationOptionSchema = z
  .object({
    type: customizationOptionTypeSchema,
    label: textSchema(120, "Label"),
    helpText: optionalText(300),
    placeholder: optionalText(120),
    isRequired: z.boolean().default(false),
    minLength: nullableIntSchema({ min: 0, max: 5000, label: "Minimum length" }),
    maxLength: nullableIntSchema({ min: 1, max: 5000, label: "Maximum length" }),
    maxFiles: nullableIntSchema({ min: 1, max: 10, label: "Maximum files" }),
    allowedMimeTypes: z.array(z.enum(CUSTOMIZATION_IMAGE_MIMES)).max(3).default([]),
    choices: z.array(customizationChoiceSchema).max(100).default([]),
    priceDeltaPaise: z.number().int().min(-2_147_483_647).max(2_147_483_647).default(0),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.minLength !== null && value.maxLength !== null && value.maxLength < value.minLength) {
      ctx.addIssue({ code: "custom", path: ["maxLength"], message: "Maximum length must be at least the minimum." });
    }
    if (isChoiceType(value.type)) {
      if (value.choices.length === 0) {
        ctx.addIssue({ code: "custom", path: ["choices"], message: "Add at least one choice." });
      }
      const seen = new Set<string>();
      for (const [index, choice] of value.choices.entries()) {
        if (seen.has(choice.value)) {
          ctx.addIssue({ code: "custom", path: ["choices", index, "value"], message: "Choice values must be unique." });
        }
        seen.add(choice.value);
      }
    }
  });
export type CustomizationOptionInput = z.input<typeof customizationOptionSchema>;
export type CustomizationOptionValues = z.output<typeof customizationOptionSchema>;

export const customizationOptionPatchSchema = z
  .object({
    type: customizationOptionTypeSchema.optional(),
    label: textSchema(120, "Label").optional(),
    helpText: optionalText(300).optional(),
    placeholder: optionalText(120).optional(),
    isRequired: z.boolean().optional(),
    minLength: nullableIntSchema({ min: 0, max: 5000, label: "Minimum length" }).optional(),
    maxLength: nullableIntSchema({ min: 1, max: 5000, label: "Maximum length" }).optional(),
    maxFiles: nullableIntSchema({ min: 1, max: 10, label: "Maximum files" }).optional(),
    allowedMimeTypes: z.array(z.enum(CUSTOMIZATION_IMAGE_MIMES)).max(3).optional(),
    choices: z.array(customizationChoiceSchema).max(100).optional(),
    priceDeltaPaise: z.number().int().min(-2_147_483_647).max(2_147_483_647).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");
export type CustomizationOptionPatch = z.output<typeof customizationOptionPatchSchema>;

export function isChoiceType(type: CustomizationOptionType | string): boolean {
  return (CHOICE_CUSTOMIZATION_TYPES as readonly string[]).includes(type);
}

export function isFileType(type: CustomizationOptionType | string): boolean {
  return (FILE_CUSTOMIZATION_TYPES as readonly string[]).includes(type);
}

/** Option types whose answer is free text (min/max length apply). */
export function isTextType(type: CustomizationOptionType | string): boolean {
  return ["TEXT", "NAME", "MESSAGE", "ENGRAVING", "INSTRUCTIONS"].includes(type);
}

// ---------------------------------------------------------------------------
// Bulk operations (A7)
// ---------------------------------------------------------------------------

export const BULK_MAX_IDS = 500;

export const PRICE_ADJUST_MODES = ["PERCENT", "FIXED", "SET"] as const;
export type PriceAdjustMode = (typeof PRICE_ADJUST_MODES)[number];

const bulkIds = z
  .array(looseIdSchema)
  .min(1, "Select at least one product.")
  .max(BULK_MAX_IDS, `At most ${BULK_MAX_IDS} products per bulk action.`);

export const bulkOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("DELETE") }),
  z.object({ op: z.literal("PUBLISH") }),
  z.object({ op: z.literal("UNPUBLISH") }),
  z.object({ op: z.literal("ARCHIVE") }),
  z.object({ op: z.literal("SET_CATEGORY"), categoryId: looseIdSchema }),
  z.object({
    op: z.literal("ADJUST_PRICE"),
    mode: z.enum(PRICE_ADJUST_MODES),
    /** PERCENT: whole or fractional percent (−90..1000); FIXED/SET: paise. */
    value: z.number().finite(),
  }),
  z.object({
    op: z.literal("SET_STOCK"),
    onHand: z.number().int().min(0).max(1_000_000),
    reason: z.string().trim().min(1, "Give a reason for the ledger.").max(200),
  }),
  z.object({
    op: z.literal("SET_ATTRIBUTE"),
    attributeId: looseIdSchema,
    mode: z.enum(["set", "add", "remove"]).default("set"),
    valueId: looseIdSchema.optional(),
    textValue: z.string().trim().max(500).optional(),
    numberValue: z.number().finite().optional(),
    boolValue: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("SET_FLAGS"),
    isFeatured: z.boolean().optional(),
    isNewArrival: z.boolean().optional(),
    isBestseller: z.boolean().optional(),
    isTrending: z.boolean().optional(),
  }),
]);
export type BulkOperation = z.output<typeof bulkOperationSchema>;

export const bulkRequestSchema = z.object({ ids: bulkIds }).and(bulkOperationSchema).superRefine((value, ctx) => {
  if (value.op === "ADJUST_PRICE") {
    if (value.mode === "PERCENT" && (value.value < -90 || value.value > 1000)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Percent must be between −90 and 1000." });
    }
    if (value.mode !== "PERCENT" && (!Number.isInteger(value.value) || Math.abs(value.value) > 2_147_483_647)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a whole amount." });
    }
    if (value.mode === "SET" && value.value <= 0) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "The new price must be greater than zero." });
    }
  }
  if (value.op === "SET_FLAGS") {
    const { isFeatured, isNewArrival, isBestseller, isTrending } = value;
    if ([isFeatured, isNewArrival, isBestseller, isTrending].every((flag) => flag === undefined)) {
      ctx.addIssue({ code: "custom", path: ["isFeatured"], message: "Choose at least one flag." });
    }
  }
  if (value.op === "SET_ATTRIBUTE") {
    const provided = [value.valueId, value.textValue, value.numberValue, value.boolValue].filter((item) => item !== undefined);
    if (value.mode !== "remove" && provided.length !== 1) {
      ctx.addIssue({ code: "custom", path: ["valueId"], message: "Provide exactly one value." });
    }
  }
});
export type BulkRequest = z.output<typeof bulkRequestSchema>;

/** Which permission each bulk op needs on top of products.bulk (A7). */
export const BULK_OP_PERMISSION: Record<BulkProductOp, string> = {
  DELETE: "products.delete",
  PUBLISH: "products.publish",
  UNPUBLISH: "products.publish",
  ARCHIVE: "products.publish",
  SET_CATEGORY: "products.edit",
  ADJUST_PRICE: "products.edit",
  SET_STOCK: "inventory.adjust",
  SET_ATTRIBUTE: "products.edit",
  SET_FLAGS: "products.edit",
};

export const BULK_OP_LABELS: Record<BulkProductOp, string> = {
  DELETE: "Delete",
  PUBLISH: "Publish",
  UNPUBLISH: "Unpublish",
  ARCHIVE: "Archive",
  SET_CATEGORY: "Set category",
  ADJUST_PRICE: "Adjust price",
  SET_STOCK: "Set stock",
  SET_ATTRIBUTE: "Set attribute",
  SET_FLAGS: "Set flags",
};

// ---------------------------------------------------------------------------
// Attribute CSV import (A7)
// ---------------------------------------------------------------------------

export const attributeImportSchema = z.object({
  categoryId: looseIdSchema,
  csv: z.string().min(1, "The CSV is empty.").max(5_000_000, "The CSV is too large (5 MB max)."),
  createValues: z.boolean().default(false),
  /** false = validation report only. */
  apply: z.boolean().default(false),
});
export type AttributeImportInput = z.output<typeof attributeImportSchema>;

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export const previewTokenSchema = z.object({
  ttlSeconds: z.number().int().min(60).max(3600).optional(),
});
