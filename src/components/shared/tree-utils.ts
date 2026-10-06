/**
 * Pure helpers for adjacency-list trees (categories, navigation menus).
 *
 * Every tree in the schema is stored the same way - `parentId` plus a
 * `position` among siblings - so one set of helpers serves TreeView, the
 * reorder API handlers and the seed. No React, no Prisma: importable from
 * anywhere.
 */

export type TreeItem = {
  id: string;
  parentId: string | null;
  position: number;
};

export type TreeNode<T extends TreeItem> = T & { children: TreeNode<T>[] };

export type FlatItem<T extends TreeItem> = {
  item: T;
  depth: number;
  /** Index among visible siblings, not the stored position. */
  index: number;
  hasChildren: boolean;
  /** Ids from the root down to (excluding) this node. */
  ancestors: string[];
};

function byPosition<T extends TreeItem>(a: T, b: T): number {
  return a.position - b.position || a.id.localeCompare(b.id);
}

/**
 * Nests a flat list. Orphans (parentId pointing at a missing row) are
 * promoted to roots rather than dropped, so a bad row is visible and fixable
 * instead of silently invisible.
 */
export function buildTree<T extends TreeItem>(items: readonly T[]): TreeNode<T>[] {
  const ids = new Set(items.map((item) => item.id));
  const byParent = new Map<string | null, T[]>();
  for (const item of items) {
    const parent = item.parentId && ids.has(item.parentId) ? item.parentId : null;
    const list = byParent.get(parent) ?? [];
    list.push(item);
    byParent.set(parent, list);
  }

  const build = (parentId: string | null): TreeNode<T>[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort(byPosition)
      .map((item) => ({ ...item, children: build(item.id) }));

  return build(null);
}

/**
 * Depth-first order with depth, skipping the subtrees of `collapsedIds` and
 * of `excludeId` (the node being dragged, whose children move with it).
 */
export function flattenTree<T extends TreeItem>(
  items: readonly T[],
  options: { collapsedIds?: ReadonlySet<string>; excludeId?: string | null } = {},
): FlatItem<T>[] {
  const out: FlatItem<T>[] = [];
  const collapsed = options.collapsedIds ?? new Set<string>();

  const walk = (nodes: TreeNode<T>[], depth: number, ancestors: string[]) => {
    nodes.forEach((node, index) => {
      const { children, ...rest } = node;
      out.push({
        item: rest as unknown as T,
        depth,
        index,
        hasChildren: children.length > 0,
        ancestors,
      });
      if (children.length > 0 && !collapsed.has(node.id) && node.id !== options.excludeId) {
        walk(children, depth + 1, [...ancestors, node.id]);
      }
    });
  };

  walk(buildTree(items), 0, []);
  return out;
}

/** Every id below `id`, at any depth. */
export function getDescendantIds<T extends TreeItem>(items: readonly T[], id: string): string[] {
  const byParent = new Map<string | null, T[]>();
  for (const item of items) {
    const list = byParent.get(item.parentId) ?? [];
    list.push(item);
    byParent.set(item.parentId, list);
  }
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    for (const child of byParent.get(current) ?? []) {
      out.push(child.id);
      stack.push(child.id);
    }
  }
  return out;
}

/** True if making `id` a child of `newParentId` would loop (self or descendant). */
export function wouldCreateCycle<T extends TreeItem>(
  items: readonly T[],
  id: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === id) return true;
  return getDescendantIds(items, id).includes(newParentId);
}

/** Depth of the deepest descendant relative to `id` (0 = leaf). */
export function subtreeHeight<T extends TreeItem>(items: readonly T[], id: string): number {
  const byParent = new Map<string | null, T[]>();
  for (const item of items) {
    const list = byParent.get(item.parentId) ?? [];
    list.push(item);
    byParent.set(item.parentId, list);
  }
  const height = (current: string): number => {
    const children = byParent.get(current) ?? [];
    if (children.length === 0) return 0;
    return 1 + Math.max(...children.map((child) => height(child.id)));
  };
  return height(id);
}

/** Depth of `id` from the root (roots are 0); -1 if not found. */
export function depthOf<T extends TreeItem>(items: readonly T[], id: string): number {
  const byId = new Map(items.map((item) => [item.id, item]));
  let depth = -1;
  let cursor: string | null = id;
  const seen = new Set<string>();
  while (cursor && byId.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    depth += 1;
    cursor = byId.get(cursor)!.parentId;
  }
  return depth;
}

/**
 * Applies a move locally: re-parents `id`, inserts it at `position` among the
 * new siblings and renumbers both the old and new sibling lists 0..n-1. Used
 * for optimistic UI; the server does the same in one transaction.
 */
export function applyMove<T extends TreeItem>(
  items: readonly T[],
  move: { id: string; parentId: string | null; position: number },
): T[] {
  const moving = items.find((item) => item.id === move.id);
  if (!moving || wouldCreateCycle(items, move.id, move.parentId)) return [...items];

  const others = items.filter((item) => item.id !== move.id);
  const newSiblings = others
    .filter((item) => item.parentId === move.parentId)
    .sort(byPosition);
  const clampedPosition = Math.max(0, Math.min(move.position, newSiblings.length));
  newSiblings.splice(clampedPosition, 0, { ...moving, parentId: move.parentId });

  const renumbered = new Map<string, T>();
  newSiblings.forEach((item, index) => renumbered.set(item.id, { ...item, position: index }));

  if (moving.parentId !== move.parentId) {
    others
      .filter((item) => item.parentId === moving.parentId)
      .sort(byPosition)
      .forEach((item, index) => renumbered.set(item.id, { ...item, position: index }));
  }

  return items.map((item) => renumbered.get(item.id) ?? item);
}
