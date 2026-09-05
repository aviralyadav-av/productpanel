import type { Route } from "next";
import {
  Boxes,
  Gauge,
  LayoutTemplate,
  Package,
  Settings,
  ShoppingCart,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * SEVEN pages, not fifteen.
 *
 * The first cut of this file had a separate route for categories, reviews,
 * media, discounts, CMS pages, FAQ, footer, analytics and the audit log. For a
 * single-brand store with 39 products and one operator that is a lot of
 * navigation for very little content - most of those screens would hold a
 * handful of rows.
 *
 * They are folded into tabs on the page that owns their data instead:
 *   Products  -> Products | Categories | Sale
 *   Content   -> Homepage | Pages | FAQ | Footer | Media | Reviews
 *   Settings  -> Store | Shipping | SEO | Account | Activity | Cutover
 *
 * Tabs keep related work one click apart and keep the sidebar readable.
 */

export type NavBadge = "pendingOrders" | "lowStock";

export type NavItem = {
  title: string;
  href: Route;
  icon: LucideIcon;
  description: string;
  badge?: NavBadge;
  status?: "ready" | "planned";
  keywords?: string[];
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: Gauge,
        description: "Revenue, orders and everything that needs attention",
        status: "ready",
        keywords: ["home", "kpi", "analytics", "revenue", "chart"],
      },
    ],
  },
  {
    title: "Catalog",
    items: [
      {
        title: "Products",
        href: "/products",
        icon: Package,
        description: "Products, variants, pricing, categories and sale",
        status: "ready",
        keywords: ["bags", "sku", "catalogue", "categories", "sale", "discount"],
      },
      {
        title: "Inventory",
        href: "/inventory",
        icon: Boxes,
        description: "Stock levels, adjustments and the movement ledger",
        badge: "lowStock",
        status: "ready",
        keywords: ["stock", "low stock", "out of stock", "restock"],
      },
    ],
  },
  {
    title: "Selling",
    items: [
      {
        title: "Orders",
        href: "/orders",
        icon: ShoppingCart,
        description: "Every order, its timeline and its status",
        badge: "pendingOrders",
        status: "ready",
        keywords: ["cod", "shipping", "invoice", "refund", "cancel"],
      },
      {
        title: "Customers",
        href: "/customers",
        icon: Users,
        description: "Who is buying, how often and how much",
        status: "ready",
        keywords: ["buyers", "ltv"],
      },
    ],
  },
  {
    title: "Store",
    items: [
      {
        title: "Content",
        href: "/content",
        icon: LayoutTemplate,
        description: "Homepage sections, static pages, FAQ, footer and media",
        status: "ready",
        keywords: [
          "hero",
          "banner",
          "reels",
          "announcement",
          "cms",
          "faq",
          "footer",
          "media",
          "reviews",
          "testimonials",
        ],
      },
      {
        title: "Settings",
        href: "/settings",
        icon: Settings,
        description: "Store details, shipping, SEO, your account and activity",
        status: "ready",
        keywords: ["profile", "password", "audit", "log", "cutover", "api"],
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(
  (group) => group.items,
);

export function findNavItem(pathname: string): NavItem | undefined {
  return ALL_NAV_ITEMS.filter((item) => pathname.startsWith(item.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
}
