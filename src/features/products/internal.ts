import type { Prisma } from "@prisma/client";

import { notFound } from "@/lib/api/errors";
import { slugify } from "@/lib/validation";
import { isSelectType, resolveCategoryAttributes, effectiveById } from "@/features/catalog/attribute-resolution";
import { recomputeProductFacets } from "@/features/catalog/facets";
import { recomputeProductPricing } from "@/features/catalog/pricing";

import type { AttributeValueInput } from "./schemas";

/**
 * Helpers shared by the product service files (core, variants, images,
 * customisation, bulk). They take the caller's transaction and never open
 * one of their own, so every public service function stays a single unit of
 * work. No `server-only` / `next/*` imports - the check script and the seed
 * run these under plain tsx.
 */

export type Db = Prisma.TransactionClient;

export const PRODUCT_ENTITY = "product";

/** Everything the product service reads before deciding on a write. */
export const PRODUCT_CORE_SELECT = {
  id: true,
  slug: true,
  baseSku: true,
  title: true,
  shortDescription: true,
  description: true,
  categoryId: true,
  sellerId: true,
  brand: true,
  status: true,
  publishedAt: true,
  pricePaise: true,
  salePricePaise: true,
  saleStartsAt: true,
  saleEndsAt: true,
  costPaise: true,
  taxRateBps: true,
  hsnCode: true,
  weightGrams: true,
  lengthMm: true,
  widthMm: true,
  heightMm: true,
  shippingNote: true,
  isFeatured: true,
  isNewArrival: true,
  isBestseller: true,
  isTrending: true,
  isCustomizable: true,
  minOrderQty: true,
  maxOrderQty: true,
  position: true,
  videoUrl: true,
  videoMediaId: true,
  metaTitle: true,
  metaDescription: true,
  metaKeywords: true,
  canonicalUrl: true,
  ogImageMediaId: true,
  customFields: true,
  pricingRecomputedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

export type ProductCore = Prisma.ProductGetPayload<{ select: typeof PRODUCT_CORE_SELECT }>;

/** Load a live (not soft-deleted) product or throw 404. */
export async function loadProduct(tx: Db, id: string): Promise<ProductCore> {
  const product = await tx.product.findUnique({ where: { id }, select: PRODUCT_CORE_SELECT });
  if (!product || product.deletedAt) throw notFound("Product");
  return product;
}

/** Guard that a variant belongs to the product and is not soft-deleted. */
export async function loadVariant(tx: Db, productId: string, variantId: string) {
  const variant = await tx.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      productId: true,
      name: true,
      optionKey: true,
      sku: true,
      barcode: true,
      pricePaise: true,
      salePricePaise: true,
      costPaise: true,
      weightGrams: true,
      position: true,
      isActive: true,
      isDefault: true,
      deletedAt: true,
    },
  });
  if (!variant || variant.productId !== productId || variant.deletedAt) throw notFound("Variant");
  return variant;
}

// ---------------------------------------------------------------------------
// Slugs (§11.23, §11.34)
// ---------------------------------------------------------------------------

/**
 * On create a taken slug is auto-suffixed (-2, -3, ...); on edit the caller
 * asks with `exceptId` and gets `taken=true` so it can refuse explicitly.
 */
export async function resolveProductSlug(
  tx: Db,
  wanted: string,
  options: { exceptId?: string; autoSuffix: boolean },
): Promise<{ slug: string; taken: boolean }> {
  const base = slugify(wanted) || "product";
  const existing = await tx.product.findUnique({ where: { slug: base }, select: { id: true } });
  if (!existing || existing.id === options.exceptId) return { slug: base, taken: false };
  if (!options.autoSuffix) return { slug: base, taken: true };

  const siblings = await tx.product.findMany({
    where: { slug: { startsWith: `${base}-` } },
    select: { slug: true },
  });
  const used = new Set(siblings.map((row) => row.slug));
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!used.has(candidate)) return { slug: candidate, taken: false };
  }
  return { slug: `${base}-${Date.now()}`, taken: false };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** Replace the product's tag set; tags are upserted by slug so "Gift" and "gift" merge. */
export async function syncTags(tx: Db, productId: string, tags: readonly string[]): Promise<void> {
  const cleaned = new Map<string, string>();
  for (const raw of tags) {
    const name = raw.trim();
    const slug = slugify(name);
    if (slug && !cleaned.has(slug)) cleaned.set(slug, name);
  }
  const ids: string[] = [];
  for (const [slug, name] of cleaned) {
    const tag = await tx.tag.upsert({
      where: { slug },
      create: { slug, name },
      update: {},
      select: { id: true },
    });
    ids.push(tag.id);
  }
  await tx.product.update({
    where: { id: productId },
    data: { tags: { set: ids.map((id) => ({ id })) } },
  });
}

// ---------------------------------------------------------------------------
// Attribute values (A8)
// ---------------------------------------------------------------------------

export type AttributeValueWriteResult = { written: number; removed: number; unknownAttributes: string[] };

/**
 * Write the product's OWN attribute values (fromVariants=false).
 *
 * Select types store one row per chosen value (valueKey = valueId, so
 * MULTI_SELECT can hold several); scalar types store one row with
 * valueKey "_". Rows derived from variants are left alone - they are
 * rewritten by syncVariantAttributeRows. With `replace` every own row not in
 * the input is deleted, which is what the editor's full-form save wants;
 * without it only the attributes mentioned are touched (bulk SET_ATTRIBUTE).
 *
 * Values are checked against the attribute's definition, NOT the category's
 * effective set: A6 says values for attributes outside the category are kept,
 * so they must also be writable (the editor's "not in this category" list).
 */
export async function upsertAttributeValues(
  tx: Db,
  productId: string,
  inputs: readonly AttributeValueInput[],
  options: { replace: boolean },
): Promise<AttributeValueWriteResult> {
  const attributeIds = [...new Set(inputs.map((input) => input.attributeId))];
  const attributes = await tx.attribute.findMany({
    where: { id: { in: attributeIds } },
    select: { id: true, inputType: true, values: { select: { id: true } } },
  });
  const byId = new Map(attributes.map((attribute) => [attribute.id, attribute]));
  const unknownAttributes = attributeIds.filter((id) => !byId.has(id));

  const rows: Prisma.ProductAttributeValueCreateManyInput[] = [];
  const touched = new Set<string>();

  for (const input of inputs) {
    const attribute = byId.get(input.attributeId);
    if (!attribute) continue;
    touched.add(attribute.id);

    if (isSelectType(attribute.inputType)) {
      const allowed = new Set(attribute.values.map((value) => value.id));
      const picked = (input.valueIds ?? []).filter((valueId) => allowed.has(valueId));
      const limit = attribute.inputType === "MULTI_SELECT" ? picked.length : Math.min(1, picked.length);
      for (const valueId of picked.slice(0, limit)) {
        rows.push({ productId, attributeId: attribute.id, valueId, valueKey: valueId, fromVariants: false });
      }
      continue;
    }

    const scalar: Prisma.ProductAttributeValueCreateManyInput = {
      productId,
      attributeId: attribute.id,
      valueKey: "_",
      fromVariants: false,
    };
    if (attribute.inputType === "NUMBER") {
      if (input.numberValue === null || input.numberValue === undefined) continue;
      scalar.numberValue = input.numberValue;
    } else if (attribute.inputType === "BOOLEAN") {
      if (input.boolValue === null || input.boolValue === undefined) continue;
      scalar.boolValue = input.boolValue;
    } else {
      const text = input.textValue?.trim();
      if (!text) continue;
      scalar.textValue = text;
    }
    rows.push(scalar);
  }

  const removed = await tx.productAttributeValue.deleteMany({
    where: options.replace
      ? { productId, fromVariants: false }
      : { productId, fromVariants: false, attributeId: { in: [...touched] } },
  });

  // A variant-derived row may already hold the same (attribute, value); the
  // own row wins, so the derived duplicate is dropped before insert.
  if (rows.length > 0) {
    await tx.productAttributeValue.deleteMany({
      where: {
        productId,
        fromVariants: true,
        OR: rows.map((row) => ({ attributeId: row.attributeId, valueKey: row.valueKey })),
      },
    });
    await tx.productAttributeValue.createMany({ data: rows, skipDuplicates: true });
  }

  return { written: rows.length, removed: removed.count, unknownAttributes };
}

/** Drop every value (own or derived) the product holds for one attribute (A6 "Remove"). */
export async function removeAttributeValues(tx: Db, productId: string, attributeId: string): Promise<number> {
  const result = await tx.productAttributeValue.deleteMany({ where: { productId, attributeId } });
  return result.count;
}

/**
 * A8: after any variant change, rewrite the product rows derived from
 * variants so filters/facets read only ProductAttributeValue. Only live,
 * active variants contribute; an own row with the same key takes precedence.
 */
export async function syncVariantAttributeRows(tx: Db, productId: string): Promise<number> {
  await tx.productAttributeValue.deleteMany({ where: { productId, fromVariants: true } });

  const pairs = await tx.variantAttributeValue.findMany({
    where: { variant: { productId, isActive: true, deletedAt: null } },
    select: { attributeId: true, valueId: true },
    distinct: ["attributeId", "valueId"],
  });
  if (pairs.length === 0) return 0;

  const own = await tx.productAttributeValue.findMany({
    where: { productId, fromVariants: false, valueId: { not: null } },
    select: { attributeId: true, valueKey: true },
  });
  const ownKeys = new Set(own.map((row) => `${row.attributeId}:${row.valueKey}`));

  const rows = pairs
    .filter((pair) => !ownKeys.has(`${pair.attributeId}:${pair.valueId}`))
    .map((pair) => ({
      productId,
      attributeId: pair.attributeId,
      valueId: pair.valueId,
      valueKey: pair.valueId,
      fromVariants: true,
    }));
  if (rows.length > 0) await tx.productAttributeValue.createMany({ data: rows, skipDuplicates: true });
  return rows.length;
}

/**
 * The attribute ids the product's category treats as variant axes - what the
 * editor offers in the axes chooser and what manual variants may carry.
 */
export async function variantAxisAttributeIds(tx: Db, categoryId: string | null): Promise<Set<string>> {
  const effective = await resolveCategoryAttributes(categoryId, tx);
  return new Set(
    [...effectiveById(effective).values()]
      .filter((entry) => entry.isVariant && ["SELECT", "COLOR"].includes(entry.attribute.inputType))
      .map((entry) => entry.attribute.id),
  );
}

// ---------------------------------------------------------------------------
// Derived flags
// ---------------------------------------------------------------------------

/** `isCustomizable` is never edited by hand: it mirrors "has an active option". */
export async function syncCustomizableFlag(tx: Db, productId: string): Promise<boolean> {
  const active = await tx.customizationOption.count({ where: { productId, isActive: true } });
  const isCustomizable = active > 0;
  await tx.product.updateMany({
    where: { id: productId, isCustomizable: !isCustomizable },
    data: { isCustomizable },
  });
  return isCustomizable;
}

/** Make sure exactly one live variant is the default (the first active one wins). */
export async function ensureDefaultVariant(tx: Db, productId: string): Promise<string | null> {
  const live = await tx.productVariant.findMany({
    where: { productId, isActive: true, deletedAt: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, isDefault: true },
  });
  const defaults = live.filter((variant) => variant.isDefault);
  if (defaults.length === 1) return defaults[0].id;

  const chosen = defaults[0]?.id ?? live[0]?.id ?? null;
  await tx.productVariant.updateMany({
    where: { productId, isDefault: true, ...(chosen ? { id: { not: chosen } } : {}) },
    data: { isDefault: false },
  });
  if (chosen) await tx.productVariant.update({ where: { id: chosen }, data: { isDefault: true } });
  return chosen;
}

/** `${slug}-deleted-<ts>` frees the slug for reuse while keeping the row (§11.34). */
export function deletedSuffix(value: string, now = new Date()): string {
  return `${value}-deleted-${now.getTime()}`;
}

// ---------------------------------------------------------------------------
// Denormalised columns (A3, A4)
// ---------------------------------------------------------------------------

/** Facets and pricing depend on values, variants, stock and promotions - recompute after any of those change. */
export async function recomputeProduct(tx: Db, productId: string): Promise<void> {
  await recomputeProductFacets(tx, productId);
  await recomputeProductPricing(tx, { productIds: [productId] });
}
