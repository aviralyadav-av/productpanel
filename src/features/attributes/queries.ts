import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";

import type { AttributeListFilters, AttributeSort } from "./schemas";
import { attributeUsage, getAttributeRecord, type AttributeRecord, type AttributeUsage, type AttributeValueRecord } from "./service";

/**
 * Read side for /admin/attributes. Usage counts (categories, products,
 * variants) are the point of the list (A2): an operator deciding whether an
 * attribute can be retired needs to see at a glance where it is used.
 */

export type AttributeListRow = AttributeRecord & {
  valuesCount: number;
  categoriesCount: number;
  productsCount: number;
  variantsCount: number;
};

const SORT_COLUMN: Record<AttributeSort, keyof Prisma.AttributeOrderByWithRelationInput> = {
  name: "name",
  code: "code",
  inputType: "inputType",
  position: "position",
  updatedAt: "updatedAt",
  createdAt: "createdAt",
};

export function buildAttributeWhere(filters: AttributeListFilters, q: string): Prisma.AttributeWhereInput {
  const clauses: Prisma.AttributeWhereInput[] = [];
  if (filters.inputType) clauses.push({ inputType: filters.inputType });
  if (filters.global !== undefined) clauses.push({ isGlobal: filters.global });
  if (filters.active !== undefined) clauses.push({ isActive: filters.active });
  if (q) {
    clauses.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        { values: { some: { OR: [{ label: { contains: q, mode: "insensitive" } }, { value: { contains: q, mode: "insensitive" } }] } } },
      ],
    });
  }
  return clauses.length === 0 ? {} : { AND: clauses };
}

export type AttributeListResult = {
  rows: AttributeListRow[];
  meta: PageMeta;
  counts: { all: number; global: number; inactive: number };
};

export async function listAttributes(
  params: ListParams & { sort: AttributeSort },
  filters: AttributeListFilters,
): Promise<AttributeListResult> {
  const where = buildAttributeWhere(filters, params.q);
  const orderBy: Prisma.AttributeOrderByWithRelationInput[] =
    params.sort === "position"
      ? [{ position: params.order }, { name: "asc" }]
      : [{ [SORT_COLUMN[params.sort]]: params.order }, { id: "asc" }];

  const [total, rows, all, global, inactive] = await Promise.all([
    db.attribute.count({ where }),
    db.attribute.findMany({
      where,
      orderBy,
      skip: params.skip,
      take: params.pageSize,
      include: { _count: { select: { values: true, categoryAttributes: true, variantValues: { where: { variant: { deletedAt: null } } } } } },
    }),
    db.attribute.count(),
    db.attribute.count({ where: { isGlobal: true } }),
    db.attribute.count({ where: { isActive: false } }),
  ]);

  // Distinct products per attribute: one groupBy over the page's attributes.
  const ids = rows.map((row) => row.id);
  const productGroups =
    ids.length === 0
      ? []
      : await db.productAttributeValue.groupBy({
          by: ["attributeId", "productId"],
          where: { attributeId: { in: ids }, product: { deletedAt: null } },
        });
  const productCounts = new Map<string, number>();
  for (const group of productGroups) productCounts.set(group.attributeId, (productCounts.get(group.attributeId) ?? 0) + 1);

  return {
    rows: rows.map(({ _count, ...attribute }) => ({
      ...attribute,
      valuesCount: _count.values,
      categoriesCount: _count.categoryAttributes,
      productsCount: productCounts.get(attribute.id) ?? 0,
      variantsCount: _count.variantValues,
    })),
    meta: buildPageMeta(total, params),
    counts: { all, global, inactive },
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type AttributeValueRow = AttributeValueRecord & { usage: { products: number; variants: number } };

export type AttributeDetail = {
  attribute: AttributeRecord;
  values: AttributeValueRow[];
  usage: AttributeUsage;
};

export async function getAttributeDetail(id: string): Promise<AttributeDetail | null> {
  const attribute = await getAttributeRecord(undefined, id);
  if (!attribute) return null;

  const [values, usage, productGroups, variantGroups] = await Promise.all([
    db.attributeValue.findMany({
      where: { attributeId: id },
      orderBy: [{ position: "asc" }, { label: "asc" }],
      select: { id: true, attributeId: true, value: true, label: true, colorHex: true, position: true, isActive: true },
    }),
    attributeUsage(undefined, id),
    db.productAttributeValue.groupBy({
      by: ["valueId"],
      where: { attributeId: id, valueId: { not: null }, product: { deletedAt: null } },
      _count: { productId: true },
    }),
    db.variantAttributeValue.groupBy({
      by: ["valueId"],
      where: { attributeId: id, variant: { deletedAt: null } },
      _count: { variantId: true },
    }),
  ]);
  const productByValue = new Map(productGroups.map((group) => [group.valueId, group._count.productId]));
  const variantByValue = new Map(variantGroups.map((group) => [group.valueId, group._count.variantId]));

  return {
    attribute,
    values: values.map((value) => ({
      ...value,
      usage: { products: productByValue.get(value.id) ?? 0, variants: variantByValue.get(value.id) ?? 0 },
    })),
    usage,
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const ATTRIBUTE_EXPORT_COLUMNS = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "inputType", label: "Input type" },
  { key: "filterType", label: "Filter type" },
  { key: "unit", label: "Unit" },
  { key: "isGlobal", label: "Global", type: "boolean" },
  { key: "isVariantDefining", label: "Variant-defining", type: "boolean" },
  { key: "isFilterableDefault", label: "Filterable by default", type: "boolean" },
  { key: "isActive", label: "Active", type: "boolean" },
  { key: "position", label: "Position", type: "number" },
  { key: "valuesCount", label: "Values", type: "number" },
  { key: "values", label: "Value tokens" },
  { key: "categoriesCount", label: "Categories", type: "number" },
  { key: "updatedAt", label: "Updated", type: "date" },
] as const;

export async function attributeExportRows(filters: AttributeListFilters, q: string): Promise<Array<Record<string, unknown>>> {
  const rows = await db.attribute.findMany({
    where: buildAttributeWhere(filters, q),
    orderBy: [{ position: "asc" }, { name: "asc" }],
    take: 5_000,
    include: {
      _count: { select: { categoryAttributes: true } },
      values: { orderBy: { position: "asc" }, select: { value: true } },
    },
  });
  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    inputType: row.inputType,
    filterType: row.filterType,
    unit: row.unit,
    isGlobal: row.isGlobal,
    isVariantDefining: row.isVariantDefining,
    isFilterableDefault: row.isFilterableDefault,
    isActive: row.isActive,
    position: row.position,
    valuesCount: row.values.length,
    values: row.values.map((value) => value.value).join(", "),
    categoriesCount: row._count.categoryAttributes,
    updatedAt: row.updatedAt,
  }));
}
