import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue";

/**
 * Category tree maintenance (blueprint §11.1-2, A6, A9, G5).
 *
 * `Category.path` is a slug-based materialised path ("/fashion/kurta") and
 * `depth` its segment count minus one. Both are derived, never edited by hand,
 * and `Product.categoryPath` is a copy for descendant-inclusive listing. A
 * move or a slug change therefore rewrites the whole subtree in one
 * transaction - a half-updated tree would make some products invisible under
 * their own category.
 */

type Db = Prisma.TransactionClient;

export class CategoryTreeError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "CYCLE" | "SELF_PARENT",
    message: string,
  ) {
    super(message);
    this.name = "CategoryTreeError";
  }
}

export function buildPath(parentPath: string | null | undefined, slug: string): string {
  const base = parentPath && parentPath !== "/" ? parentPath.replace(/\/+$/, "") : "";
  return `${base}/${slug}`;
}

export function depthOfPath(path: string): number {
  return Math.max(0, path.split("/").filter(Boolean).length - 1);
}

type TreeNode = { id: string; parentId: string | null };

/** Would setting `parentId` on `id` create a loop? Pure, over an in-memory node list. */
export function wouldCreateCycle(
  id: string,
  parentId: string | null,
  nodes: readonly TreeNode[],
): boolean {
  if (!parentId) return false;
  if (parentId === id) return true;
  const parentById = new Map(nodes.map((node) => [node.id, node.parentId]));
  let cursor: string | null | undefined = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === id) return true;
    if (seen.has(cursor)) return true; // already broken - refuse to make it worse
    seen.add(cursor);
    cursor = parentById.get(cursor);
  }
  return false;
}

/**
 * Product counts rolled up the tree (A9: never stored). `countsByCategoryId`
 * is a `groupBy(categoryId)` over eligible products; the result adds every
 * descendant's count to each ancestor.
 */
export function rollupProductCounts(
  categories: readonly TreeNode[],
  countsByCategoryId: Readonly<Record<string, number>> | ReadonlyMap<string, number>,
): Record<string, number> {
  const direct = (id: string) =>
    countsByCategoryId instanceof Map
      ? (countsByCategoryId as ReadonlyMap<string, number>).get(id) ?? 0
      : ((countsByCategoryId as Record<string, number>)[id] ?? 0);

  const parentById = new Map(categories.map((node) => [node.id, node.parentId]));
  const totals: Record<string, number> = {};
  for (const node of categories) totals[node.id] = 0;

  for (const node of categories) {
    const count = direct(node.id);
    if (count === 0) continue;
    let cursor: string | null | undefined = node.id;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      totals[cursor] = (totals[cursor] ?? 0) + count;
      cursor = parentById.get(cursor);
    }
  }
  return totals;
}

/** Every category strictly below `categoryId`, by path prefix. */
export async function descendantIds(tx: Db | undefined, categoryId: string): Promise<string[]> {
  const client = tx ?? db;
  const category = await client.category.findUnique({
    where: { id: categoryId },
    select: { path: true },
  });
  if (!category) return [];
  const rows = await client.category.findMany({
    where: { path: { startsWith: `${category.path}/` } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * Recompute path/depth for `categoryId` and everything under it from the
 * current slugs and parent links, then copy the new paths onto the products.
 * Returns the categories touched.
 */
export async function recomputeSubtreePaths(
  tx: Db,
  categoryId: string,
): Promise<{ categories: number; products: number }> {
  const root = await tx.category.findUnique({
    where: { id: categoryId },
    select: { id: true, slug: true, parentId: true, path: true },
  });
  if (!root) throw new CategoryTreeError("NOT_FOUND", "Category not found.");

  const parent = root.parentId
    ? await tx.category.findUnique({ where: { id: root.parentId }, select: { path: true } })
    : null;

  // Load the old subtree by the OLD path so a slug change still finds it.
  const subtree = await tx.category.findMany({
    where: { OR: [{ id: root.id }, { path: { startsWith: `${root.path}/` } }] },
    select: { id: true, slug: true, parentId: true },
  });
  const childrenOf = new Map<string, Array<{ id: string; slug: string }>>();
  for (const node of subtree) {
    if (!node.parentId) continue;
    const list = childrenOf.get(node.parentId) ?? [];
    list.push(node);
    childrenOf.set(node.parentId, list);
  }

  // Paths are unique, so writes go leaf-first with temporary values? No: a
  // rename never produces a path that another live category already holds
  // (the parent's path is new too), so a top-down walk is safe.
  const updates: Array<{ id: string; path: string; depth: number }> = [];
  const walk = (id: string, slug: string, parentPath: string | null) => {
    const path = buildPath(parentPath, slug);
    updates.push({ id, path, depth: depthOfPath(path) });
    for (const child of childrenOf.get(id) ?? []) walk(child.id, child.slug, path);
  };
  walk(root.id, root.slug, parent?.path ?? null);

  // Two passes: first move everyone to a unique temporary path so a subtree
  // that swaps places with a sibling never collides on the unique index. The
  // placeholder must be unique per row AND impossible for a real path to equal
  // - every real path starts with "/" (buildPath), so a "tmp:" prefix is safe.
  // (It must also stay printable: Postgres rejects a NUL byte in a text column
  // with 22021, which is what an earlier "\0" prefix here did.)
  for (const update of updates) {
    await tx.category.update({ where: { id: update.id }, data: { path: `tmp:${update.id}` } });
  }
  let products = 0;
  for (const update of updates) {
    await tx.category.update({
      where: { id: update.id },
      data: { path: update.path, depth: update.depth },
    });
    const result = await tx.product.updateMany({
      where: { categoryId: update.id },
      data: { categoryPath: update.path },
    });
    products += result.count;
  }

  return { categories: updates.length, products };
}

/**
 * Re-parent and/or reposition a category. Rejects cycles, recomputes the
 * subtree and queues the facet/pricing recompute for its products (A6).
 */
export async function moveCategory(
  tx: Db,
  input: { id: string; parentId: string | null; position: number },
): Promise<{ categories: number; products: number }> {
  if (input.parentId === input.id) {
    throw new CategoryTreeError("SELF_PARENT", "A category cannot be its own parent.");
  }
  const nodes = await tx.category.findMany({ select: { id: true, parentId: true } });
  if (!nodes.some((node) => node.id === input.id)) {
    throw new CategoryTreeError("NOT_FOUND", "Category not found.");
  }
  if (input.parentId && !nodes.some((node) => node.id === input.parentId)) {
    throw new CategoryTreeError("NOT_FOUND", "Parent category not found.");
  }
  if (wouldCreateCycle(input.id, input.parentId, nodes)) {
    throw new CategoryTreeError("CYCLE", "A category cannot be moved under its own descendant.");
  }

  await tx.category.update({
    where: { id: input.id },
    data: { parentId: input.parentId, position: input.position },
  });
  const result = await recomputeSubtreePaths(tx, input.id);

  if (result.products > 0) {
    await enqueue(
      "catalog.recompute_subtree",
      { categoryId: input.id },
      { tx, dedupeKey: `catalog.recompute_subtree:category:${input.id}` },
    );
  }
  return result;
}

export type ReorderMove = { id: string; parentId: string | null; position: number };

/**
 * Apply a batch of drag-and-drop moves (G5). Every move is validated against
 * the tree AS IT WILL BE after the whole batch, then positions are written and
 * each distinct moved root has its subtree recomputed once.
 */
export async function applyReorderMoves(
  tx: Db,
  moves: readonly ReorderMove[],
): Promise<{ moved: number; categories: number; products: number }> {
  if (moves.length === 0) return { moved: 0, categories: 0, products: 0 };

  const nodes = await tx.category.findMany({ select: { id: true, parentId: true } });
  const projected = new Map(nodes.map((node) => [node.id, node.parentId]));
  for (const move of moves) {
    if (!projected.has(move.id)) throw new CategoryTreeError("NOT_FOUND", `Category ${move.id} not found.`);
    if (move.parentId && !projected.has(move.parentId)) {
      throw new CategoryTreeError("NOT_FOUND", `Parent ${move.parentId} not found.`);
    }
    projected.set(move.id, move.parentId);
  }
  const projectedNodes = [...projected].map(([id, parentId]) => ({ id, parentId }));
  for (const move of moves) {
    if (wouldCreateCycle(move.id, move.parentId, projectedNodes)) {
      throw new CategoryTreeError("CYCLE", "That arrangement would place a category under its own descendant.");
    }
  }

  for (const move of moves) {
    await tx.category.update({
      where: { id: move.id },
      data: { parentId: move.parentId, position: move.position },
    });
  }

  // Only re-parented nodes need a path rewrite; pure reorders keep their paths.
  const original = new Map(nodes.map((node) => [node.id, node.parentId]));
  const reparented = moves.filter((move) => original.get(move.id) !== move.parentId);
  let categories = 0;
  let products = 0;
  for (const move of reparented) {
    const result = await recomputeSubtreePaths(tx, move.id);
    categories += result.categories;
    products += result.products;
    if (result.products > 0) {
      await enqueue(
        "catalog.recompute_subtree",
        { categoryId: move.id },
        { tx, dedupeKey: `catalog.recompute_subtree:category:${move.id}` },
      );
    }
  }

  return { moved: moves.length, categories, products };
}
