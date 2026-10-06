import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { rollupProductCounts } from "@/features/catalog/category-tree";
import { resolveCategoryAttributes } from "@/features/catalog/attribute-resolution";
import {
  CATEGORY_NODE_SELECT,
  CATEGORY_SEO_SELECT,
  serializeCategoryChild,
  serializeCategoryNode,
  serializeCategorySeo,
  serializeBreadcrumb,
  type CategoryNodeRow,
  type PublicCategoryHeader,
  type PublicCategoryNode,
} from "@/lib/serializers/public";
import { categorySubtreeWhere, eligibleProductWhere } from "./shared";

/**
 * Category reads for `/api/v1/categories` and `/api/v1/categories/:slug`
 * (blueprint §5.3, §14.A9, A10).
 *
 * Product counts are never stored (A9): one `groupBy(categoryId)` over
 * eligible products, rolled up to every ancestor in memory along the tree.
 * Inactive categories are absent from the tree AND from the rollup, so a
 * hidden branch does not inflate its parent's count.
 */

type Db = Prisma.TransactionClient;

/** Direct eligible-product counts per categoryId, optionally restricted to a subtree. */
async function directProductCounts(client: Db, subtreePath?: string): Promise<Map<string, number>> {
  const grouped = await client.product.groupBy({
    by: ["categoryId"],
    where: eligibleProductWhere([
      { categoryId: { not: null } },
      ...(subtreePath ? [categorySubtreeWhere(subtreePath)] : []),
    ]),
    _count: { _all: true },
  });
  const counts = new Map<string, number>();
  for (const row of grouped) if (row.categoryId) counts.set(row.categoryId, row._count._all);
  return counts;
}

function nest(rows: readonly CategoryNodeRow[], totals: Record<string, number>): PublicCategoryNode[] {
  const active = new Set(rows.map((row) => row.id));
  const childrenOf = new Map<string | null, CategoryNodeRow[]>();
  for (const row of rows) {
    // A child of an inactive (hence unlisted) parent is hidden with its parent.
    const parentKey = row.parentId && active.has(row.parentId) ? row.parentId : row.parentId ? "__orphan__" : null;
    const list = childrenOf.get(parentKey) ?? [];
    list.push(row);
    childrenOf.set(parentKey, list);
  }
  const build = (parentId: string | null): PublicCategoryNode[] =>
    (childrenOf.get(parentId) ?? [])
      .slice()
      .sort((x, y) => x.position - y.position || x.name.localeCompare(y.name))
      .map((row) => serializeCategoryNode(row, totals[row.id] ?? 0, build(row.id)));
  return build(null);
}

/** GET /api/v1/categories - the full active tree with rolled-up counts. */
export async function getCategoryTree(tx?: Db): Promise<PublicCategoryNode[]> {
  const client = tx ?? db;
  const [rows, counts] = await Promise.all([
    client.category.findMany({
      where: { isActive: true },
      orderBy: [{ depth: "asc" }, { position: "asc" }, { name: "asc" }],
      select: CATEGORY_NODE_SELECT,
    }),
    directProductCounts(client),
  ]);
  const totals = rollupProductCounts(
    rows.map((row) => ({ id: row.id, parentId: row.parentId })),
    counts,
  );
  return nest(rows, totals);
}

/** Ancestors root → self from a materialised path, active only. */
export async function breadcrumbFor(
  client: Db,
  path: string,
): Promise<Array<{ id: string; slug: string; name: string; path: string }>> {
  const segments = path.split("/").filter(Boolean);
  const prefixes = segments.map((_s, index) => `/${segments.slice(0, index + 1).join("/")}`);
  const rows = await client.category.findMany({
    where: { path: { in: prefixes }, isActive: true },
    select: { id: true, slug: true, name: true, path: true, depth: true },
    orderBy: { depth: "asc" },
  });
  return rows.map(({ id, slug, name, path: rowPath }) => ({ id, slug, name, path: rowPath }));
}

export type CategoryHeaderResult = {
  id: string;
  path: string;
  header: PublicCategoryHeader;
};

/**
 * The lightweight header both `/categories/:slug` and `/products?include=category`
 * return (A10): the category, its breadcrumb and its active children with
 * subtree counts. Counts come from one groupBy limited to this subtree.
 */
export async function getCategoryHeader(slug: string, tx?: Db): Promise<CategoryHeaderResult | null> {
  const client = tx ?? db;
  const category = await client.category.findFirst({
    where: { slug, isActive: true },
    select: { ...CATEGORY_NODE_SELECT, ...CATEGORY_SEO_SELECT },
  });
  if (!category) return null;

  const [subtree, counts, breadcrumb] = await Promise.all([
    client.category.findMany({
      where: { isActive: true, OR: [{ id: category.id }, { path: { startsWith: `${category.path}/` } }] },
      select: CATEGORY_NODE_SELECT,
      orderBy: [{ position: "asc" }, { name: "asc" }],
    }),
    directProductCounts(client, category.path),
    breadcrumbFor(client, category.path),
  ]);

  const totals = rollupProductCounts(
    subtree.map((row) => ({ id: row.id, parentId: row.parentId })),
    counts,
  );
  const children = subtree
    .filter((row) => row.parentId === category.id)
    .map((row) => serializeCategoryChild(row, totals[row.id] ?? 0));

  const node = serializeCategoryNode(category, totals[category.id] ?? 0, []);
  return {
    id: category.id,
    path: category.path,
    header: {
      id: node.id,
      slug: node.slug,
      name: node.name,
      description: node.description,
      url: node.url,
      image: node.image,
      icon: node.icon,
      iconName: node.iconName,
      banner: node.banner,
      isFeatured: node.isFeatured,
      productCount: node.productCount,
      breadcrumb: serializeBreadcrumb(breadcrumb),
      children,
      seo: serializeCategorySeo(category),
    },
  };
}

export type PublicFilterAttribute = {
  code: string;
  name: string;
  filterType: string;
  inputType: string;
  unit: string | null;
  position: number;
};

export type PublicCategoryPage = {
  category: Omit<PublicCategoryHeader, "breadcrumb" | "children">;
  breadcrumb: PublicCategoryHeader["breadcrumb"];
  children: PublicCategoryHeader["children"];
  /** Which filters this category offers (A1 effective set); counts come from /products?include=facets. */
  filterAttributes: PublicFilterAttribute[];
};

/** GET /api/v1/categories/:slug */
export async function getCategoryPage(slug: string, tx?: Db): Promise<PublicCategoryPage | null> {
  const result = await getCategoryHeader(slug, tx);
  if (!result) return null;
  const effective = await resolveCategoryAttributes(result.id, tx);
  const { breadcrumb, children, ...category } = result.header;
  return {
    category,
    breadcrumb,
    children,
    filterAttributes: effective
      .filter((entry) => entry.isFilterable && entry.attribute.filterType !== "NONE")
      .map((entry) => ({
        code: entry.attribute.code,
        name: entry.attribute.name,
        filterType: entry.attribute.filterType,
        inputType: entry.attribute.inputType,
        unit: entry.attribute.unit,
        position: entry.position,
      })),
  };
}

/** Category tiles for the homepage `featured_categories` section. */
export async function getCategoryTiles(
  input: { source: "auto" | "manual"; categoryIds: readonly string[]; limit: number },
  tx?: Db,
): Promise<PublicCategoryNode[]> {
  const client = tx ?? db;
  const where: Prisma.CategoryWhereInput =
    input.source === "manual" ? { isActive: true, id: { in: [...input.categoryIds] } } : { isActive: true, isFeatured: true };
  const [rows, allNodes, counts] = await Promise.all([
    client.category.findMany({ where, select: CATEGORY_NODE_SELECT, orderBy: [{ position: "asc" }, { name: "asc" }] }),
    client.category.findMany({ where: { isActive: true }, select: { id: true, parentId: true } }),
    directProductCounts(client),
  ]);
  const totals = rollupProductCounts(allNodes, counts);
  const ordered =
    input.source === "manual"
      ? input.categoryIds.map((id) => rows.find((row) => row.id === id)).filter((row): row is CategoryNodeRow => Boolean(row))
      : rows;
  return ordered.slice(0, input.limit).map((row) => serializeCategoryNode(row, totals[row.id] ?? 0, []));
}
