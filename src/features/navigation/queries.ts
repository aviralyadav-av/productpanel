import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { NAVIGATION_MENU_SLUGS, type NavigationItemType } from "@/lib/enums";
import type { EntityRef } from "@/components/shared/entity-picker";
import { getMenu } from "@/features/storefront/queries/navigation";
import { STOREFRONT_PATHS, resolveNavigationLink } from "@/features/storefront/links";
import type { PublicMenu } from "@/lib/serializers/public";

import { isSystemMenuSlug, type MenuSummary, type NavItemEditorData, type NavTreeRow } from "./schemas";

/**
 * Read side of /admin/navigation.
 *
 * A menu is loaded whole (one query with its link targets) because the tree
 * screen needs every row anyway: nesting, drag projection and the §11.25
 * availability warning are all computed over the complete list. Availability
 * is derived with the SAME helpers the public serializer uses
 * (`resolveNavigationLink`), so a row flagged "unavailable" here is exactly a
 * row the website will render inactive.
 */

type Db = Prisma.TransactionClient;

const ITEM_SELECT = {
  id: true,
  menuId: true,
  parentId: true,
  position: true,
  label: true,
  type: true,
  url: true,
  categoryId: true,
  productId: true,
  pageId: true,
  iconName: true,
  badgeText: true,
  openInNewTab: true,
  isMegaMenu: true,
  isActive: true,
  category: { select: { id: true, name: true, path: true, isActive: true } },
  product: {
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      deletedAt: true,
      seller: { select: { status: true, deletedAt: true } },
    },
  },
  page: { select: { id: true, title: true, slug: true, status: true } },
} satisfies Prisma.NavigationItemSelect;

type ItemRow = Prisma.NavigationItemGetPayload<{ select: typeof ITEM_SELECT }>;

// ---------------------------------------------------------------------------
// Availability (§11.25)
// ---------------------------------------------------------------------------

type BlogLookup = Map<string, { id: string; title: string; slug: string; status: string; publishedAt: Date | null }>;

function targetSummary(row: ItemRow, blog: BlogLookup): { targetLabel: string; adminHref: string | null } {
  switch (row.type as NavigationItemType) {
    case "CATEGORY":
      return row.category
        ? { targetLabel: `Category · ${row.category.path}`, adminHref: `/admin/categories/${row.category.id}` }
        : { targetLabel: "Category · missing", adminHref: null };
    case "PRODUCT":
      return row.product
        ? { targetLabel: `Product · ${row.product.title}`, adminHref: `/admin/products/${row.product.id}` }
        : { targetLabel: "Product · missing", adminHref: null };
    case "PAGE":
      return row.page
        ? { targetLabel: `Page · /${row.page.slug}`, adminHref: `/admin/pages/${row.page.id}` }
        : { targetLabel: "Page · missing", adminHref: null };
    case "BLOG": {
      const slug = (row.url ?? "").trim();
      if (!slug) return { targetLabel: "Blog · index", adminHref: "/admin/blog" };
      const post = blog.get(slug);
      return post
        ? { targetLabel: `Blog · ${post.title}`, adminHref: `/admin/blog/${post.id}` }
        : { targetLabel: `Blog · ${slug}`, adminHref: "/admin/blog" };
    }
    case "HOME":
      return { targetLabel: "Storefront home", adminHref: null };
    case "URL":
    default:
      return { targetLabel: row.url ?? "No URL", adminHref: null };
  }
}

function availabilityOf(row: ItemRow, blog: BlogLookup, now: Date): { available: boolean; note: string | null } {
  switch (row.type as NavigationItemType) {
    case "CATEGORY":
      if (!row.category) return { available: false, note: "The category was deleted." };
      if (!row.category.isActive) return { available: false, note: "The category is disabled." };
      return { available: true, note: null };
    case "PRODUCT":
      if (!row.product) return { available: false, note: "The product was deleted." };
      if (row.product.deletedAt) return { available: false, note: "The product is deleted." };
      if (row.product.status !== "PUBLISHED") return { available: false, note: `The product is ${row.product.status.toLowerCase()}.` };
      if (row.product.seller && (row.product.seller.status !== "ACTIVE" || row.product.seller.deletedAt)) {
        return { available: false, note: "The seller is not active, so the product is hidden." };
      }
      return { available: true, note: null };
    case "PAGE":
      if (!row.page) return { available: false, note: "The page was deleted." };
      if (row.page.status !== "PUBLISHED") return { available: false, note: `The page is ${row.page.status.toLowerCase()}.` };
      return { available: true, note: null };
    case "BLOG": {
      const slug = (row.url ?? "").trim();
      if (!slug || slug.startsWith("/") || /^https?:/i.test(slug)) return { available: true, note: null };
      const post = blog.get(slug);
      if (!post) return { available: false, note: "No blog post has that slug." };
      if (post.status !== "PUBLISHED") return { available: false, note: `The post is ${post.status.toLowerCase()}.` };
      if (post.publishedAt && post.publishedAt > now) return { available: false, note: "The post is scheduled for later." };
      return { available: true, note: null };
    }
    case "URL": {
      const link = resolveNavigationLink({ type: "URL", url: row.url });
      return link.url ? { available: true, note: null } : { available: false, note: "The URL is empty or not an http(s)/site path." };
    }
    default:
      return { available: true, note: null };
  }
}

function publicUrlOf(row: ItemRow, blog: BlogLookup): string | null {
  if (row.type === "BLOG") {
    const slug = (row.url ?? "").trim();
    if (!slug) return STOREFRONT_PATHS.blogIndex();
    if (slug.startsWith("/") || /^https?:/i.test(slug)) return slug;
    return blog.has(slug) ? STOREFRONT_PATHS.blog(slug) : null;
  }
  return resolveNavigationLink({
    type: row.type,
    url: row.url,
    category: row.category,
    product: row.product,
    page: row.page,
  }).url;
}

async function loadBlogLookup(rows: readonly ItemRow[], client: Db): Promise<BlogLookup> {
  const slugs = rows
    .filter((row) => row.type === "BLOG")
    .map((row) => (row.url ?? "").trim())
    .filter((slug) => slug && !slug.startsWith("/") && !/^https?:/i.test(slug));
  if (slugs.length === 0) return new Map();
  const posts = await client.blogPost.findMany({
    where: { slug: { in: [...new Set(slugs)] } },
    select: { id: true, title: true, slug: true, status: true, publishedAt: true },
  });
  return new Map(posts.map((post) => [post.slug, post]));
}

function toTreeRow(row: ItemRow, blog: BlogLookup, childCounts: Map<string, number>, now: Date): NavTreeRow {
  const { targetLabel, adminHref } = targetSummary(row, blog);
  const availability = availabilityOf(row, blog, now);
  return {
    id: row.id,
    menuId: row.menuId,
    parentId: row.parentId,
    position: row.position,
    label: row.label,
    type: row.type as NavigationItemType,
    url: row.url,
    categoryId: row.categoryId,
    productId: row.productId,
    pageId: row.pageId,
    iconName: row.iconName,
    badgeText: row.badgeText,
    openInNewTab: row.openInNewTab,
    isMegaMenu: row.isMegaMenu,
    isActive: row.isActive,
    targetLabel,
    publicUrl: publicUrlOf(row, blog),
    adminHref,
    available: availability.available,
    availabilityNote: availability.note,
    childCount: childCounts.get(row.id) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

/** Every menu with its counts; the built-in five first, then custom ones alphabetically. */
export async function listMenus(now: Date = new Date()): Promise<MenuSummary[]> {
  const menus = await db.navigationMenu.findMany({ orderBy: { name: "asc" } });
  const items = await db.navigationItem.findMany({ select: ITEM_SELECT });
  const blog = await loadBlogLookup(items, db);

  const byMenu = new Map<string, ItemRow[]>();
  for (const item of items) {
    const list = byMenu.get(item.menuId) ?? [];
    list.push(item);
    byMenu.set(item.menuId, list);
  }

  const order = (slug: string) => {
    const index = (NAVIGATION_MENU_SLUGS as readonly string[]).indexOf(slug);
    return index === -1 ? NAVIGATION_MENU_SLUGS.length : index;
  };

  return menus
    .map((menu) => {
      const rows = byMenu.get(menu.id) ?? [];
      const broken = rows.filter((row) => !availabilityOf(row, blog, now).available).length;
      return {
        id: menu.id,
        slug: menu.slug,
        name: menu.name,
        description: menu.description,
        isSystem: isSystemMenuSlug(menu.slug),
        itemCount: rows.length,
        activeCount: rows.filter((row) => row.isActive).length,
        brokenCount: broken,
        updatedAt: menu.updatedAt,
      } satisfies MenuSummary;
    })
    .sort((a, b) => order(a.slug) - order(b.slug) || a.name.localeCompare(b.name));
}

/** The menu the screen should show: the requested slug, else `main`, else the first menu. */
export function resolveActiveMenu(menus: readonly MenuSummary[], slug: string | undefined): MenuSummary | null {
  if (menus.length === 0) return null;
  const wanted = slug ? menus.find((menu) => menu.slug === slug || menu.id === slug) : undefined;
  return wanted ?? menus.find((menu) => menu.slug === "main") ?? menus[0]!;
}

export async function getMenuTree(menuId: string, now: Date = new Date()): Promise<NavTreeRow[]> {
  const rows = await db.navigationItem.findMany({
    where: { menuId },
    orderBy: [{ position: "asc" }, { label: "asc" }],
    select: ITEM_SELECT,
  });
  const blog = await loadBlogLookup(rows, db);
  const childCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.parentId) childCounts.set(row.parentId, (childCounts.get(row.parentId) ?? 0) + 1);
  }
  return rows.map((row) => toTreeRow(row, blog, childCounts, now));
}

/** Link counts for the Homepage footer pointer card ("footer-1 · 5 links"). */
export async function listMenuLinkCounts(slugs: readonly string[]): Promise<{ slug: string; name: string; items: number }[]> {
  const menus = await db.navigationMenu.findMany({
    where: { slug: { in: [...slugs] } },
    select: { slug: true, name: true, _count: { select: { items: true } } },
  });
  const bySlug = new Map(menus.map((menu) => [menu.slug, menu]));
  return slugs.map((slug) => {
    const menu = bySlug.get(slug);
    return { slug, name: menu?.name ?? slug, items: menu?._count.items ?? 0 };
  });
}

// ---------------------------------------------------------------------------
// Item editor
// ---------------------------------------------------------------------------

export async function getItemEditor(id: string): Promise<NavItemEditorData | null> {
  const row = await db.navigationItem.findUnique({ where: { id }, select: ITEM_SELECT });
  if (!row) return null;
  const blogSlug = row.type === "BLOG" ? (row.url ?? "").trim() : "";
  const post =
    blogSlug && !blogSlug.startsWith("/") && !/^https?:/i.test(blogSlug)
      ? await db.blogPost.findUnique({ where: { slug: blogSlug }, select: { id: true, title: true, slug: true, status: true } })
      : null;

  return {
    id: row.id,
    menuId: row.menuId,
    parentId: row.parentId,
    label: row.label,
    type: row.type as NavigationItemType,
    url: row.url,
    category: row.category ? { id: row.category.id, title: row.category.name, subtitle: row.category.path } : null,
    product: row.product ? { id: row.product.id, title: row.product.title, subtitle: row.product.status } : null,
    page: row.page ? { id: row.page.id, title: row.page.title, subtitle: `/${row.page.slug} · ${row.page.status}` } : null,
    blogPost: post ? ({ id: post.id, title: post.title, subtitle: `${post.slug} · ${post.status}` } satisfies EntityRef) : null,
    iconName: row.iconName,
    badgeText: row.badgeText,
    openInNewTab: row.openInNewTab,
    isMegaMenu: row.isMegaMenu,
    isActive: row.isActive,
  };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/** Exactly what `GET /api/v1/navigation/:slug` will hand the website. */
export async function getMenuPreview(slug: string): Promise<PublicMenu | null> {
  return getMenu(slug);
}

/** Categories offered by the "Import category tree" helper (roots first, then their children). */
export async function listCategoryRoots(): Promise<{ id: string; name: string; path: string; depth: number; childCount: number }[]> {
  const rows = await db.category.findMany({
    where: { depth: { lte: 1 } },
    orderBy: [{ depth: "asc" }, { position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, path: true, depth: true, _count: { select: { children: true } } },
    take: 200,
  });
  return rows.map((row) => ({ id: row.id, name: row.name, path: row.path, depth: row.depth, childCount: row._count.children }));
}
