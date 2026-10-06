import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  effectiveByCode,
  effectiveById,
  isSelectType,
  resolveCategoryAttributes,
  type EffectiveAttribute,
} from "./attribute-resolution";

/**
 * Facets (blueprint §14.A3, A8, A10).
 *
 * Filtering a catalogue by attribute is the client's core requirement, and it
 * has to be fast for the storefront. So every product carries a denormalised
 * `facetValueIds` array - the union of its own select-type values and those of
 * its in-stock active variants, restricted to the attributes its category
 * actually uses - with a GIN index. A filter is then `hasSome` on that array
 * and a facet count is one `unnest ... GROUP BY`. The array is rebuilt by
 * `recomputeProductFacets` whenever anything that feeds it changes; nothing
 * edits it by hand.
 */

type Db = Prisma.TransactionClient;

export type AttrFilter = string[] | { min?: number; max?: number };
export type AttrFilters = Record<string, AttrFilter>;

// ---------------------------------------------------------------------------
// Denormalised columns
// ---------------------------------------------------------------------------

export async function recomputeProductFacets(
  tx: Db,
  productId: string,
): Promise<{ facetValueIds: string[]; categoryPath: string | null }> {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      categoryId: true,
      category: { select: { path: true } },
      attributeValues: {
        select: { attributeId: true, valueId: true, fromVariants: true },
      },
      variants: {
        where: { isActive: true, deletedAt: null },
        select: {
          id: true,
          attributeValues: { select: { attributeId: true, valueId: true } },
          inventory: { select: { available: true, allowBackorder: true } },
        },
      },
    },
  });
  if (!product) return { facetValueIds: [], categoryPath: null };

  const effective = effectiveById(await resolveCategoryAttributes(product.categoryId, tx));

  // A8: the product's rows derived from variants are rewritten wholesale so
  // filters that read only ProductAttributeValue stay in step with variants.
  await tx.productAttributeValue.deleteMany({ where: { productId, fromVariants: true } });

  const manualKeys = new Set(
    product.attributeValues
      .filter((row) => !row.fromVariants && row.valueId)
      .map((row) => `${row.attributeId}:${row.valueId}`),
  );
  const derived = new Map<string, { attributeId: string; valueId: string }>();
  for (const variant of product.variants) {
    for (const value of variant.attributeValues) {
      const key = `${value.attributeId}:${value.valueId}`;
      if (manualKeys.has(key) || derived.has(key)) continue;
      derived.set(key, { attributeId: value.attributeId, valueId: value.valueId });
    }
  }
  if (derived.size > 0) {
    await tx.productAttributeValue.createMany({
      data: [...derived.values()].map((row) => ({
        productId,
        attributeId: row.attributeId,
        valueId: row.valueId,
        valueKey: row.valueId,
        fromVariants: true,
      })),
      skipDuplicates: true,
    });
  }

  // A3: product-level values always count; variant values only while the
  // variant can actually be bought.
  const facetValueIds = new Set<string>();
  for (const row of product.attributeValues) {
    if (row.valueId && !row.fromVariants && effective.has(row.attributeId)) {
      facetValueIds.add(row.valueId);
    }
  }
  for (const variant of product.variants) {
    const inStock =
      (variant.inventory?.available ?? 0) > 0 || variant.inventory?.allowBackorder === true;
    if (!inStock) continue;
    for (const value of variant.attributeValues) {
      if (effective.has(value.attributeId)) facetValueIds.add(value.valueId);
    }
  }

  const categoryPath = product.category?.path ?? null;
  await tx.product.update({
    where: { id: productId },
    data: { facetValueIds: [...facetValueIds].sort(), categoryPath },
  });

  return { facetValueIds: [...facetValueIds].sort(), categoryPath };
}

/**
 * Job handler body for `catalog.recompute_subtree` (A6 and the stock hook in
 * inventory/service.ts): rebuild facets and pricing for every product under a
 * category, or for an explicit product list.
 */
export async function catalogRecomputeSubtreeJob(payload: {
  categoryId?: string;
  productIds?: string[];
}): Promise<{ products: number }> {
  const { recomputeProductPricing } = await import("./pricing");

  let productIds = payload.productIds ?? [];
  if (payload.categoryId) {
    const category = await db.category.findUnique({
      where: { id: payload.categoryId },
      select: { path: true },
    });
    if (category) {
      const rows = await db.product.findMany({
        where: {
          deletedAt: null,
          OR: [{ categoryPath: category.path }, { categoryPath: { startsWith: `${category.path}/` } }],
        },
        select: { id: true },
      });
      productIds = [...new Set([...productIds, ...rows.map((row) => row.id)])];
    }
  }

  const CHUNK = 50;
  for (let index = 0; index < productIds.length; index += CHUNK) {
    const chunk = productIds.slice(index, index + CHUNK);
    await db.$transaction(
      async (tx) => {
        for (const productId of chunk) await recomputeProductFacets(tx, productId);
        await recomputeProductPricing(tx, { productIds: chunk });
      },
      { timeout: 60_000 },
    );
  }
  return { products: productIds.length };
}

// ---------------------------------------------------------------------------
// Query-string parsing and where fragments
// ---------------------------------------------------------------------------

const ATTR_KEY = /^attr\[([A-Za-z0-9_-]+)\]$/;

/** `attr[color]=red,blue&attr[weight]=100..500` → { color: ["red","blue"], weight: { min, max } } */
export function parseAttrFilters(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>,
): AttrFilters {
  const entries: Array<[string, string]> = [];
  if (searchParams instanceof URLSearchParams) {
    for (const [key, value] of searchParams.entries()) entries.push([key, value]);
  } else {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) entries.push([key, item]);
    }
  }

  const filters: AttrFilters = {};
  for (const [key, raw] of entries) {
    const match = ATTR_KEY.exec(key);
    if (!match) continue;
    const code = match[1];
    const value = raw.trim();
    if (!value) continue;

    if (value.includes("..")) {
      const [lo, hi] = value.split("..", 2);
      const min = lo.trim() === "" ? undefined : Number(lo);
      const max = hi.trim() === "" ? undefined : Number(hi);
      const range: { min?: number; max?: number } = {};
      if (min !== undefined && Number.isFinite(min)) range.min = min;
      if (max !== undefined && Number.isFinite(max)) range.max = max;
      if (range.min !== undefined || range.max !== undefined) filters[code] = range;
      continue;
    }

    const values = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const existing = filters[code];
    filters[code] = Array.isArray(existing) ? [...new Set([...existing, ...values])] : values;
  }
  return filters;
}

/**
 * Where fragments for the parsed filters: OR within an attribute (`hasSome`),
 * AND across attributes; RANGE attributes read `ProductAttributeValue.numberValue`;
 * TOGGLE attributes read `boolValue`. Values may be given as the value slug or
 * the value id. Unknown codes and unknown values are ignored, never errors -
 * a stale link should show an unfiltered list, not a 400.
 */
export function buildAttrWhere(
  filters: AttrFilters,
  effective: ReadonlyMap<string, EffectiveAttribute> | readonly EffectiveAttribute[],
): Prisma.ProductWhereInput[] {
  const byCode: ReadonlyMap<string, EffectiveAttribute> = Array.isArray(effective)
    ? effectiveByCode(effective as readonly EffectiveAttribute[])
    : (effective as ReadonlyMap<string, EffectiveAttribute>);
  const where: Prisma.ProductWhereInput[] = [];

  for (const [code, filter] of Object.entries(filters)) {
    const entry = byCode.get(code);
    if (!entry) continue;
    const { attribute } = entry;

    if (!Array.isArray(filter)) {
      if (attribute.inputType !== "NUMBER") continue;
      const numberValue: Prisma.FloatNullableFilter = {};
      if (filter.min !== undefined) numberValue.gte = filter.min;
      if (filter.max !== undefined) numberValue.lte = filter.max;
      where.push({ attributeValues: { some: { attributeId: attribute.id, numberValue } } });
      continue;
    }

    if (attribute.inputType === "BOOLEAN") {
      const wanted = filter.some((value) => ["1", "true", "yes"].includes(value.toLowerCase()));
      where.push({ attributeValues: { some: { attributeId: attribute.id, boolValue: wanted } } });
      continue;
    }

    if (!isSelectType(attribute.inputType)) continue;
    const ids = entry.values
      .filter((value) => filter.includes(value.value) || filter.includes(value.id))
      .map((value) => value.id);
    if (ids.length === 0) continue;
    where.push({ facetValueIds: { hasSome: ids } });
  }

  return where;
}

// ---------------------------------------------------------------------------
// Facet payload (A10)
// ---------------------------------------------------------------------------

export type FacetValue = { value: string; label: string; colorHex: string | null; count: number };

export type Facet = {
  code: string;
  name: string;
  filterType: string;
  inputType: string;
  unit: string | null;
  position: number;
  values?: FacetValue[];
  range?: { min: number; max: number; unit: string | null };
};

export type FacetsPayload = {
  facets: Facet[];
  builtinFacets: {
    availability: { inStock: number };
    customizable: { count: number };
    sellers: Array<{ id: string; slug: string; name: string; count: number }>;
    rating: Array<{ min: number; count: number }>;
  };
  /** Paise; the public serializer converts to rupees. */
  priceRangePaise: { min: number; max: number } | null;
  total: number;
};

/**
 * Counts are computed against the FULL current where (v1 semantics): a
 * selected value narrows every facet including its own, and values with a
 * zero count disappear unless they are selected.
 */
export async function buildFacets(
  tx: Db | undefined,
  input: {
    where: Prisma.ProductWhereInput;
    effectiveAttributes: readonly EffectiveAttribute[];
    selected?: AttrFilters;
  },
): Promise<FacetsPayload> {
  const client = tx ?? db;
  const selected = input.selected ?? {};

  const matched = await client.product.findMany({
    where: input.where,
    select: { id: true, facetValueIds: true, effectivePricePaise: true, isCustomizable: true, sellerId: true, ratingAvg: true },
  });
  const ids = matched.map((row) => row.id);

  const filterable = input.effectiveAttributes.filter(
    (entry) => entry.isFilterable && entry.attribute.filterType !== "NONE",
  );
  const rangeAttributeIds = filterable
    .filter((entry) => entry.attribute.inputType === "NUMBER")
    .map((entry) => entry.attribute.id);

  const [valueCounts, ranges] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          client.$queryRaw<Array<{ valueId: string; count: number }>>`
            SELECT v AS "valueId", count(*)::int AS count
              FROM "Product" p, unnest(p."facetValueIds") AS v
             WHERE p.id IN (${Prisma.join(ids)})
             GROUP BY v`,
          rangeAttributeIds.length === 0
            ? Promise.resolve([] as Array<{ attributeId: string; min: number; max: number }>)
            : client.$queryRaw<Array<{ attributeId: string; min: number; max: number }>>`
                SELECT "attributeId", min("numberValue")::float8 AS min, max("numberValue")::float8 AS max
                  FROM "ProductAttributeValue"
                 WHERE "productId" IN (${Prisma.join(ids)})
                   AND "attributeId" IN (${Prisma.join(rangeAttributeIds)})
                   AND "numberValue" IS NOT NULL
                 GROUP BY "attributeId"`,
        ]);

  const countByValue = new Map(valueCounts.map((row) => [row.valueId, Number(row.count)]));
  const rangeByAttribute = new Map(ranges.map((row) => [row.attributeId, row]));

  const facets: Facet[] = [];
  for (const entry of filterable) {
    const { attribute } = entry;
    const base = {
      code: attribute.code,
      name: attribute.name,
      filterType: attribute.filterType,
      inputType: attribute.inputType,
      unit: attribute.unit,
      position: entry.position,
    };

    if (attribute.inputType === "NUMBER") {
      const range = rangeByAttribute.get(attribute.id);
      if (range) facets.push({ ...base, range: { min: range.min, max: range.max, unit: attribute.unit } });
      continue;
    }
    if (!isSelectType(attribute.inputType)) continue;

    const chosen = selected[attribute.code];
    const chosenSet = new Set(Array.isArray(chosen) ? chosen : []);
    const values = entry.values
      .map((value) => ({
        value: value.value,
        label: value.label ?? value.value,
        colorHex: value.colorHex,
        count: countByValue.get(value.id) ?? 0,
      }))
      .filter((value) => value.count > 0 || chosenSet.has(value.value));
    if (values.length > 0) facets.push({ ...base, values });
  }

  // Built-ins over the same matched set.
  const sellerCounts = new Map<string, number>();
  const ratingBuckets = [4, 3, 2, 1].map((min) => ({ min, count: 0 }));
  let customizable = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const row of matched) {
    if (row.isCustomizable) customizable += 1;
    if (row.sellerId) sellerCounts.set(row.sellerId, (sellerCounts.get(row.sellerId) ?? 0) + 1);
    for (const bucket of ratingBuckets) if (row.ratingAvg >= bucket.min) bucket.count += 1;
    if (row.effectivePricePaise < min) min = row.effectivePricePaise;
    if (row.effectivePricePaise > max) max = row.effectivePricePaise;
  }

  const inStock =
    ids.length === 0
      ? 0
      : await client.product.count({
          where: {
            id: { in: ids },
            variants: {
              some: {
                isActive: true,
                deletedAt: null,
                inventory: { OR: [{ available: { gt: 0 } }, { allowBackorder: true }] },
              },
            },
          },
        });

  const sellers =
    sellerCounts.size === 0
      ? []
      : (
          await client.seller.findMany({
            where: { id: { in: [...sellerCounts.keys()] } },
            select: { id: true, slug: true, displayName: true },
          })
        )
          .map((seller) => ({
            id: seller.id,
            slug: seller.slug,
            name: seller.displayName,
            count: sellerCounts.get(seller.id) ?? 0,
          }))
          .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));

  return {
    facets,
    builtinFacets: {
      availability: { inStock },
      customizable: { count: customizable },
      sellers,
      rating: ratingBuckets.filter((bucket) => bucket.count > 0),
    },
    priceRangePaise: ids.length === 0 ? null : { min, max },
    total: ids.length,
  };
}
