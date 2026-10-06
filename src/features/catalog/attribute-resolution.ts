import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  isSelectType,
  resolveFromRows,
  type AttributeRow,
  type AttributeValueRow,
  type CategoryAttributeRow,
  type EffectiveAttribute,
} from "./attribute-resolution-core";

export * from "./attribute-resolution-core";

/**
 * Database wrappers around the pure resolver in ./attribute-resolution-core.
 * Kept apart so the resolver can be unit-tested without a DATABASE_URL and so
 * the seed can import the pure half without pulling in the Prisma client.
 */

type Db = Prisma.TransactionClient;

/** Ids root → leaf for a category, from its slug path. */
export async function categoryPathIds(categoryId: string | null, tx?: Db): Promise<string[]> {
  if (!categoryId) return [];
  const client = tx ?? db;
  const category = await client.category.findUnique({
    where: { id: categoryId },
    select: { id: true, path: true },
  });
  if (!category) return [];

  const segments = category.path.split("/").filter(Boolean);
  const prefixes = segments.map((_s, index) => `/${segments.slice(0, index + 1).join("/")}`);
  const rows = await client.category.findMany({
    where: { path: { in: prefixes } },
    select: { id: true, depth: true },
    orderBy: { depth: "asc" },
  });
  const ids = rows.map((row) => row.id);
  // Defensive: a path whose prefixes do not all resolve still ends at the target.
  return ids.includes(category.id) ? ids : [...ids, category.id];
}

async function loadRows(pathIds: readonly string[], tx?: Db) {
  const client = tx ?? db;
  const categoryAttributeRows: CategoryAttributeRow[] =
    pathIds.length > 0
      ? await client.categoryAttribute.findMany({
          where: { categoryId: { in: [...pathIds] } },
        })
      : [];

  const attributeIds = new Set(categoryAttributeRows.map((row) => row.attributeId));
  const attributes: AttributeRow[] = await client.attribute.findMany({
    where: {
      OR: [
        { isGlobal: true, isActive: true },
        ...(attributeIds.size > 0 ? [{ id: { in: [...attributeIds] } }] : []),
      ],
    },
    select: {
      id: true,
      code: true,
      name: true,
      inputType: true,
      filterType: true,
      unit: true,
      isVariantDefining: true,
      isFilterableDefault: true,
      isGlobal: true,
      position: true,
      isActive: true,
    },
  });

  const selectIds = attributes
    .filter((attribute) => isSelectType(attribute.inputType))
    .map((attribute) => attribute.id);
  const values: AttributeValueRow[] =
    selectIds.length > 0
      ? await client.attributeValue.findMany({
          where: { attributeId: { in: selectIds } },
          select: {
            id: true,
            attributeId: true,
            value: true,
            label: true,
            colorHex: true,
            position: true,
            isActive: true,
          },
        })
      : [];

  return { categoryAttributeRows, attributes, values };
}

export async function resolveCategoryAttributes(
  categoryId: string | null,
  tx?: Db,
): Promise<EffectiveAttribute[]> {
  const pathIds = await categoryPathIds(categoryId, tx);
  const rows = await loadRows(pathIds, tx);
  return resolveFromRows(pathIds, rows.categoryAttributeRows, rows.attributes, rows.values);
}

/** The effective set for a product's current category (globals only when uncategorised). */
export async function resolveForProduct(productId: string, tx?: Db): Promise<EffectiveAttribute[]> {
  const product = await (tx ?? db).product.findUnique({
    where: { id: productId },
    select: { categoryId: true },
  });
  return resolveCategoryAttributes(product?.categoryId ?? null, tx);
}

/** Lookup helpers used by facets, variants and validation. */
export function effectiveById(list: readonly EffectiveAttribute[]): Map<string, EffectiveAttribute> {
  return new Map(list.map((entry) => [entry.attribute.id, entry]));
}

export function effectiveByCode(list: readonly EffectiveAttribute[]): Map<string, EffectiveAttribute> {
  return new Map(list.map((entry) => [entry.attribute.code, entry]));
}
