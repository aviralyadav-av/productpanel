import { z } from "zod";

import { productStatusSchema } from "@/lib/enums";
import { rupeesToPaise } from "@/lib/money";

/**
 * Every write path into the catalogue passes through this file.
 *
 * Money enters as RUPEES because that is what an operator types, and leaves
 * every schema below as PAISE because that is the only unit the database
 * knows. The conversion happens here rather than in each action so that it
 * cannot be forgotten in one of them.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** India has no DST, so an IST wall-clock boundary is a fixed offset. */
const IST = "+05:30";
const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

/**
 * A date input gives "2026-09-04" with no time. Reading that as UTC midnight
 * would start a sale at 05:30 IST and end it eighteen hours early, so both
 * boundaries are pinned to the IST day the operator actually meant.
 */
function istStartOfDay(value: string): Date {
  return new Date(`${value}T00:00:00.000${IST}`);
}

function istEndOfDay(value: string): Date {
  return new Date(`${value}T23:59:59.999${IST}`);
}

/** The inverse, for pre-filling an <input type="date">. */
export function toDateInputValue(
  date: Date | string | null | undefined,
): string {
  if (!date) return "";
  const parsed = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(parsed.getTime())) return "";
  return new Date(parsed.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Strips the combining marks that NFKD splits off, so "é" slugs as "e".
 *  Built from a string literal so the range stays legible in source. */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "The slug needs at least two characters.")
  .max(80, "Keep the slug under 80 characters.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Lowercase letters, numbers and single hyphens only.",
  );

/** "" and undefined both mean "not set", which these columns store as NULL. */
function optionalText(max: number, tooLong: string) {
  return z
    .string()
    .trim()
    .max(max, tooLong)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null));
}

const requiredRupees = z
  .string()
  .trim()
  .refine(
    (value) => value.length > 0 && Number.isFinite(Number(value)),
    "Enter an amount in rupees.",
  )
  .transform((value) => rupeesToPaise(Number(value)))
  .refine((paise) => paise >= 0, "An amount cannot be negative.")
  .refine((paise) => paise <= 100_000_000, "That amount looks wrong.");

const optionalRupees = z
  .string()
  .trim()
  .optional()
  .transform((value) =>
    value && value.length > 0 ? rupeesToPaise(Number(value)) : null,
  )
  .refine(
    (paise) => paise === null || (Number.isFinite(paise) && paise >= 0),
    "Enter an amount in rupees, or leave it blank.",
  )
  .refine(
    (paise) => paise === null || paise <= 100_000_000,
    "That amount looks wrong.",
  );

function optionalDate(edge: "start" | "end") {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) =>
      value && value.length > 0
        ? edge === "start"
          ? istStartOfDay(value)
          : istEndOfDay(value)
        : null,
    )
    .refine(
      (date) => date === null || !Number.isNaN(date.getTime()),
      "Enter a valid date.",
    );
}

function integerField(max: number) {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? Number(value) : 0))
    .refine(
      (value) => Number.isInteger(value) && value >= 0 && value <= max,
      `Enter a whole number between 0 and ${max}.`,
    );
}

const booleanField = z
  .string()
  .optional()
  .transform((value) => value === "true" || value === "on" || value === "1");

/** Radix Select cannot hold an empty value, so "none" is the null sentinel. */
const optionalId = z
  .string()
  .trim()
  .optional()
  .transform((value) =>
    value && value.length > 0 && value !== "none" ? value : null,
  );

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

export const GENDERS = ["women", "men"] as const;
export type Gender = (typeof GENDERS)[number];
export const genderSchema = z.enum(GENDERS);

export const GENDER_LABELS: Record<Gender, string> = {
  women: "Women",
  men: "Men",
};

/**
 * A sale price at or above the list price is NOT rejected here.
 *
 * Products imported from the storefront are already in that state, and an
 * import that cannot be re-saved is an import an operator cannot fix. The
 * condition surfaces as an inline warning in the editor and as a flagged row
 * on the Sale tab instead of a blocked save.
 */
export const productFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(2, "Give the product a title.")
      .max(140, "Keep the title under 140 characters."),
    slug: slugSchema,
    description: z
      .string()
      .trim()
      .max(8000, "That description is too long to store.")
      .optional()
      .transform((value) => value ?? ""),
    gender: genderSchema,
    categoryId: optionalId,
    status: productStatusSchema,
    isFeatured: booleanField,
    position: integerField(9999),
    pricePaise: requiredRupees,
    salePricePaise: optionalRupees,
    saleStartsAt: optionalDate("start"),
    saleEndsAt: optionalDate("end"),
    metaTitle: optionalText(160, "Keep the meta title under 160 characters."),
    metaDescription: optionalText(
      400,
      "Keep the meta description under 400 characters.",
    ),
  })
  .refine(
    (value) =>
      !value.saleStartsAt ||
      !value.saleEndsAt ||
      value.saleEndsAt > value.saleStartsAt,
    { message: "The sale must end after it starts.", path: ["saleEndsAt"] },
  );

export type ProductFormInput = z.infer<typeof productFormSchema>;

/**
 * Creating a product may also create its first colourway, because a product
 * with no variant has nothing to sell and no inventory row to sell it from.
 */
export const firstVariantSchema = z.object({
  firstVariantName: optionalText(80, "Keep the colourway name short."),
  firstVariantSku: optionalText(64, "Keep the SKU under 64 characters."),
});

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export const variantInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1, "Missing product."),
  name: z
    .string()
    .trim()
    .min(1, "Name the colourway.")
    .max(80, "Keep the name under 80 characters."),
  sku: optionalText(64, "Keep the SKU under 64 characters."),
  position: z.number().int("Position must be a whole number.").min(0).max(999),
  isActive: z.boolean(),
});

export type VariantInput = z.input<typeof variantInputSchema>;

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

const assetUrlSchema = z
  .string()
  .trim()
  .min(1, "Paste an image URL or a storefront path.")
  .max(1000, "That URL is too long.")
  .refine(
    (value) => value.startsWith("/") || /^https?:\/\//i.test(value),
    "Use a full https:// URL, or a path beginning with /.",
  );

export const addImageSchema = z.object({
  productId: z.string().trim().min(1, "Missing product."),
  url: assetUrlSchema,
  alt: optionalText(300, "Keep the alt text under 300 characters."),
  variantId: z
    .string()
    .trim()
    .nullish()
    .transform((value) => (value && value !== "none" ? value : null)),
});

export type AddImageInput = z.input<typeof addImageSchema>;

export const updateImageSchema = z.object({
  id: z.string().trim().min(1),
  alt: optionalText(300, "Keep the alt text under 300 characters."),
  position: z.number().int().min(0).max(999),
});

export type UpdateImageInput = z.input<typeof updateImageSchema>;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categoryInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z
    .string()
    .trim()
    .min(2, "Give the category a name.")
    .max(80, "Keep the name under 80 characters."),
  slug: slugSchema,
  parentId: z
    .string()
    .trim()
    .nullish()
    .transform((value) => (value && value !== "none" ? value : null)),
  description: optionalText(500, "Keep the description under 500 characters."),
  position: z.number().int().min(0).max(999),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
});

export type CategoryInput = z.input<typeof categoryInputSchema>;

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

const productIds = z
  .array(z.string().trim().min(1))
  .min(1, "Select at least one product.")
  .max(500, "That is more products than this store has.");

export const SALE_MODES = ["PERCENT", "FIXED"] as const;
export type SaleMode = (typeof SALE_MODES)[number];

export const bulkSaleSchema = z
  .object({
    productIds,
    mode: z.enum(SALE_MODES),
    /** Percent points when mode is PERCENT, rupees when it is FIXED. */
    value: z.number().finite("Enter a number."),
    startsAt: z
      .string()
      .trim()
      .nullish()
      .transform((value) => (value ? istStartOfDay(value) : null)),
    endsAt: z
      .string()
      .trim()
      .nullish()
      .transform((value) => (value ? istEndOfDay(value) : null)),
  })
  .refine(
    (input) =>
      input.mode !== "PERCENT" || (input.value >= 1 && input.value <= 95),
    { message: "Enter a discount between 1% and 95%.", path: ["value"] },
  )
  .refine((input) => input.mode !== "FIXED" || input.value > 0, {
    message: "Enter a sale price in rupees.",
    path: ["value"],
  })
  .refine(
    (input) => !input.startsAt || !input.endsAt || input.endsAt > input.startsAt,
    { message: "The sale must end after it starts.", path: ["endsAt"] },
  );

export type BulkSaleInput = z.input<typeof bulkSaleSchema>;

export const bulkStatusSchema = z.object({
  productIds,
  status: productStatusSchema,
});

export type BulkStatusInput = z.input<typeof bulkStatusSchema>;

export const productIdsSchema = z.object({ productIds });

// ---------------------------------------------------------------------------
// FormData readers
//
// The product editor posts a plain FormData. Reading it in one place keeps the
// "" versus undefined versus null distinction out of every action.
// ---------------------------------------------------------------------------

export function formValue(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readProductForm(formData: FormData) {
  return productFormSchema.safeParse({
    title: formValue(formData, "title"),
    slug: formValue(formData, "slug"),
    description: formValue(formData, "description"),
    gender: formValue(formData, "gender"),
    categoryId: formValue(formData, "categoryId"),
    status: formValue(formData, "status"),
    isFeatured: formValue(formData, "isFeatured"),
    position: formValue(formData, "position"),
    // An empty price must reach the schema as "" so it fails with "Enter an
    // amount in rupees" rather than silently becoming zero.
    pricePaise: formValue(formData, "price") ?? "",
    salePricePaise: formValue(formData, "salePrice"),
    saleStartsAt: formValue(formData, "saleStartsAt"),
    saleEndsAt: formValue(formData, "saleEndsAt"),
    metaTitle: formValue(formData, "metaTitle"),
    metaDescription: formValue(formData, "metaDescription"),
  });
}

export function readFirstVariant(formData: FormData) {
  return firstVariantSchema.safeParse({
    firstVariantName: formValue(formData, "firstVariantName"),
    firstVariantSku: formValue(formData, "firstVariantSku"),
  });
}
