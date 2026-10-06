import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";
import type { PickedAsset } from "@/components/shared/media-picker";
import { rollupProductCounts } from "@/features/catalog/category-tree";
import { resolveCategoryAttributes, type EffectiveAttribute } from "@/features/catalog/attribute-resolution";
import { buildFacets, type FacetsPayload } from "@/features/catalog/facets";
import { resolveCommission, type ResolvedCommission } from "@/features/finance/service";
import { toMediaAssetDto, toPickedAsset } from "@/features/media/dto";

import {
  categoryUsage,
  getCategoryCommissionRule,
  getCategoryRecord,
  subtreeProductWhere,
  type CategoryCommissionRule,
  type CategoryRecord,
  type CategoryUsage,
} from "./service";

/**
 * Read side of the categories module: Server Components and the REST GET
 * handlers call these, never the service. Everything is shaped for the
 * screen that asks for it, so the tree page issues four queries regardless
 * of how many categories exist (A9: product counts are rolled up in memory,
 * never stored).
 */

type Db = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

export type CategoryTreeRow = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  path: string;
  depth: number;
  position: number;
  isActive: boolean;
  isFeatured: boolean;
  iconName: string | null;
  /** Display URL of the image (or icon media as fallback); null when neither is set. */
  imageUrl: string | null;
  /** Live products attached directly. */
  productCount: number;
  /** Live products here and anywhere below. */
  subtreeProductCount: number;
  childrenCount: number;
  /** Own, non-excluded attribute assignments on this category. */
  attributeCount: number;
  updatedAt: string;
};

/** Live products only: soft-deleted rows are invisible everywhere but the audit trail. */
const LIVE_PRODUCT_WHERE: Prisma.ProductWhereInput = { deletedAt: null };

export async function listCategoryTree(tx?: Db): Promise<CategoryTreeRow[]> {
  const client = tx ?? db;
  const [categories, productGroups, attributeGroups] = await Promise.all([
    client.category.findMany({
      orderBy: [{ depth: "asc" }, { position: "asc" }, { name: "asc" }],
      select: {
        id: true,
        parentId: true,
        name: true,
        slug: true,
        path: true,
        depth: true,
        position: true,
        isActive: true,
        isFeatured: true,
        iconName: true,
        updatedAt: true,
        image: { select: { url: true, thumbnailUrl: true } },
        icon: { select: { url: true, thumbnailUrl: true } },
      },
    }),
    client.product.groupBy({
      by: ["categoryId"],
      where: { ...LIVE_PRODUCT_WHERE, categoryId: { not: null } },
      _count: { _all: true },
    }),
    client.categoryAttribute.groupBy({
      by: ["categoryId"],
      where: { isExcluded: false },
      _count: { _all: true },
    }),
  ]);

  const direct = new Map<string, number>();
  for (const group of productGroups) {
    if (group.categoryId) direct.set(group.categoryId, group._count._all);
  }
  const rolled = rollupProductCounts(categories, direct);
  const attributeCounts = new Map(attributeGroups.map((group) => [group.categoryId, group._count._all]));
  const childrenCounts = new Map<string, number>();
  for (const category of categories) {
    if (category.parentId) childrenCounts.set(category.parentId, (childrenCounts.get(category.parentId) ?? 0) + 1);
  }

  return categories.map((category) => ({
    id: category.id,
    parentId: category.parentId,
    name: category.name,
    slug: category.slug,
    path: category.path,
    depth: category.depth,
    position: category.position,
    isActive: category.isActive,
    isFeatured: category.isFeatured,
    iconName: category.iconName,
    imageUrl:
      category.image?.thumbnailUrl ?? category.image?.url ?? category.icon?.thumbnailUrl ?? category.icon?.url ?? null,
    productCount: direct.get(category.id) ?? 0,
    subtreeProductCount: rolled[category.id] ?? 0,
    childrenCount: childrenCounts.get(category.id) ?? 0,
    attributeCount: attributeCounts.get(category.id) ?? 0,
    updatedAt: category.updatedAt.toISOString(),
  }));
}

export type CategoryTreeNode = CategoryTreeRow & { children: CategoryTreeNode[] };

/** `?tree=1` shape for the REST list: nested, siblings in position order. */
export function nestCategoryTree(rows: readonly CategoryTreeRow[]): CategoryTreeNode[] {
  const ids = new Set(rows.map((row) => row.id));
  const byParent = new Map<string | null, CategoryTreeRow[]>();
  for (const row of rows) {
    const parent = row.parentId && ids.has(row.parentId) ? row.parentId : null;
    const list = byParent.get(parent) ?? [];
    list.push(row);
    byParent.set(parent, list);
  }
  const build = (parentId: string | null): CategoryTreeNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
      .map((row) => ({ ...row, children: build(row.id) }));
  return build(null);
}

export type CategoryKpis = {
  total: number;
  active: number;
  featured: number;
  /** Live products with no category at all; they are invisible to category filters. */
  uncategorisedProducts: number;
};

export async function categoryKpis(): Promise<CategoryKpis> {
  const [total, active, featured, uncategorisedProducts] = await Promise.all([
    db.category.count(),
    db.category.count({ where: { isActive: true } }),
    db.category.count({ where: { isFeatured: true } }),
    db.product.count({ where: { ...LIVE_PRODUCT_WHERE, categoryId: null } }),
  ]);
  return { total, active, featured, uncategorisedProducts };
}

/** The minimum a parent picker needs; also what CategoryTreeSelect fetches from the REST list. */
export type CategoryOption = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  position: number;
  depth: number;
  isActive: boolean;
};

export async function listCategoryOptions(tx?: Db): Promise<CategoryOption[]> {
  return (tx ?? db).category.findMany({
    orderBy: [{ depth: "asc" }, { position: "asc" }, { name: "asc" }],
    select: { id: true, parentId: true, name: true, slug: true, position: true, depth: true, isActive: true },
  });
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export type CategoryMediaKey = "imageMediaId" | "iconMediaId" | "bannerMediaId" | "ogImageMediaId";
export type CategoryMedia = Record<CategoryMediaKey, PickedAsset | null>;

export type EffectiveCommission = ResolvedCommission & {
  /** Human label for where the effective rate comes from. */
  sourceLabel: string;
  /** The category (self or ancestor) that supplied a CATEGORY-scope rule. */
  sourceCategory: { id: string; name: string } | null;
};

export type CategoryEditorData = {
  category: CategoryRecord;
  media: CategoryMedia;
  usage: CategoryUsage;
  breadcrumb: Array<{ id: string; name: string; path: string }>;
  commission: { own: CategoryCommissionRule | null; effective: EffectiveCommission };
};

async function loadMedia(ids: Array<string | null>): Promise<Map<string, PickedAsset>> {
  const wanted = ids.filter((id): id is string => Boolean(id));
  if (wanted.length === 0) return new Map();
  const rows = await db.mediaAsset.findMany({ where: { id: { in: wanted } } });
  return new Map(rows.map((row) => [row.id, toPickedAsset(toMediaAssetDto(row))]));
}

async function effectiveCommissionFor(category: CategoryRecord): Promise<EffectiveCommission> {
  const resolved = await resolveCommission(undefined, { categoryId: category.id, categoryPath: category.path });
  if (resolved.scope !== "CATEGORY" || !resolved.ruleId) {
    return { ...resolved, sourceLabel: "Global default", sourceCategory: null };
  }
  const rule = await db.commissionRule.findUnique({
    where: { id: resolved.ruleId },
    select: { category: { select: { id: true, name: true } } },
  });
  const sourceCategory = rule?.category ?? null;
  return {
    ...resolved,
    sourceLabel:
      sourceCategory && sourceCategory.id !== category.id
        ? `Inherited from "${sourceCategory.name}"`
        : "This category's override",
    sourceCategory,
  };
}

export async function getCategoryEditor(id: string): Promise<CategoryEditorData | null> {
  const category = await getCategoryRecord(undefined, id);
  if (!category) return null;

  const segments = category.path.split("/").filter(Boolean);
  const prefixes = segments.map((_s, index) => `/${segments.slice(0, index + 1).join("/")}`);

  const [media, usage, own, effective, breadcrumb] = await Promise.all([
    loadMedia([category.imageMediaId, category.iconMediaId, category.bannerMediaId, category.ogImageMediaId]),
    categoryUsage(undefined, id),
    getCategoryCommissionRule(undefined, id),
    effectiveCommissionFor(category),
    db.category.findMany({
      where: { path: { in: prefixes } },
      orderBy: { depth: "asc" },
      select: { id: true, name: true, path: true },
    }),
  ]);

  return {
    category,
    media: {
      imageMediaId: category.imageMediaId ? media.get(category.imageMediaId) ?? null : null,
      iconMediaId: category.iconMediaId ? media.get(category.iconMediaId) ?? null : null,
      bannerMediaId: category.bannerMediaId ? media.get(category.bannerMediaId) ?? null : null,
      ogImageMediaId: category.ogImageMediaId ? media.get(category.ogImageMediaId) ?? null : null,
    },
    usage,
    breadcrumb,
    commission: { own, effective },
  };
}

// ---------------------------------------------------------------------------
// Attributes tab (A2)
// ---------------------------------------------------------------------------

export type EffectiveAttributeRow = EffectiveAttribute & {
  sourceCategoryName: string | null;
  /** Products / variants under this category carrying a value for the attribute (§11.3 warning). */
  usage: { products: number; variants: number };
};

export type ExcludedAttributeRow = {
  attributeId: string;
  name: string;
  code: string;
  inputType: string;
  valuesCount: number;
  /** True when this category's own row carries the exclusion (so "Include" can lift it). */
  ownExclusion: boolean;
};

export type CategoryAttributesTab = {
  effective: EffectiveAttributeRow[];
  excluded: ExcludedAttributeRow[];
  /** Active attributes not yet in the effective set - the "Add attribute" choices. */
  available: Array<{ id: string; name: string; code: string; inputType: string; isGlobal: boolean }>;
};

export async function getCategoryAttributesTab(categoryId: string): Promise<CategoryAttributesTab | null> {
  const category = await db.category.findUnique({ where: { id: categoryId }, select: { id: true, path: true } });
  if (!category) return null;

  const effective = await resolveCategoryAttributes(categoryId);
  const effectiveIds = new Set(effective.map((entry) => entry.attribute.id));
  const sourceIds = [...new Set(effective.map((entry) => entry.sourceCategoryId).filter((id): id is string => Boolean(id)))];
  const productWhere = { ...LIVE_PRODUCT_WHERE, ...subtreeProductWhere(category.path) };

  const [sources, ownExcluded, allAttributes, productGroups, variantGroups] = await Promise.all([
    sourceIds.length > 0
      ? db.category.findMany({ where: { id: { in: sourceIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    db.categoryAttribute.findMany({
      where: { categoryId, isExcluded: true },
      select: {
        attributeId: true,
        attribute: { select: { name: true, code: true, inputType: true, _count: { select: { values: true } } } },
      },
    }),
    db.attribute.findMany({
      where: { isActive: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true, inputType: true, isGlobal: true },
    }),
    db.productAttributeValue.groupBy({
      by: ["attributeId"],
      where: { fromVariants: false, product: productWhere },
      _count: { productId: true },
    }),
    db.variantAttributeValue.groupBy({
      by: ["attributeId"],
      where: { variant: { deletedAt: null, product: productWhere } },
      _count: { variantId: true },
    }),
  ]);

  const sourceName = new Map(sources.map((row) => [row.id, row.name]));
  const productUsage = new Map(productGroups.map((group) => [group.attributeId, group._count.productId]));
  const variantUsage = new Map(variantGroups.map((group) => [group.attributeId, group._count.variantId]));

  return {
    effective: effective.map((entry) => ({
      ...entry,
      sourceCategoryName: entry.sourceCategoryId ? sourceName.get(entry.sourceCategoryId) ?? null : null,
      usage: {
        products: productUsage.get(entry.attribute.id) ?? 0,
        variants: variantUsage.get(entry.attribute.id) ?? 0,
      },
    })),
    excluded: ownExcluded.map((row) => ({
      attributeId: row.attributeId,
      name: row.attribute.name,
      code: row.attribute.code,
      inputType: row.attribute.inputType,
      valuesCount: row.attribute._count.values,
      ownExclusion: true,
    })),
    available: allAttributes.filter((attribute) => !effectiveIds.has(attribute.id)),
  };
}

/**
 * The storefront's view of this category's filters: the SAME facet builder
 * the public API runs, over the same eligible-product rule, so what the
 * operator previews is what `/api/v1/products?category=` will return.
 */
export async function getCategoryFacetPreview(categoryId: string): Promise<FacetsPayload | null> {
  const category = await db.category.findUnique({ where: { id: categoryId }, select: { path: true } });
  if (!category) return null;
  const effective = await resolveCategoryAttributes(categoryId);
  const where: Prisma.ProductWhereInput = {
    status: "PUBLISHED",
    deletedAt: null,
    AND: [
      { OR: [{ sellerId: null }, { seller: { status: "ACTIVE", deletedAt: null } }] },
      subtreeProductWhere(category.path),
    ],
  };
  return buildFacets(undefined, { where, effectiveAttributes: effective });
}

// ---------------------------------------------------------------------------
// Products tab
// ---------------------------------------------------------------------------

export type CategoryProductRow = {
  id: string;
  title: string;
  slug: string;
  status: string;
  pricePaise: number;
  effectivePricePaise: number;
  imageUrl: string | null;
  sellerName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  /** True when the product sits in a descendant rather than this category itself. */
  fromDescendant: boolean;
  updatedAt: string;
};

export async function listCategoryProducts(
  categoryId: string,
  params: ListParams,
): Promise<{ rows: CategoryProductRow[]; meta: PageMeta } | null> {
  const category = await db.category.findUnique({ where: { id: categoryId }, select: { path: true } });
  if (!category) return null;
  const where: Prisma.ProductWhereInput = {
    ...LIVE_PRODUCT_WHERE,
    ...subtreeProductWhere(category.path),
    ...(params.q ? { title: { contains: params.q, mode: "insensitive" as const } } : {}),
  };
  const [total, rows] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: params.skip,
      take: params.pageSize,
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        pricePaise: true,
        effectivePricePaise: true,
        categoryId: true,
        updatedAt: true,
        category: { select: { name: true } },
        seller: { select: { displayName: true } },
        images: {
          where: { variantId: null },
          orderBy: [{ isPrimary: "desc" }, { position: "asc" }],
          take: 1,
          select: { media: { select: { thumbnailUrl: true, url: true } } },
        },
      },
    }),
  ]);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      status: row.status,
      pricePaise: row.pricePaise,
      effectivePricePaise: row.effectivePricePaise,
      imageUrl: row.images[0]?.media.thumbnailUrl ?? row.images[0]?.media.url ?? null,
      sellerName: row.seller?.displayName ?? null,
      categoryId: row.categoryId,
      categoryName: row.category?.name ?? null,
      fromDescendant: row.categoryId !== categoryId,
      updatedAt: row.updatedAt.toISOString(),
    })),
    meta: buildPageMeta(total, params),
  };
}

// ---------------------------------------------------------------------------
// Activity tab (D13 rows for this entity)
// ---------------------------------------------------------------------------

export type CategoryAuditRow = {
  id: string;
  action: string;
  summary: string;
  actorEmail: string;
  actorName: string | null;
  diff: unknown;
  createdAt: string;
};

export async function listCategoryActivity(categoryId: string, limit = 50): Promise<CategoryAuditRow[]> {
  const rows = await db.auditLog.findMany({
    where: { entityType: "Category", entityId: categoryId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      summary: true,
      actorEmail: true,
      diff: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    summary: row.summary,
    actorEmail: row.actorEmail,
    actorName: row.actor?.name ?? null,
    diff: row.diff,
    createdAt: row.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const CATEGORY_EXPORT_COLUMNS = [
  { key: "path", label: "Path" },
  { key: "name", label: "Name" },
  { key: "slug", label: "Slug" },
  { key: "depth", label: "Depth", type: "number" },
  { key: "isActive", label: "Active", type: "boolean" },
  { key: "isFeatured", label: "Featured", type: "boolean" },
  { key: "productCount", label: "Products (direct)", type: "number" },
  { key: "subtreeProductCount", label: "Products (incl. sub-categories)", type: "number" },
] as const;

/** Depth-first in tree order so the CSV reads like the sidebar does. */
export async function categoryExportRows(): Promise<Array<Record<string, unknown>>> {
  const rows = await listCategoryTree();
  const out: Array<Record<string, unknown>> = [];
  const walk = (nodes: CategoryTreeNode[]) => {
    for (const node of nodes) {
      out.push({
        path: node.path,
        name: node.name,
        slug: node.slug,
        depth: node.depth,
        isActive: node.isActive,
        isFeatured: node.isFeatured,
        productCount: node.productCount,
        subtreeProductCount: node.subtreeProductCount,
      });
      walk(node.children);
    }
  };
  walk(nestCategoryTree(rows));
  return out;
}
