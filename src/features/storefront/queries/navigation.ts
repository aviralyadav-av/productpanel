import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { NAV_ITEM_SELECT, serializeNavItem, type NavItemRow, type PublicMenu, type PublicNavItem } from "@/lib/serializers/public";

/**
 * Navigation menus for `/api/v1/navigation/:menu` and the footer columns.
 *
 * Items are loaded flat with their link targets (category path/isActive,
 * product slug/status, page slug/status) and nested in memory, so a menu of
 * any depth costs one query and every item carries a resolved `url` plus an
 * `isAvailable` flag the website can use to hide or grey out dead links.
 */

type Db = Prisma.TransactionClient;

function nest(rows: readonly NavItemRow[]): PublicNavItem[] {
  const present = new Set(rows.map((row) => row.id));
  const childrenOf = new Map<string | null, NavItemRow[]>();
  for (const row of rows) {
    // An active child under an inactive parent is dropped with its parent.
    if (row.parentId && !present.has(row.parentId)) continue;
    const list = childrenOf.get(row.parentId) ?? [];
    list.push(row);
    childrenOf.set(row.parentId, list);
  }
  const build = (parentId: string | null): PublicNavItem[] =>
    (childrenOf.get(parentId) ?? [])
      .slice()
      .sort((x, y) => x.position - y.position || x.label.localeCompare(y.label))
      .map((row) => serializeNavItem(row, build(row.id)));
  return build(null);
}

/** GET /api/v1/navigation/:menu - null when no menu has that slug. */
export async function getMenu(slug: string, tx?: Db): Promise<PublicMenu | null> {
  const menus = await getMenus([slug], tx);
  return menus[0] ?? null;
}

/** Several menus in one round trip (the footer needs footer-1..3). Missing slugs are skipped. */
export async function getMenus(slugs: readonly string[], tx?: Db): Promise<PublicMenu[]> {
  const client = tx ?? db;
  const menus = await client.navigationMenu.findMany({
    where: { slug: { in: [...slugs] } },
    select: {
      slug: true,
      name: true,
      items: { where: { isActive: true }, select: NAV_ITEM_SELECT },
    },
  });
  const bySlug = new Map(menus.map((menu) => [menu.slug, menu]));
  const out: PublicMenu[] = [];
  for (const slug of slugs) {
    const menu = bySlug.get(slug);
    if (menu) out.push({ slug: menu.slug, name: menu.name, items: nest(menu.items) });
  }
  return out;
}
