import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { notFound } from "@/lib/api/errors";
import { enqueue } from "@/lib/queue";

/**
 * Reads and helpers shared by the category service files (service.ts,
 * attribute-assignments.ts). Kept apart so neither imports the other: the
 * public surface is re-exported from service.ts.
 */

export type Db = Prisma.TransactionClient;

export type ClientMeta = { ip?: string | null; userAgent?: string | null };

const RECOMPUTE_JOB = "catalog.recompute_subtree" as const;

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

export const CATEGORY_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  parentId: true,
  depth: true,
  path: true,
  position: true,
  isFeatured: true,
  isActive: true,
  imageMediaId: true,
  iconMediaId: true,
  bannerMediaId: true,
  iconName: true,
  metaTitle: true,
  metaDescription: true,
  metaKeywords: true,
  canonicalUrl: true,
  ogImageMediaId: true,
  noIndex: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategorySelect;

export type CategoryRecord = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

export async function getCategoryRecord(tx: Db | undefined, id: string): Promise<CategoryRecord | null> {
  return (tx ?? db).category.findUnique({ where: { id }, select: CATEGORY_SELECT });
}

export async function requireCategory(tx: Db, id: string): Promise<CategoryRecord> {
  const category = await getCategoryRecord(tx, id);
  if (!category) throw notFound("Category");
  return category;
}

export async function loadNodes(tx: Db) {
  return tx.category.findMany({ select: { id: true, parentId: true } });
}

/** Products in a category or anywhere below it, by the denormalised path (A3). */
export function subtreeProductWhere(path: string): Prisma.ProductWhereInput {
  return { OR: [{ categoryPath: path }, { categoryPath: { startsWith: `${path}/` } }] };
}

export type CategoryUsage = {
  children: number;
  /** Products attached directly (any status, including soft-deleted - the FK is Restrict). */
  products: number;
  /** Live products in the whole subtree. */
  subtreeProducts: number;
};

export async function categoryUsage(tx: Db | undefined, id: string): Promise<CategoryUsage> {
  const client = tx ?? db;
  const category = await client.category.findUnique({ where: { id }, select: { path: true } });
  if (!category) return { children: 0, products: 0, subtreeProducts: 0 };
  const [children, products, subtreeProducts] = await Promise.all([
    client.category.count({ where: { parentId: id } }),
    client.product.count({ where: { categoryId: id } }),
    client.product.count({ where: { deletedAt: null, ...subtreeProductWhere(category.path) } }),
  ]);
  return { children, products, subtreeProducts };
}

/**
 * Facets and pricing for every product under the category are rebuilt by the
 * worker (A6), not inline: a root category can hold thousands of products and
 * the operator should not wait on that. Deduped per category so ten quick
 * toggles queue one job.
 */
export async function queueSubtreeRecompute(tx: Db, categoryId: string): Promise<boolean> {
  const category = await tx.category.findUnique({ where: { id: categoryId }, select: { path: true } });
  if (!category) return false;
  const affected = await tx.product.count({ where: { deletedAt: null, ...subtreeProductWhere(category.path) } });
  if (affected === 0) return false;
  await enqueue(
    RECOMPUTE_JOB,
    { categoryId },
    { tx, dedupeKey: `${RECOMPUTE_JOB}:category:${categoryId}` },
  );
  return true;
}

