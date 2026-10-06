import { z } from "zod";

import { NAVIGATION_MENU_SLUGS, navigationItemTypeSchema, type NavigationItemType } from "@/lib/enums";
import { isSafeUrl, slugSchema } from "@/lib/validation";
import type { EntityRef } from "@/components/shared/entity-picker";

/**
 * Client-safe zod schemas and row types for /admin/navigation (blueprint
 * §4.8, §11.25, §14.G5).
 *
 * Depth: menus nest three levels (root → child → grandchild). `NAV_MAX_DEPTH`
 * is the 0-based deepest level the TreeView and the service both enforce, so
 * a drag the UI allows is never one the server rejects.
 */

export const NAV_MAX_LEVELS = 3;
/** 0-based: roots are 0, so three levels means depth 0..2. */
export const NAV_MAX_DEPTH = NAV_MAX_LEVELS - 1;

/** The five menus the storefront expects; they cannot be deleted or renamed by slug. */
export const SYSTEM_MENU_SLUGS: readonly string[] = NAVIGATION_MENU_SLUGS;

export function isSystemMenuSlug(slug: string): boolean {
  return SYSTEM_MENU_SLUGS.includes(slug);
}

/** Ids are cuids in production but `demo_*` strings in the seed, so no format check. */
export const navIdSchema = z.string().trim().min(1, "Missing id.").max(64);

const nullableId = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => (typeof value === "string" && value.trim() ? value.trim() : null));

const optionalText = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => (typeof value === "string" ? value.trim() : ""))
    .pipe(z.string().max(max))
    .transform((value) => (value === "" ? null : value));

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

export const menuCreateSchema = z.object({
  slug: slugSchema.refine((value) => !isSystemMenuSlug(value), "That slug is reserved for a built-in menu."),
  name: z.string().trim().min(1, "Give the menu a name.").max(80),
  description: optionalText(200),
});
export type MenuCreateInput = z.input<typeof menuCreateSchema>;
export type MenuCreateValues = z.output<typeof menuCreateSchema>;

export const menuUpdateSchema = z.object({
  name: z.string().trim().min(1, "Give the menu a name.").max(80),
  description: optionalText(200),
});
export type MenuUpdateInput = z.input<typeof menuUpdateSchema>;
export type MenuUpdateValues = z.output<typeof menuUpdateSchema>;

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * Which FK / url each type needs. BLOG has no FK on NavigationItem (schema):
 * the post slug (or a full URL) travels in `url`, blank = the blog index -
 * the same convention Banners use.
 */
export const itemInputSchema = z
  .object({
    menuId: navIdSchema,
    parentId: nullableId,
    label: z.string().trim().min(1, "Enter the label shoppers will see.").max(80),
    type: navigationItemTypeSchema,
    url: optionalText(2000),
    categoryId: nullableId,
    productId: nullableId,
    pageId: nullableId,
    /**
     * BLOG has no FK on NavigationItem, so the storefront reads the post SLUG
     * from `url`. The editor still picks a post by id: the service resolves it
     * to the slug, which keeps the picker honest and the stored value stable
     * if the post is later renamed in the admin list.
     */
    blogPostId: nullableId,
    iconName: optionalText(40),
    badgeText: optionalText(30),
    openInNewTab: z.boolean().default(false),
    isMegaMenu: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    switch (value.type) {
      case "URL":
        if (!value.url) ctx.addIssue({ code: "custom", path: ["url"], message: "Enter the URL to link to." });
        else if (!isSafeUrl(value.url)) ctx.addIssue({ code: "custom", path: ["url"], message: "Only http(s) or site-relative URLs are allowed." });
        break;
      case "CATEGORY":
        if (!value.categoryId) ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Choose the category." });
        break;
      case "PRODUCT":
        if (!value.productId) ctx.addIssue({ code: "custom", path: ["productId"], message: "Choose the product." });
        break;
      case "PAGE":
        if (!value.pageId) ctx.addIssue({ code: "custom", path: ["pageId"], message: "Choose the page." });
        break;
      case "BLOG":
        if (!value.blogPostId && value.url && !/^[a-z0-9-]+$/i.test(value.url) && !isSafeUrl(value.url)) {
          ctx.addIssue({ code: "custom", path: ["url"], message: "Enter a post slug or a safe URL, or leave blank for the blog index." });
        }
        break;
      default:
        break;
    }
  });
export type ItemInput = z.input<typeof itemInputSchema>;
export type ItemValues = z.output<typeof itemInputSchema>;

export const itemActiveSchema = z.object({ id: navIdSchema, isActive: z.boolean() });

export const reorderMoveSchema = z.object({
  id: navIdSchema,
  parentId: nullableId,
  position: z.coerce.number().int().min(0).max(10_000),
});
export const reorderItemsSchema = z.object({ moves: z.array(reorderMoveSchema).min(1).max(200) });
export type ReorderMove = z.output<typeof reorderMoveSchema>;
export type ReorderItemsInput = z.input<typeof reorderItemsSchema>;

export const importCategoryTreeSchema = z.object({
  menuId: navIdSchema,
  parentId: nullableId,
  categoryIds: z.array(navIdSchema).min(1, "Pick at least one category.").max(20, "Import up to 20 roots at a time."),
  /** How many category levels to bring in (1 = just the picked ones). */
  levels: z.coerce.number().int().min(1).max(NAV_MAX_LEVELS).default(2),
  includeInactive: z.boolean().default(false),
});
export type ImportCategoryTreeInput = z.input<typeof importCategoryTreeSchema>;
export type ImportCategoryTreeValues = z.output<typeof importCategoryTreeSchema>;

// ---------------------------------------------------------------------------
// Read-model row types
// ---------------------------------------------------------------------------

export type MenuSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  itemCount: number;
  activeCount: number;
  /** Items whose target is missing, unpublished or inactive (§11.25). */
  brokenCount: number;
  updatedAt: Date;
};

export type NavTreeRow = {
  id: string;
  menuId: string;
  parentId: string | null;
  position: number;
  label: string;
  type: NavigationItemType;
  url: string | null;
  categoryId: string | null;
  productId: string | null;
  pageId: string | null;
  iconName: string | null;
  badgeText: string | null;
  openInNewTab: boolean;
  isMegaMenu: boolean;
  isActive: boolean;
  /** "Category · /fashion/kurta", "Product · Brass diya", "/sale"… */
  targetLabel: string;
  /** Storefront URL the public API will emit, or null when unavailable. */
  publicUrl: string | null;
  /** Admin route for the target record, when there is one. */
  adminHref: string | null;
  available: boolean;
  /** Why it is unavailable: "Category is disabled", "Product not published"… */
  availabilityNote: string | null;
  childCount: number;
};

export type NavItemEditorData = {
  id: string;
  menuId: string;
  parentId: string | null;
  label: string;
  type: NavigationItemType;
  url: string | null;
  category: EntityRef | null;
  product: EntityRef | null;
  page: EntityRef | null;
  blogPost: EntityRef | null;
  iconName: string | null;
  badgeText: string | null;
  openInNewTab: boolean;
  isMegaMenu: boolean;
  isActive: boolean;
};
