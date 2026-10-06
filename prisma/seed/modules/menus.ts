import type { PrismaClient } from "@prisma/client";

import type { SeedContext } from "./context";

/**
 * Navigation menus (§4.8, E1): `main` = the six root categories with their
 * children nested, plus Blog and Contact; `footer-1..3` = system pages grouped
 * by audience; `mobile` mirrors main as a flat list.
 *
 * NavigationItem has no natural key, so items are created only when a menu is
 * still empty. Once an admin has touched a menu, re-seeding leaves it alone.
 */
const MENUS = [
  { slug: "main", name: "Main navigation", description: "Header menu." },
  { slug: "footer-1", name: "Footer · Shop", description: "First footer column." },
  { slug: "footer-2", name: "Footer · Help", description: "Second footer column." },
  { slug: "footer-3", name: "Footer · Sellers & Legal", description: "Third footer column." },
  { slug: "mobile", name: "Mobile navigation", description: "Drawer menu on small screens." },
] as const;

const ROOT_CATEGORIES = ["home-living", "fashion", "jewellery", "gifts", "stationery", "paintings"];

const FOOTER_PAGES: Record<string, string[]> = {
  "footer-2": ["faqs", "contact-us", "shipping-policy", "return-policy"],
  "footer-3": ["seller-terms", "seller-guidelines", "about-us", "terms-and-conditions", "privacy-policy"],
};

export async function seedMenus(db: PrismaClient, ctx: SeedContext) {
  const menuId = new Map<string, string>();
  for (const menu of MENUS) {
    const row = await db.navigationMenu.upsert({
      where: { slug: menu.slug },
      update: {},
      create: menu,
      select: { id: true },
    });
    menuId.set(menu.slug, row.id);
  }

  const roots = await db.category.findMany({
    where: { slug: { in: ROOT_CATEGORIES } },
    select: { id: true, slug: true, name: true, position: true, children: { select: { id: true, name: true, position: true }, orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
  });
  const pages = await db.cmsPage.findMany({ select: { id: true, slug: true, title: true } });
  const pageBySlug = new Map(pages.map((page) => [page.slug, page]));

  async function isEmpty(slug: string): Promise<boolean> {
    return (await db.navigationItem.count({ where: { menuId: menuId.get(slug) } })) === 0;
  }

  let created = 0;

  // ---- main: nested categories + Blog + Contact ---------------------------
  if (await isEmpty("main")) {
    const id = menuId.get("main")!;
    let position = 0;
    for (const root of roots) {
      const parent = await db.navigationItem.create({
        data: {
          menuId: id,
          label: root.name,
          type: "CATEGORY",
          categoryId: root.id,
          isMegaMenu: true,
          position: position++,
        },
        select: { id: true },
      });
      created += 1;
      for (const [index, child] of root.children.entries()) {
        await db.navigationItem.create({
          data: { menuId: id, parentId: parent.id, label: child.name, type: "CATEGORY", categoryId: child.id, position: index },
        });
        created += 1;
      }
    }
    await db.navigationItem.create({ data: { menuId: id, label: "Blog", type: "BLOG", url: "/blog", position: position++ } });
    const contact = pageBySlug.get("contact-us");
    await db.navigationItem.create({
      data: { menuId: id, label: "Contact", type: contact ? "PAGE" : "URL", pageId: contact?.id ?? null, url: contact ? null : "/contact-us", position: position++ },
    });
    created += 2;
  }

  // ---- footer-1: shop by category -------------------------------------------
  if (await isEmpty("footer-1")) {
    const id = menuId.get("footer-1")!;
    for (const [index, root] of roots.entries()) {
      await db.navigationItem.create({
        data: { menuId: id, label: root.name, type: "CATEGORY", categoryId: root.id, position: index },
      });
      created += 1;
    }
  }

  // ---- footer-2 / footer-3: system pages ------------------------------------
  for (const [slug, pageSlugs] of Object.entries(FOOTER_PAGES)) {
    if (!(await isEmpty(slug))) continue;
    const id = menuId.get(slug)!;
    for (const [index, pageSlug] of pageSlugs.entries()) {
      const page = pageBySlug.get(pageSlug);
      if (!page) continue;
      await db.navigationItem.create({
        data: { menuId: id, label: page.title, type: "PAGE", pageId: page.id, position: index },
      });
      created += 1;
    }
  }

  // ---- mobile: flat ---------------------------------------------------------
  if (await isEmpty("mobile")) {
    const id = menuId.get("mobile")!;
    await db.navigationItem.create({ data: { menuId: id, label: "Home", type: "HOME", url: "/", position: 0 } });
    created += 1;
    for (const [index, root] of roots.entries()) {
      await db.navigationItem.create({
        data: { menuId: id, label: root.name, type: "CATEGORY", categoryId: root.id, position: index + 1 },
      });
      created += 1;
    }
    await db.navigationItem.create({ data: { menuId: id, label: "Blog", type: "BLOG", url: "/blog", position: roots.length + 1 } });
    created += 1;
  }

  ctx.log(`navigation menus: ${MENUS.length}, items created: ${created}`);
}
