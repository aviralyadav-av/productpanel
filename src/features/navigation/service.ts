import { Prisma, type NavigationItem, type NavigationMenu } from "@prisma/client";

import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";

import {
  NAV_MAX_DEPTH,
  isSystemMenuSlug,
  type ImportCategoryTreeValues,
  type ItemValues,
  type MenuCreateValues,
  type MenuUpdateValues,
  type ReorderMove,
} from "./schemas";

/**
 * Navigation menus and items (blueprint §4.8, §11.25, §14.G5).
 *
 * Every mutation runs in one transaction and renumbers the affected sibling
 * lists to a dense 0..n-1 so a later drop never has to reason about gaps. Depth
 * is enforced here as well as in the TreeView: the UI clamps the projection,
 * but a REST caller (or a stale tab) must not be able to build a four-level
 * menu the storefront cannot render.
 *
 * No `server-only` / `next/*` imports - cache invalidation and revalidation
 * belong to actions.ts and the route handlers.
 */

type Db = Prisma.TransactionClient;
type ClientMeta = { ip?: string | null; userAgent?: string | null };

const MENU_ENTITY = "navigation_menu";
const ITEM_ENTITY = "navigation_item";

/** A menu of any size stays comfortably under this; the cap only stops runaway loops. */
export const MAX_ITEMS_PER_MENU = 500;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type NodeRow = { id: string; parentId: string | null; position: number; label: string };

async function loadMenu(tx: Db, id: string): Promise<NavigationMenu> {
  const row = await tx.navigationMenu.findUnique({ where: { id } });
  if (!row) throw notFound("Menu");
  return row;
}

async function loadItem(tx: Db, id: string): Promise<NavigationItem> {
  const row = await tx.navigationItem.findUnique({ where: { id } });
  if (!row) throw notFound("Menu item");
  return row;
}

async function loadNodes(tx: Db, menuId: string): Promise<NodeRow[]> {
  return tx.navigationItem.findMany({
    where: { menuId },
    orderBy: [{ position: "asc" }, { label: "asc" }],
    select: { id: true, parentId: true, position: true, label: true },
  });
}

function childrenOf(nodes: readonly NodeRow[], parentId: string | null): NodeRow[] {
  return nodes.filter((node) => node.parentId === parentId).sort((a, b) => a.position - b.position);
}

function depthOf(nodes: readonly NodeRow[], id: string | null): number {
  let depth = 0;
  let cursor = id;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const node = nodes.find((entry) => entry.id === cursor);
    if (!node?.parentId) break;
    cursor = node.parentId;
    depth += 1;
  }
  return depth;
}

/** How many levels hang below `id`, so a re-parent can be rejected before it overflows. */
function subtreeHeight(nodes: readonly NodeRow[], id: string): number {
  const kids = nodes.filter((node) => node.parentId === id);
  if (kids.length === 0) return 0;
  return 1 + Math.max(...kids.map((kid) => subtreeHeight(nodes, kid.id)));
}

function wouldCreateCycle(nodes: readonly NodeRow[], id: string, parentId: string | null): boolean {
  let cursor = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === id) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    cursor = nodes.find((node) => node.id === cursor)?.parentId ?? null;
  }
  return false;
}

/** Rewrite one sibling list to 0..n-1 in the given order; returns how many rows moved. */
async function renumber(tx: Db, menuId: string, parentId: string | null, order: readonly string[]): Promise<number> {
  let moved = 0;
  const current = await tx.navigationItem.findMany({
    where: { menuId, parentId },
    select: { id: true, position: true },
  });
  const byId = new Map(current.map((row) => [row.id, row.position]));
  for (const [index, id] of order.entries()) {
    if (byId.get(id) !== index) {
      await tx.navigationItem.update({ where: { id }, data: { position: index } });
      moved += 1;
    }
  }
  return moved;
}

async function nextPosition(tx: Db, menuId: string, parentId: string | null): Promise<number> {
  const last = await tx.navigationItem.findFirst({
    where: { menuId, parentId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return last ? last.position + 1 : 0;
}

function itemSnapshot(row: NavigationItem): Record<string, unknown> {
  const { createdAt, updatedAt, ...rest } = row;
  void createdAt;
  void updatedAt;
  return rest as Record<string, unknown>;
}

function menuSnapshot(row: NavigationMenu): Record<string, unknown> {
  const { createdAt, updatedAt, ...rest } = row;
  void createdAt;
  void updatedAt;
  return rest as Record<string, unknown>;
}

/**
 * Only the FK the chosen type needs is stored; the others are cleared so a
 * PRODUCT item that used to be a CATEGORY cannot resolve to the old target if
 * someone flips the type back without re-picking.
 */
function targetColumns(values: ItemValues): {
  url: string | null;
  categoryId: string | null;
  productId: string | null;
  pageId: string | null;
} {
  switch (values.type) {
    case "CATEGORY":
      return { url: null, categoryId: values.categoryId, productId: null, pageId: null };
    case "PRODUCT":
      return { url: null, categoryId: null, productId: values.productId, pageId: null };
    case "PAGE":
      return { url: null, categoryId: null, productId: null, pageId: values.pageId };
    case "BLOG":
      // No blog FK on NavigationItem: the post slug (or a full URL) rides in `url`.
      return { url: values.url, categoryId: null, productId: null, pageId: null };
    case "HOME":
      return { url: null, categoryId: null, productId: null, pageId: null };
    case "URL":
    default:
      return { url: values.url, categoryId: null, productId: null, pageId: null };
  }
}

/**
 * BLOG items store the post SLUG in `url` (there is no blog FK on the model),
 * but the editor picks a post by id - resolve it here so both the picker and a
 * hand-typed slug end up in the same column.
 */
async function resolveBlogSlug(tx: Db, values: ItemValues): Promise<ItemValues> {
  if (values.type !== "BLOG" || !values.blogPostId) return values;
  const post = await tx.blogPost.findUnique({ where: { id: values.blogPostId }, select: { slug: true } });
  if (!post) throw badRequest("That blog post no longer exists.", { blogPostId: "Choose another post." });
  return { ...values, url: post.slug };
}

/** Targets are FKs with `SetNull`: a stale id must surface as a field error, not a 500. */
async function assertTargetExists(tx: Db, values: ItemValues): Promise<void> {
  if (values.type === "CATEGORY" && values.categoryId) {
    const found = await tx.category.count({ where: { id: values.categoryId } });
    if (found === 0) throw badRequest("That category no longer exists.", { categoryId: "Choose another category." });
  }
  if (values.type === "PRODUCT" && values.productId) {
    const found = await tx.product.count({ where: { id: values.productId } });
    if (found === 0) throw badRequest("That product no longer exists.", { productId: "Choose another product." });
  }
  if (values.type === "PAGE" && values.pageId) {
    const found = await tx.cmsPage.count({ where: { id: values.pageId } });
    if (found === 0) throw badRequest("That page no longer exists.", { pageId: "Choose another page." });
  }
}

/** A parent must live in the same menu and leave room for the item's own subtree. */
async function assertPlacement(
  tx: Db,
  menuId: string,
  parentId: string | null,
  options: { itemId?: string; extraLevels?: number } = {},
): Promise<void> {
  const nodes = await loadNodes(tx, menuId);
  if (parentId) {
    const parent = nodes.find((node) => node.id === parentId);
    if (!parent) throw badRequest("That parent item is not in this menu.", { parentId: "Choose a parent from this menu." });
    if (options.itemId && wouldCreateCycle(nodes, options.itemId, parentId)) {
      throw conflict("An item cannot be moved inside itself.");
    }
  }
  const height = options.itemId ? subtreeHeight(nodes, options.itemId) : (options.extraLevels ?? 0);
  const depth = depthOf(nodes, parentId) + (parentId ? 1 : 0);
  if (depth + height > NAV_MAX_DEPTH) {
    throw conflict(`Menus go ${NAV_MAX_DEPTH + 1} levels deep; this move would need ${depth + height + 1}.`);
  }
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

export async function createMenu(input: MenuCreateValues, actor: AuditActor, meta?: ClientMeta): Promise<NavigationMenu> {
  return db.$transaction(async (tx) => {
    const slug = String(input.slug).trim();
    const existing = await tx.navigationMenu.count({ where: { slug } });
    if (existing > 0) throw conflict("A menu with that slug already exists.", { slug: "Pick another slug." });
    const row = await tx.navigationMenu.create({
      data: { slug, name: String(input.name).trim(), description: input.description ?? null },
    });
    await writeAudit(tx, {
      actor,
      action: "navigation.menu_create",
      entityType: MENU_ENTITY,
      entityId: row.id,
      entityLabel: row.name,
      summary: `Created navigation menu "${row.name}" (${row.slug}).`,
      diff: diffOf(null, menuSnapshot(row)),
      ...meta,
    });
    return row;
  });
}

/** Name and description only: the slug is the website's contract and never changes. */
export async function updateMenu(id: string, input: MenuUpdateValues, actor: AuditActor, meta?: ClientMeta): Promise<NavigationMenu> {
  return db.$transaction(async (tx) => {
    const before = await loadMenu(tx, id);
    const row = await tx.navigationMenu.update({
      where: { id },
      data: { name: String(input.name).trim(), description: input.description ?? null },
    });
    await writeAudit(tx, {
      actor,
      action: "navigation.menu_update",
      entityType: MENU_ENTITY,
      entityId: row.id,
      entityLabel: row.name,
      summary: `Renamed navigation menu "${before.name}" to "${row.name}".`,
      diff: diffOf(menuSnapshot(before), menuSnapshot(row)),
      ...meta,
    });
    return row;
  });
}

/** Built-in menus (main, footer-1..3, mobile) are what the storefront asks for by slug, so they stay. */
export async function deleteMenu(id: string, actor: AuditActor, meta?: ClientMeta): Promise<{ id: string; name: string; items: number }> {
  return db.$transaction(async (tx) => {
    const before = await loadMenu(tx, id);
    if (isSystemMenuSlug(before.slug)) {
      throw conflict(`"${before.slug}" is a built-in menu the storefront reads by slug; it cannot be deleted.`);
    }
    const items = await tx.navigationItem.count({ where: { menuId: id } });
    await tx.navigationMenu.delete({ where: { id } });
    await writeAudit(tx, {
      actor,
      action: "navigation.menu_delete",
      entityType: MENU_ENTITY,
      entityId: before.id,
      entityLabel: before.name,
      summary: `Deleted navigation menu "${before.name}" with ${items} item${items === 1 ? "" : "s"}.`,
      diff: diffOf(menuSnapshot(before), null),
      ...meta,
    });
    return { id: before.id, name: before.name, items };
  });
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export async function createItem(values: ItemValues, actor: AuditActor, meta?: ClientMeta): Promise<NavigationItem> {
  return db.$transaction(async (tx) => {
    const menu = await loadMenu(tx, values.menuId);
    const count = await tx.navigationItem.count({ where: { menuId: menu.id } });
    if (count >= MAX_ITEMS_PER_MENU) throw conflict(`A menu holds at most ${MAX_ITEMS_PER_MENU} items.`);
    await assertPlacement(tx, menu.id, values.parentId, { extraLevels: 0 });
    const resolved = await resolveBlogSlug(tx, values);
    await assertTargetExists(tx, resolved);
    const row = await tx.navigationItem.create({
      data: {
        menuId: menu.id,
        parentId: values.parentId,
        label: values.label,
        type: values.type,
        ...targetColumns(resolved),
        iconName: values.iconName,
        badgeText: values.badgeText,
        openInNewTab: values.openInNewTab,
        // Mega menus only make sense on a top-level main-menu entry.
        isMegaMenu: values.isMegaMenu && values.parentId === null,
        isActive: values.isActive,
        position: await nextPosition(tx, menu.id, values.parentId),
      },
    });
    await writeAudit(tx, {
      actor,
      action: "navigation.item_create",
      entityType: ITEM_ENTITY,
      entityId: row.id,
      entityLabel: row.label,
      summary: `Added "${row.label}" to the ${menu.name} menu.`,
      diff: diffOf(null, itemSnapshot(row)),
      ...meta,
    });
    return row;
  });
}

export async function updateItem(id: string, values: ItemValues, actor: AuditActor, meta?: ClientMeta): Promise<NavigationItem> {
  return db.$transaction(async (tx) => {
    const before = await loadItem(tx, id);
    if (before.menuId !== values.menuId) throw badRequest("An item cannot be moved between menus.");
    if (values.parentId !== before.parentId) await assertPlacement(tx, before.menuId, values.parentId, { itemId: id });
    const resolved = await resolveBlogSlug(tx, values);
    await assertTargetExists(tx, resolved);
    const row = await tx.navigationItem.update({
      where: { id },
      data: {
        parentId: values.parentId,
        label: values.label,
        type: values.type,
        ...targetColumns(resolved),
        iconName: values.iconName,
        badgeText: values.badgeText,
        openInNewTab: values.openInNewTab,
        isMegaMenu: values.isMegaMenu && values.parentId === null,
        isActive: values.isActive,
        ...(values.parentId !== before.parentId
          ? { position: await nextPosition(tx, before.menuId, values.parentId) }
          : {}),
      },
    });
    await writeAudit(tx, {
      actor,
      action: "navigation.item_update",
      entityType: ITEM_ENTITY,
      entityId: row.id,
      entityLabel: row.label,
      summary: `Updated menu item "${row.label}".`,
      diff: diffOf(itemSnapshot(before), itemSnapshot(row)),
      ...meta,
    });
    return row;
  });
}

export async function setItemActive(id: string, isActive: boolean, actor: AuditActor, meta?: ClientMeta): Promise<NavigationItem> {
  return db.$transaction(async (tx) => {
    const before = await loadItem(tx, id);
    if (before.isActive === isActive) return before;
    const row = await tx.navigationItem.update({ where: { id }, data: { isActive } });
    await writeAudit(tx, {
      actor,
      action: isActive ? "navigation.item_enable" : "navigation.item_disable",
      entityType: ITEM_ENTITY,
      entityId: row.id,
      entityLabel: row.label,
      summary: `${isActive ? "Enabled" : "Disabled"} menu item "${row.label}".`,
      diff: diffOf({ isActive: before.isActive }, { isActive }),
      ...meta,
    });
    return row;
  });
}

/** Children cascade in the database; the count is reported so the confirm dialog can say so. */
export async function deleteItem(id: string, actor: AuditActor, meta?: ClientMeta): Promise<{ id: string; label: string; descendants: number }> {
  return db.$transaction(async (tx) => {
    const before = await loadItem(tx, id);
    const nodes = await loadNodes(tx, before.menuId);
    const descendants = collectDescendants(nodes, id).length;
    await tx.navigationItem.delete({ where: { id } });
    const siblings = childrenOf(
      nodes.filter((node) => node.id !== id),
      before.parentId,
    );
    await renumber(tx, before.menuId, before.parentId, siblings.map((node) => node.id));
    await writeAudit(tx, {
      actor,
      action: "navigation.item_delete",
      entityType: ITEM_ENTITY,
      entityId: before.id,
      entityLabel: before.label,
      summary: `Removed menu item "${before.label}"${descendants > 0 ? ` and ${descendants} child item${descendants === 1 ? "" : "s"}` : ""}.`,
      diff: diffOf(itemSnapshot(before), null),
      ...meta,
    });
    return { id: before.id, label: before.label, descendants };
  });
}

function collectDescendants(nodes: readonly NodeRow[], id: string): string[] {
  const out: string[] = [];
  const walk = (parentId: string) => {
    for (const node of nodes) {
      if (node.parentId === parentId) {
        out.push(node.id);
        walk(node.id);
      }
    }
  };
  walk(id);
  return out;
}

/**
 * G5 reorder: `{ moves: [{ id, parentId, position }] }`, applied in order
 * against the tree as it will be after the whole batch, then both the old and
 * the new sibling lists renumbered so positions stay dense.
 */
export async function reorderItems(moves: readonly ReorderMove[], actor: AuditActor, meta?: ClientMeta): Promise<{ moved: number; menuId: string }> {
  return db.$transaction(async (tx) => {
    const first = await loadItem(tx, moves[0]!.id);
    const menuId = first.menuId;
    const nodes = await loadNodes(tx, menuId);
    const byId = new Map(nodes.map((node) => [node.id, { ...node }]));

    for (const move of moves) {
      const node = byId.get(move.id);
      if (!node) throw badRequest("Some items no longer exist; reload the menu.");
      const parentId = move.parentId;
      if (parentId && !byId.has(parentId)) throw badRequest("That parent item is not in this menu.");
      const working = [...byId.values()];
      if (parentId && wouldCreateCycle(working, move.id, parentId)) throw conflict("An item cannot be moved inside itself.");
      const depth = parentId ? depthOf(working, parentId) + 1 : 0;
      if (depth + subtreeHeight(working, move.id) > NAV_MAX_DEPTH) {
        throw conflict(`Menus go ${NAV_MAX_DEPTH + 1} levels deep; this move would need one more.`);
      }
      node.parentId = parentId;
      node.position = move.position;
    }

    // Rebuild every sibling list touched by the batch, ordered by the requested
    // position with the untouched rows keeping their relative order.
    const touched = new Set<string | null>();
    for (const move of moves) {
      touched.add(move.parentId);
      touched.add(nodes.find((node) => node.id === move.id)?.parentId ?? null);
    }
    const movedIds = new Set(moves.map((move) => move.id));
    let moved = 0;
    for (const parentId of touched) {
      const siblings = [...byId.values()]
        .filter((node) => node.parentId === parentId)
        .sort((a, b) => a.position - b.position || (movedIds.has(a.id) ? -1 : 1));
      for (const node of siblings) {
        const stored = nodes.find((entry) => entry.id === node.id);
        if (stored && stored.parentId !== node.parentId) {
          await tx.navigationItem.update({ where: { id: node.id }, data: { parentId: node.parentId } });
          moved += 1;
        }
      }
      moved += await renumber(tx, menuId, parentId, siblings.map((node) => node.id));
    }

    if (moved > 0) {
      await writeAudit(tx, {
        actor,
        action: "navigation.item_reorder",
        entityType: ITEM_ENTITY,
        entityId: null,
        entityLabel: first.label,
        summary: `Reordered menu items (${moves.length} move${moves.length === 1 ? "" : "s"}, ${moved} row${moved === 1 ? "" : "s"} changed).`,
        diff: diffOf(null, { moves: [...moves] }),
        ...meta,
      });
    }
    return { moved, menuId };
  });
}

// ---------------------------------------------------------------------------
// Import a category tree
// ---------------------------------------------------------------------------

type CategorySeed = { id: string; parentId: string | null; name: string; position: number; isActive: boolean };

/**
 * "Import category tree": turn chosen category roots (and up to `levels` of
 * their children) into nested CATEGORY items. Building a 40-link mega menu by
 * hand is the single most tedious thing in this screen; the categories already
 * carry the names, the order and the hierarchy.
 */
export async function importCategoryTree(
  values: ImportCategoryTreeValues,
  actor: AuditActor,
  meta?: ClientMeta,
): Promise<{ created: number; skipped: number; menuId: string }> {
  return db.$transaction(async (tx) => {
    const menu = await loadMenu(tx, values.menuId);
    await assertPlacement(tx, menu.id, values.parentId, { extraLevels: values.levels - 1 });

    const roots = await tx.category.findMany({
      where: { id: { in: [...values.categoryIds] } },
      select: { id: true, parentId: true, name: true, position: true, isActive: true },
    });
    if (roots.length === 0) throw badRequest("None of those categories exist any more.");

    // Load the descendants level by level so `levels` is honoured exactly.
    const levels: CategorySeed[][] = [roots.map((row) => ({ ...row, parentId: null }))];
    let frontier = roots.map((row) => row.id);
    for (let level = 1; level < values.levels && frontier.length > 0; level += 1) {
      const children = await tx.category.findMany({
        where: { parentId: { in: frontier }, ...(values.includeInactive ? {} : { isActive: true }) },
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: { id: true, parentId: true, name: true, position: true, isActive: true },
      });
      if (children.length === 0) break;
      levels.push(children as CategorySeed[]);
      frontier = children.map((row) => row.id);
    }

    const existing = await tx.navigationItem.findMany({
      where: { menuId: menu.id, type: "CATEGORY", categoryId: { not: null } },
      select: { categoryId: true },
    });
    const already = new Set(existing.map((row) => row.categoryId));

    const itemIdByCategoryId = new Map<string, string>();
    let created = 0;
    let skipped = 0;

    for (const [level, rows] of levels.entries()) {
      for (const row of rows) {
        if (already.has(row.id)) {
          skipped += 1;
          continue;
        }
        const parentItemId = level === 0 ? values.parentId : (itemIdByCategoryId.get(row.parentId ?? "") ?? null);
        // A child whose parent was skipped would silently jump a level; skip it too.
        if (level > 0 && !parentItemId) {
          skipped += 1;
          continue;
        }
        const item = await tx.navigationItem.create({
          data: {
            menuId: menu.id,
            parentId: parentItemId,
            label: row.name,
            type: "CATEGORY",
            categoryId: row.id,
            isActive: row.isActive,
            position: await nextPosition(tx, menu.id, parentItemId),
          },
        });
        itemIdByCategoryId.set(row.id, item.id);
        already.add(row.id);
        created += 1;
      }
    }

    if (created > 0) {
      await writeAudit(tx, {
        actor,
        action: "navigation.import_categories",
        entityType: MENU_ENTITY,
        entityId: menu.id,
        entityLabel: menu.name,
        summary: `Imported ${created} category link${created === 1 ? "" : "s"} into the ${menu.name} menu${skipped > 0 ? ` (${skipped} already present)` : ""}.`,
        diff: diffOf(null, { categoryIds: [...values.categoryIds], levels: values.levels, created, skipped }),
        ...meta,
      });
    }
    return { created, skipped, menuId: menu.id };
  });
}
