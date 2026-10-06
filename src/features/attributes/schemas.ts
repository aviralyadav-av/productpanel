import { z } from "zod";

import {
  attributeFilterTypeSchema,
  attributeInputTypeSchema,
  type AttributeFilterType,
  type AttributeInputType,
} from "@/lib/enums";
import { one, type SearchParams } from "@/lib/list-params";
import { hexColorSchema, optionalTextSchema, slugify, textSchema } from "@/lib/validation";

import { incompatibleFilterMessage, isCompatibleFilterType } from "./compat";

/**
 * Attribute and value inputs (blueprint §1 Attributes, §11.3-4, A1, A5).
 * Client-safe: the editor validates with these before it round-trips.
 */

export const attributeIdSchema = z
  .string()
  .trim()
  .min(1, "Missing id.")
  .max(64, "Invalid id.")
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid id.");

/**
 * Codes are the public filter keys (`attr[color]=red`), so they are locked
 * after creation - renaming one breaks every storefront link that uses it.
 * Lowercase letters, digits, underscore and hyphen; must start with a letter.
 */
export const attributeCodeSchema = z
  .string()
  .trim()
  .min(2, "Code needs at least 2 characters.")
  .max(60, "Code is too long.")
  .regex(/^[a-z][a-z0-9_-]*$/, "Use lowercase letters, digits, _ or -, starting with a letter.");

const positionSchema = z.coerce.number().int("Position must be a whole number.").min(0).max(100_000);

const attributeBaseSchema = z.object({
  code: attributeCodeSchema,
  name: textSchema(120, "Name"),
  description: optionalTextSchema(1_000),
  inputType: attributeInputTypeSchema.default("SELECT"),
  filterType: attributeFilterTypeSchema.default("CHECKBOX"),
  unit: optionalTextSchema(20),
  isVariantDefining: z.boolean().default(false),
  isFilterableDefault: z.boolean().default(true),
  isGlobal: z.boolean().default(false),
  position: positionSchema.default(0),
  isActive: z.boolean().default(true),
});

function refineCompat<T extends { inputType: AttributeInputType; filterType: AttributeFilterType; isVariantDefining: boolean }>(
  value: T,
  ctx: z.RefinementCtx,
) {
  if (!isCompatibleFilterType(value.inputType, value.filterType)) {
    ctx.addIssue({ code: "custom", path: ["filterType"], message: incompatibleFilterMessage(value.inputType, value.filterType) });
  }
  if (value.isVariantDefining && value.inputType !== "SELECT" && value.inputType !== "COLOR") {
    ctx.addIssue({
      code: "custom",
      path: ["isVariantDefining"],
      message: "Only single-select and colour attributes can define variants (A5).",
    });
  }
}

export const attributeInputSchema = attributeBaseSchema.superRefine(refineCompat);
export type AttributeInput = z.input<typeof attributeInputSchema>;
export type AttributeValues = z.output<typeof attributeInputSchema>;

/** PUT body: `code` is accepted but must equal the stored one (the service checks). */
export const attributePatchSchema = attributeBaseSchema.partial();
export type AttributePatch = z.output<typeof attributePatchSchema>;

export const attributeActiveSchema = z.object({ id: attributeIdSchema, value: z.boolean() });

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** Stored `value` is a slug of the label unless given; it is the public filter token. */
export const attributeValueTokenSchema = z
  .string()
  .trim()
  .min(1, "Value is required.")
  .max(80, "Value is too long.")
  .regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/, "Use lowercase letters, digits and single - _ . separators.");

export const attributeValueInputSchema = z.object({
  label: textSchema(120, "Label"),
  value: z.preprocess((raw) => (raw === "" || raw === undefined || raw === null ? undefined : raw), attributeValueTokenSchema.optional()),
  colorHex: z.preprocess((raw) => (raw === "" || raw === undefined ? null : raw), hexColorSchema.nullable()),
  position: positionSchema.optional(),
  isActive: z.boolean().default(true),
});
export type AttributeValueInput = z.input<typeof attributeValueInputSchema>;
export type AttributeValueValues = z.output<typeof attributeValueInputSchema>;

export const attributeValuePatchSchema = attributeValueInputSchema.partial();
export type AttributeValuePatch = z.output<typeof attributeValuePatchSchema>;

export const reorderValuesSchema = z.object({
  valueIds: z.array(attributeIdSchema).min(1, "Nothing to reorder.").max(500),
});

export function valueTokenFromLabel(label: string): string {
  return slugify(label).replace(/-+/g, "-").slice(0, 80) || "value";
}

// ---------------------------------------------------------------------------
// List vocabulary (URL)
// ---------------------------------------------------------------------------

export const ATTRIBUTE_SORTS = ["name", "code", "inputType", "position", "updatedAt", "createdAt"] as const;
export type AttributeSort = (typeof ATTRIBUTE_SORTS)[number];

export function resolveAttributeSort(raw: string | undefined): AttributeSort {
  return (ATTRIBUTE_SORTS as readonly string[]).includes(raw ?? "") ? (raw as AttributeSort) : "position";
}

export type AttributeListFilters = {
  inputType?: AttributeInputType;
  global?: boolean;
  active?: boolean;
};

export function parseAttributeListFilters(params: SearchParams | URLSearchParams): AttributeListFilters {
  const read = (key: string) => (params instanceof URLSearchParams ? params.get(key) ?? undefined : one(params, key));
  const type = read("type");
  const global = read("global");
  const active = read("active");
  const parsedType = attributeInputTypeSchema.safeParse(type);
  return {
    inputType: parsedType.success ? parsedType.data : undefined,
    global: global === "1" ? true : global === "0" ? false : undefined,
    active: active === "1" ? true : active === "0" ? false : undefined,
  };
}
