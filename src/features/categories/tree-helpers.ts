/**
 * Pure helpers for the category tree - no React, no Prisma - so the service,
 * the tree screen and the node:test suite all share one definition of
 * "depth", "descendant" and "matches the search".
 */

export type TreeNodeLike = {
  id: string;
  parentId: string | null;
};

export type TreeSortable = TreeNodeLike & { position: number; name: string };

/** Root → leaf chain of ancestor ids for `id` (excluding itself); stops on a broken link. */
export function ancestorIds(nodes: readonly TreeNodeLike[], id: string): string[] {
  const parentById = new Map(nodes.map((node) => [node.id, node.parentId]));
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cursor = parentById.get(id) ?? null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    out.unshift(cursor);
    cursor = parentById.get(cursor) ?? null;
  }
  return out;
}

/** 0 for a root, 1 for its children, and so on. -1 when `id` is unknown. */
export function depthOf(nodes: readonly TreeNodeLike[], id: string): number {
  if (!nodes.some((node) => node.id === id)) return -1;
  return ancestorIds(nodes, id).length;
}

/** Every id strictly below `id`. */
export function descendantIdsOf(nodes: readonly TreeNodeLike[], id: string): string[] {
  const byParent = new Map<string | null, TreeNodeLike[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  const out: string[] = [];
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const child of byParent.get(current) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child.id);
      stack.push(child.id);
    }
  }
  return out;
}

/** Height of the subtree under `id`: 0 for a leaf, 1 when it has children, ... */
export function subtreeHeightOf(nodes: readonly TreeNodeLike[], id: string): number {
  const byParent = new Map<string | null, TreeNodeLike[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  const visit = (current: string, seen: Set<string>): number => {
    const children = byParent.get(current) ?? [];
    if (children.length === 0) return 0;
    let best = 0;
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      best = Math.max(best, 1 + visit(child.id, seen));
    }
    return best;
  };
  return visit(id, new Set([id]));
}

/**
 * The depth the deepest node of `id`'s subtree would have after re-parenting
 * `id` under `parentId`. The service compares this against MAX_CATEGORY_DEPTH
 * so a move cannot push a grandchild past the cap (the dragged node itself
 * might be fine while its children are not).
 */
export function deepestDepthAfterMove(
  nodes: readonly TreeNodeLike[],
  id: string,
  parentId: string | null,
): number {
  const parentDepth = parentId ? depthOf(nodes, parentId) : -1;
  return parentDepth + 1 + subtreeHeightOf(nodes, id);
}

/**
 * Indented options for a parent picker: depth-first in position order, with
 * `id` and everything under it removed (a category cannot become its own
 * descendant). `disabledIds` stay listed but unselectable, for "keep the
 * operator oriented" cases such as the category being deleted.
 */
export function buildParentOptions<T extends TreeSortable>(
  nodes: readonly T[],
  options: { excludeId?: string | null; disabledIds?: readonly string[]; indent?: string } = {},
): Array<{ value: string; label: string; depth: number; node: T; disabled?: boolean }> {
  const excluded = new Set<string>();
  if (options.excludeId) {
    excluded.add(options.excludeId);
    for (const id of descendantIdsOf(nodes, options.excludeId)) excluded.add(id);
  }
  const disabled = new Set(options.disabledIds ?? []);
  const indent = options.indent ?? "— ";

  const byParent = new Map<string | null, T[]>();
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    if (excluded.has(node.id)) continue;
    const parent = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    const list = byParent.get(parent) ?? [];
    list.push(node);
    byParent.set(parent, list);
  }

  const out: Array<{ value: string; label: string; depth: number; node: T; disabled?: boolean }> = [];
  const walk = (parentId: string | null, depth: number) => {
    const children = (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    for (const child of children) {
      out.push({
        value: child.id,
        label: `${indent.repeat(depth)}${child.name}`,
        depth,
        node: child,
        disabled: disabled.has(child.id) || undefined,
      });
      walk(child.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * Client-side tree search: the ids whose name or slug contains the query plus
 * every ancestor, so the matches stay attached to their branch. Case- and
 * accent-insensitive.
 */
export function searchTree<T extends TreeNodeLike & { name: string; slug: string }>(
  nodes: readonly T[],
  query: string,
): { visibleIds: Set<string>; matchIds: Set<string> } {
  const needle = normalise(query);
  const matchIds = new Set<string>();
  const visibleIds = new Set<string>();
  if (!needle) {
    for (const node of nodes) visibleIds.add(node.id);
    return { visibleIds, matchIds };
  }
  for (const node of nodes) {
    if (normalise(node.name).includes(needle) || normalise(node.slug).includes(needle)) {
      matchIds.add(node.id);
      visibleIds.add(node.id);
      for (const ancestor of ancestorIds(nodes, node.id)) visibleIds.add(ancestor);
    }
  }
  return { visibleIds, matchIds };
}

function normalise(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

/** Split a label around the query for highlighting; `[before, match, after]` or null when absent. */
export function highlightSplit(label: string, query: string): [string, string, string] | null {
  const needle = normalise(query);
  if (!needle) return null;
  const index = normalise(label).indexOf(needle);
  if (index < 0) return null;
  // Normalisation does not change string length for the ASCII/Latin names we
  // store, so indices line up; fall back to no highlight if they would not.
  if (normalise(label).length !== label.length) return null;
  return [label.slice(0, index), label.slice(index, index + needle.length), label.slice(index + needle.length)];
}

/** "my-slug" → "my-slug-2" → "my-slug-3": the create-time auto-suffix rule (§11.23). */
export function nextSlugCandidate(base: string, taken: ReadonlySet<string>, maxLength = 120): string {
  if (!taken.has(base)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, maxLength - 14)}-${Date.now().toString(36)}`;
}
