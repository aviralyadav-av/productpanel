import type { EntityRef } from "@/components/shared/entity-picker";
import { isSelectType } from "@/features/catalog/attribute-resolution-core";

import type { EditorProduct, MediaRef } from "@/features/products/queries";
import type { AttributeValueInput, ProductFormInput } from "@/features/products/schemas";

/**
 * Client-side shape of the main product form. Numeric fields that may be
 * blank are kept as strings so a half-typed "12" never snaps to 0; the
 * conversion to the zod input happens once, in toFormInput(). Everything the
 * schema validates is validated again on the server with the same schema.
 */

export type AttributeFormValue = { valueIds: string[]; text: string; number: string; bool: boolean | null };

export type ProductFormState = {
  title: string;
  slug: string;
  baseSku: string;
  shortDescription: string;
  description: string;
  categoryId: string | null;
  sellerId: string | null;
  /** UI-only: the chip the seller picker renders; only `sellerId` is saved. */
  sellerRef: EntityRef | null;
  brand: string;
  tags: string[];
  pricePaise: number | null;
  salePricePaise: number | null;
  saleStartsAt: string;
  saleEndsAt: string;
  costPaise: number | null;
  taxRateBps: number | null;
  hsnCode: string;
  weightGrams: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  shippingNote: string;
  isFeatured: boolean;
  isNewArrival: boolean;
  isBestseller: boolean;
  isTrending: boolean;
  minOrderQty: string;
  maxOrderQty: string;
  position: string;
  videoUrl: string;
  videoMedia: MediaRef | null;
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string[];
  canonicalUrl: string;
  ogImage: MediaRef | null;
  customFields: Record<string, string>;
  attributeValues: Record<string, AttributeFormValue>;
};

export const EMPTY_ATTRIBUTE_VALUE: AttributeFormValue = { valueIds: [], text: "", number: "", bool: null };

export function emptyFormState(): ProductFormState {
  return {
    title: "",
    slug: "",
    baseSku: "",
    shortDescription: "",
    description: "",
    categoryId: null,
    sellerId: null,
    sellerRef: null,
    brand: "",
    tags: [],
    pricePaise: null,
    salePricePaise: null,
    saleStartsAt: "",
    saleEndsAt: "",
    costPaise: null,
    taxRateBps: null,
    hsnCode: "",
    weightGrams: "",
    lengthMm: "",
    widthMm: "",
    heightMm: "",
    shippingNote: "",
    isFeatured: false,
    isNewArrival: false,
    isBestseller: false,
    isTrending: false,
    minOrderQty: "1",
    maxOrderQty: "",
    position: "0",
    videoUrl: "",
    videoMedia: null,
    metaTitle: "",
    metaDescription: "",
    metaKeywords: [],
    canonicalUrl: "",
    ogImage: null,
    customFields: {},
    attributeValues: {},
  };
}

/** Date → value for <input type="datetime-local"> in the browser's zone. */
export function toDateTimeLocal(date: Date | string | null | undefined): string {
  if (!date) return "";
  const value = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

const str = (value: string | null | undefined) => value ?? "";
const numStr = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));

export function fromEditorProduct(product: EditorProduct): ProductFormState {
  const attributeValues: Record<string, AttributeFormValue> = {};
  for (const row of product.attributeValues) {
    if (row.fromVariants) continue;
    const current = attributeValues[row.attributeId] ?? { ...EMPTY_ATTRIBUTE_VALUE, valueIds: [] };
    if (row.valueId) current.valueIds = [...current.valueIds, row.valueId];
    if (row.textValue !== null) current.text = row.textValue;
    if (row.numberValue !== null) current.number = String(row.numberValue);
    if (row.boolValue !== null) current.bool = row.boolValue;
    attributeValues[row.attributeId] = current;
  }
  return {
    title: product.title,
    slug: product.slug,
    baseSku: str(product.baseSku),
    shortDescription: str(product.shortDescription),
    description: product.description,
    categoryId: product.categoryId,
    sellerId: product.sellerId,
    sellerRef: product.seller ? { id: product.seller.id, title: product.seller.displayName, subtitle: product.seller.status } : null,
    brand: str(product.brand),
    tags: product.tags,
    pricePaise: product.pricePaise,
    salePricePaise: product.salePricePaise,
    saleStartsAt: toDateTimeLocal(product.saleStartsAt),
    saleEndsAt: toDateTimeLocal(product.saleEndsAt),
    costPaise: product.costPaise,
    taxRateBps: product.taxRateBps,
    hsnCode: str(product.hsnCode),
    weightGrams: numStr(product.weightGrams),
    lengthMm: numStr(product.lengthMm),
    widthMm: numStr(product.widthMm),
    heightMm: numStr(product.heightMm),
    shippingNote: str(product.shippingNote),
    isFeatured: product.isFeatured,
    isNewArrival: product.isNewArrival,
    isBestseller: product.isBestseller,
    isTrending: product.isTrending,
    minOrderQty: String(product.minOrderQty),
    maxOrderQty: numStr(product.maxOrderQty),
    position: String(product.position),
    videoUrl: str(product.videoUrl),
    videoMedia: product.video,
    metaTitle: str(product.metaTitle),
    metaDescription: str(product.metaDescription),
    metaKeywords: product.metaKeywordList,
    canonicalUrl: str(product.canonicalUrl),
    ogImage: product.ogImage,
    customFields: (product.customFields as Record<string, string>) ?? {},
    attributeValues,
  };
}

/** "" stays "" (→ null in zod); a number-looking string becomes a number; anything else is passed through so zod reports it. */
function numberOrRaw(value: string): number | string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : trimmed;
}

function dateOrEmpty(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export type AttributeShape = { id: string; inputType: string };

/** Convert the form to the zod input. `attributes` says which input type each attribute has so the right column is sent. */
export function toFormInput(state: ProductFormState, attributes: readonly AttributeShape[]): ProductFormInput {
  const typeOf = new Map(attributes.map((attribute) => [attribute.id, attribute.inputType]));
  const attributeValues: AttributeValueInput[] = [];
  for (const [attributeId, value] of Object.entries(state.attributeValues)) {
    const inputType = typeOf.get(attributeId);
    if (!inputType) continue;
    if (isSelectType(inputType)) {
      if (value.valueIds.length > 0) attributeValues.push({ attributeId, valueIds: value.valueIds });
    } else if (inputType === "NUMBER") {
      if (value.number.trim() !== "") attributeValues.push({ attributeId, numberValue: Number(value.number) });
    } else if (inputType === "BOOLEAN") {
      if (value.bool !== null) attributeValues.push({ attributeId, boolValue: value.bool });
    } else if (value.text.trim() !== "") {
      attributeValues.push({ attributeId, textValue: value.text.trim() });
    }
  }

  return {
    title: state.title,
    slug: state.slug,
    baseSku: state.baseSku,
    shortDescription: state.shortDescription,
    description: state.description,
    categoryId: state.categoryId ?? "",
    sellerId: state.sellerId ?? "",
    brand: state.brand,
    tags: state.tags,
    pricePaise: state.pricePaise ?? (Number.NaN as number),
    salePricePaise: state.salePricePaise ?? "",
    saleStartsAt: dateOrEmpty(state.saleStartsAt),
    saleEndsAt: dateOrEmpty(state.saleEndsAt),
    costPaise: state.costPaise ?? "",
    taxRateBps: state.taxRateBps ?? "",
    hsnCode: state.hsnCode,
    weightGrams: numberOrRaw(state.weightGrams),
    lengthMm: numberOrRaw(state.lengthMm),
    widthMm: numberOrRaw(state.widthMm),
    heightMm: numberOrRaw(state.heightMm),
    shippingNote: state.shippingNote,
    isFeatured: state.isFeatured,
    isNewArrival: state.isNewArrival,
    isBestseller: state.isBestseller,
    isTrending: state.isTrending,
    minOrderQty: Number(state.minOrderQty) || 1,
    maxOrderQty: numberOrRaw(state.maxOrderQty),
    position: Number(state.position) || 0,
    videoUrl: state.videoUrl,
    videoMediaId: state.videoMedia?.id ?? "",
    metaTitle: state.metaTitle,
    metaDescription: state.metaDescription,
    metaKeywords: state.metaKeywords,
    canonicalUrl: state.canonicalUrl,
    ogImageMediaId: state.ogImage?.id ?? "",
    customFields: state.customFields,
    attributeValues,
  } as ProductFormInput;
}

/** Deep-equal on the serialisable parts, for dirty tracking. */
export function sameState(a: ProductFormState, b: ProductFormState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type FieldErrors = Record<string, string>;

/** Cost-based margin: (price − cost) / price. Null when either side is missing. */
export function marginPercent(pricePaise: number | null, costPaise: number | null): number | null {
  if (pricePaise === null || costPaise === null || pricePaise <= 0) return null;
  return Math.round(((pricePaise - costPaise) / pricePaise) * 1000) / 10;
}
