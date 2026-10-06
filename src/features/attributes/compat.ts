import {
  ATTRIBUTE_FILTER_TYPES,
  ATTRIBUTE_INPUT_TYPES,
  type AttributeFilterType,
  type AttributeInputType,
} from "@/lib/enums";

/**
 * Which storefront filter widget can render which input type (blueprint
 * §1 Attributes, A10). A NUMBER is a range slider, a COLOR is a swatch row,
 * a BOOLEAN is a toggle, the select types are checkbox or radio lists, and
 * free TEXT cannot be filtered at all. `NONE` is always allowed: "has a
 * value but is not a filter" is a legitimate spec-only attribute.
 *
 * Pure and client-safe so the form validates the pairing before it
 * round-trips and the server rejects the same pairings with the same words.
 */
export const COMPATIBLE_FILTER_TYPES: Record<AttributeInputType, readonly AttributeFilterType[]> = {
  SELECT: ["CHECKBOX", "RADIO", "NONE"],
  MULTI_SELECT: ["CHECKBOX", "RADIO", "NONE"],
  COLOR: ["COLOR_SWATCH", "NONE"],
  NUMBER: ["RANGE", "NONE"],
  BOOLEAN: ["TOGGLE", "NONE"],
  TEXT: ["NONE"],
};

export function isAttributeInputType(value: unknown): value is AttributeInputType {
  return typeof value === "string" && (ATTRIBUTE_INPUT_TYPES as readonly string[]).includes(value);
}

export function isAttributeFilterType(value: unknown): value is AttributeFilterType {
  return typeof value === "string" && (ATTRIBUTE_FILTER_TYPES as readonly string[]).includes(value);
}

export function isCompatibleFilterType(inputType: AttributeInputType, filterType: AttributeFilterType): boolean {
  return COMPATIBLE_FILTER_TYPES[inputType].includes(filterType);
}

/** The natural filter widget for an input type - what the form pre-selects when the type changes. */
export function defaultFilterTypeFor(inputType: AttributeInputType): AttributeFilterType {
  return COMPATIBLE_FILTER_TYPES[inputType][0];
}

/** Human sentence for a rejected pairing, shared by the form and the schema refinement. */
export function incompatibleFilterMessage(inputType: AttributeInputType, filterType: AttributeFilterType): string {
  const allowed = COMPATIBLE_FILTER_TYPES[inputType].filter((type) => type !== "NONE");
  return allowed.length === 0
    ? `${inputType} attributes cannot be filtered; choose "Not filterable".`
    : `${filterType} does not fit a ${inputType} attribute; use ${allowed.join(" or ")} (or "Not filterable").`;
}

/** Input types whose values are predefined AttributeValue rows (the Values panel applies). */
export function hasValueList(inputType: AttributeInputType): boolean {
  return inputType === "SELECT" || inputType === "MULTI_SELECT" || inputType === "COLOR";
}
