import type { Route } from "next";
import {
  BadgePercent,
  Bell,
  Boxes,
  ChartColumn,
  CircleHelp,
  Clock3,
  CreditCard,
  FileText,
  FolderTree,
  Gauge,
  Image,
  Images,
  LayoutGrid,
  LayoutTemplate,
  ListChecks,
  Loader,
  Mail,
  MailOpen,
  Megaphone,
  MessageSquare,
  Navigation,
  Newspaper,
  Package,
  PackageCheck,
  Percent,
  RotateCcw,
  ScrollText,
  Send,
  Settings,
  Shield,
  ShoppingCart,
  SlidersHorizontal,
  Star,
  Store,
  Tags,
  Ticket,
  Truck,
  Undo2,
  UserCheck,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { hasPermission } from "@/lib/permissions";

/**
 * The sidebar registry (blueprint §2). ONE list drives the sidebar, the
 * breadcrumbs, the ⌘K "jump to" group and the /admin/search page, so a route
 * rename is one edit here rather than four.
 *
 * Every item declares the `*.view` permission that opens its module. Items the
 * actor lacks are hidden by `visibleNavGroups()`; the route itself still calls
 * `requirePermission()` - hiding is a courtesy, the guard is the security.
 *
 * Badge keys name the count the shell layout computes in one batch
 * (src/features/shell/badges.ts); an item with a badge the actor cannot see is
 * simply hidden with the item.
 */

export type NavBadge =
  | "pendingOrders"
  | "pendingSellers"
  | "pendingReviews"
  | "newInquiries"
  | "unreadNotifications"
  | "lowStock"
  | "openReturns";

export const NAV_BADGE_KEYS: readonly NavBadge[] = [
  "pendingOrders",
  "pendingSellers",
  "pendingReviews",
  "newInquiries",
  "unreadNotifications",
  "lowStock",
  "openReturns",
];

export type NavBadgeCounts = Partial<Record<NavBadge, number>>;

export type NavItem = {
  title: string;
  /** May carry a query string (e.g. /admin/orders?status=PENDING). */
  href: Route;
  icon: LucideIcon;
  /** The `*.view` code; null means any signed-in admin (account, search). */
  permission: string | null;
  badge?: NavBadge;
  /** Extra words the command menu matches on. */
  keywords?: string[];
  /** Match the pathname exactly instead of as a prefix. */
  exact?: boolean;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
  /**
   * The group's icon in the icon-collapsed sidebar rail, where each group is
   * one button with a flyout. Standalone groups use their single item's icon.
   */
  icon?: LucideIcon;
  /**
   * A one-item group whose single entry sits at the top level of the sidebar
   * (Dashboard, Customers, Reports ...). Rendered without a header and never
   * collapsed.
   */
  standalone?: boolean;
};

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    title: "Overview",
    standalone: true,
    items: [
      {
        title: "Dashboard",
        href: "/admin/dashboard",
        icon: Gauge,
        permission: "dashboard.view",
        keywords: ["home", "kpi", "analytics", "revenue", "overview"],
      },
    ],
  },
  {
    title: "Catalog",
    icon: LayoutGrid,
    items: [
      {
        title: "Products",
        href: "/admin/products",
        icon: Package,
        permission: "products.view",
        keywords: ["sku", "catalogue", "variants", "listings"],
      },
      {
        title: "Categories",
        href: "/admin/categories",
        icon: FolderTree,
        permission: "categories.view",
        keywords: ["tree", "taxonomy", "departments"],
      },
      {
        title: "Attributes",
        href: "/admin/attributes",
        icon: Tags,
        permission: "attributes.view",
        keywords: ["filters", "options", "specifications", "size", "colour"],
      },
      {
        title: "Inventory",
        href: "/admin/inventory",
        icon: Boxes,
        permission: "inventory.view",
        badge: "lowStock",
        keywords: ["stock", "low stock", "out of stock", "restock", "warehouse", "sku", "ledger", "movements", "csv import"],
      },
    ],
  },
  {
    title: "Orders",
    icon: ShoppingCart,
    items: [
      {
        title: "All Orders",
        href: "/admin/orders",
        icon: ShoppingCart,
        permission: "orders.view",
        keywords: ["sales", "invoice", "cod"],
      },
      {
        title: "Pending",
        href: "/admin/orders?status=PENDING" as Route,
        icon: Clock3,
        permission: "orders.view",
        badge: "pendingOrders",
        keywords: ["awaiting", "confirm", "new orders"],
      },
      {
        title: "Processing",
        href: "/admin/orders?status=PROCESSING" as Route,
        icon: Loader,
        permission: "orders.view",
        keywords: ["packing", "in progress"],
      },
      {
        title: "Shipped",
        href: "/admin/orders?status=SHIPPED" as Route,
        icon: Truck,
        permission: "orders.view",
        keywords: ["in transit", "dispatched", "tracking"],
      },
      {
        title: "Delivered",
        href: "/admin/orders?status=DELIVERED" as Route,
        icon: PackageCheck,
        permission: "orders.view",
        keywords: ["completed", "fulfilled"],
      },
      {
        title: "Returns",
        href: "/admin/returns",
        icon: Undo2,
        permission: "returns.view",
        badge: "openReturns",
        keywords: ["rma", "return request", "qc"],
      },
      {
        title: "Refunds",
        href: "/admin/refunds",
        icon: RotateCcw,
        permission: "refunds.view",
        keywords: ["money back", "reversal"],
      },
      {
        title: "Payments",
        href: "/admin/payments",
        icon: CreditCard,
        permission: "payments.view",
        keywords: ["transactions", "razorpay", "gateway", "capture"],
      },
      {
        title: "Shipping",
        href: "/admin/shipping",
        icon: Truck,
        permission: "shipping.view",
        keywords: ["zones", "rates", "pincode", "courier", "partners"],
      },
    ],
  },
  {
    title: "Marketplace",
    icon: Store,
    items: [
      {
        title: "Sellers",
        href: "/admin/sellers",
        icon: Store,
        permission: "sellers.view",
        keywords: ["vendors", "artisans", "shops"],
      },
      {
        title: "Seller Approvals",
        href: "/admin/sellers?status=PENDING" as Route,
        icon: UserCheck,
        permission: "sellers.view",
        badge: "pendingSellers",
        keywords: ["kyc", "onboarding", "review", "verify"],
      },
      {
        title: "Commissions",
        href: "/admin/commissions",
        icon: Percent,
        permission: "commissions.view",
        keywords: ["rates", "fees", "ledger", "earnings"],
      },
      {
        title: "Payouts",
        href: "/admin/payouts",
        icon: Wallet,
        permission: "payouts.view",
        keywords: ["settlement", "statement", "bank transfer"],
      },
    ],
  },
  {
    title: "Customers",
    standalone: true,
    items: [
      {
        title: "Customers",
        href: "/admin/customers",
        icon: Users,
        permission: "customers.view",
        keywords: ["buyers", "shoppers", "ltv", "addresses", "crm", "segment", "vip", "wishlist", "address"],
      },
    ],
  },
  {
    title: "Marketing",
    icon: Megaphone,
    items: [
      {
        title: "Coupons",
        href: "/admin/coupons",
        icon: Ticket,
        permission: "coupons.view",
        keywords: ["discount code", "voucher", "promo code"],
      },
      {
        title: "Promotions",
        href: "/admin/promotions",
        icon: BadgePercent,
        permission: "promotions.view",
        keywords: ["sale", "campaign", "offer"],
      },
      {
        title: "Banners",
        href: "/admin/banners",
        icon: Image,
        permission: "banners.view",
        keywords: ["hero", "slider", "placement", "creative"],
      },
    ],
  },
  {
    title: "Content",
    icon: LayoutTemplate,
    items: [
      {
        title: "Homepage",
        href: "/admin/homepage",
        icon: LayoutTemplate,
        permission: "homepage.view",
        keywords: ["sections", "footer", "landing", "cms"],
      },
      {
        title: "Navigation",
        href: "/admin/navigation",
        icon: Navigation,
        permission: "navigation.view",
        keywords: ["menu", "header links", "footer links"],
      },
      {
        title: "Pages",
        href: "/admin/pages",
        icon: FileText,
        permission: "pages.view",
        keywords: ["about", "contact", "policy", "terms", "static", "cms", "privacy", "legal"],
      },
      {
        title: "Blog",
        href: "/admin/blog",
        icon: Newspaper,
        permission: "blog.view",
        keywords: ["posts", "articles", "news", "post", "article", "tags"],
      },
      {
        title: "FAQs",
        href: "/admin/faqs",
        icon: CircleHelp,
        permission: "faqs.view",
        keywords: ["questions", "help", "answers", "faq", "support"],
      },
      {
        title: "Reviews",
        href: "/admin/reviews",
        icon: Star,
        permission: "reviews.view",
        badge: "pendingReviews",
        keywords: ["ratings", "testimonials", "moderation"],
      },
    ],
  },
  {
    title: "Communication",
    icon: MessageSquare,
    items: [
      {
        title: "Inquiries",
        href: "/admin/inquiries",
        icon: MessageSquare,
        permission: "inquiries.view",
        badge: "newInquiries",
        keywords: ["contact form", "messages", "support", "tickets"],
      },
      {
        title: "Newsletter",
        href: "/admin/newsletter",
        icon: MailOpen,
        permission: "newsletter.view",
        keywords: ["subscribers", "mailing list"],
      },
      {
        title: "Email Templates",
        href: "/admin/email-templates",
        icon: Mail,
        permission: "email_templates.view",
        keywords: ["transactional", "smtp", "order confirmation"],
      },
    ],
  },
  {
    title: "Reports",
    standalone: true,
    items: [
      {
        title: "Reports",
        href: "/admin/reports",
        icon: ChartColumn,
        permission: "reports.view",
        keywords: ["analytics", "export", "csv", "xlsx", "sales report", "sales", "revenue", "commission", "payout", "tax", "gst", "hsn"],
      },
    ],
  },
  {
    title: "Notifications",
    standalone: true,
    items: [
      {
        title: "Notifications",
        href: "/admin/notifications",
        icon: Bell,
        permission: "notifications.view",
        badge: "unreadNotifications",
        keywords: ["alerts", "inbox", "unread"],
      },
    ],
  },
  {
    title: "Media Library",
    standalone: true,
    items: [
      {
        title: "Media Library",
        href: "/admin/media",
        icon: Images,
        permission: "media.view",
        keywords: ["images", "uploads", "files", "videos", "assets"],
      },
    ],
  },
  {
    title: "System",
    icon: SlidersHorizontal,
    items: [
      {
        title: "Admin Users",
        href: "/admin/users",
        icon: UserCog,
        permission: "users.view",
        keywords: ["staff", "team", "accounts", "invite"],
      },
      {
        title: "Roles & Permissions",
        href: "/admin/roles",
        icon: Shield,
        permission: "roles.view",
        keywords: ["rbac", "access", "grants"],
      },
      {
        title: "Audit Log",
        href: "/admin/audit-log",
        icon: ScrollText,
        permission: "audit.view",
        keywords: ["activity", "history", "who changed what"],
      },
      {
        title: "Settings",
        href: "/admin/settings",
        icon: Settings,
        permission: "settings.view",
        keywords: ["store", "tax", "email", "smtp", "seo", "security"],
      },
      {
        title: "Background jobs",
        href: "/admin/jobs",
        icon: ListChecks,
        permission: "jobs.view",
        keywords: ["queue", "worker", "cron", "retry", "failed jobs", "email.send"],
      },
      {
        // A tab on the email-templates route rather than a page of its own -
        // blueprint §2 lists the outbox under System, so it gets its own entry
        // pointing at that tab instead of a second route.
        title: "Email outbox",
        href: "/admin/email-templates?tab=outbox" as Route,
        icon: Send,
        permission: "email_outbox.view",
        keywords: ["queued emails", "failed email", "resend", "smtp"],
      },
    ],
  },
];

export const ALL_NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap(
  (group) => group.items,
);

// ---------------------------------------------------------------------------
// Helpers shared by the sidebar, breadcrumbs and command menu
// ---------------------------------------------------------------------------

/** Split "/admin/orders?status=PENDING" into its path and query. */
export function splitHref(href: string): { path: string; query: URLSearchParams } {
  const index = href.indexOf("?");
  if (index === -1) return { path: href, query: new URLSearchParams() };
  return {
    path: href.slice(0, index),
    query: new URLSearchParams(href.slice(index + 1)),
  };
}

function toSet(permissions: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return permissions instanceof Set ? (permissions as ReadonlySet<string>) : new Set(permissions);
}

/** True when the actor may see the item (super-admin sees everything). */
export function canSeeNavItem(
  item: NavItem,
  permissions: ReadonlySet<string> | readonly string[],
  isSuperAdmin: boolean,
): boolean {
  if (isSuperAdmin || item.permission === null) return true;
  return hasPermission(toSet(permissions), item.permission);
}

/**
 * The groups an actor may see, with items they lack filtered out and empty
 * groups dropped. Computed once per render of the shell.
 */
export function visibleNavGroups(
  permissions: ReadonlySet<string> | readonly string[],
  isSuperAdmin: boolean,
): NavGroup[] {
  const set = toSet(permissions);
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canSeeNavItem(item, set, isSuperAdmin)),
  })).filter((group) => group.items.length > 0);
}

/**
 * The registry item that owns a pathname, ignoring query-string variants -
 * "/admin/orders/abc" belongs to "All Orders". Longest path wins so
 * "/admin/blog/categories" would resolve to a dedicated item if one existed.
 */
export function findNavItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  let bestLength = -1;
  for (const item of ALL_NAV_ITEMS) {
    const { path, query } = splitHref(item.href);
    if (query.size > 0) continue;
    const matches = item.exact
      ? pathname === path
      : pathname === path || pathname.startsWith(`${path}/`);
    if (matches && path.length > bestLength) {
      best = item;
      bestLength = path.length;
    }
  }
  return best;
}

/** The group that contains an item. */
export function findNavGroup(item: NavItem): NavGroup | undefined {
  return NAV_GROUPS.find((group) => group.items.includes(item));
}

/**
 * Which item should light up for the current URL. Query-string items win
 * over their plain sibling when their parameters are present
 * ("Pending" rather than "All Orders" on /admin/orders?status=PENDING), and
 * the plain sibling is active only when no query variant matched.
 */
export function activeNavItem(
  pathname: string,
  searchParams: URLSearchParams | null,
  items: readonly NavItem[] = ALL_NAV_ITEMS,
): NavItem | undefined {
  let plain: NavItem | undefined;
  let plainLength = -1;

  for (const item of items) {
    const { path, query } = splitHref(item.href);
    const pathMatches = item.exact
      ? pathname === path
      : pathname === path || pathname.startsWith(`${path}/`);
    if (!pathMatches) continue;

    if (query.size > 0) {
      if (pathname !== path) continue;
      let all = true;
      for (const [key, value] of query) {
        if (searchParams?.get(key) !== value) {
          all = false;
          break;
        }
      }
      if (all) return item;
      continue;
    }

    if (path.length > plainLength) {
      plain = item;
      plainLength = path.length;
    }
  }

  return plain;
}

/** Items matching a free-text query for the ⌘K "jump to" group. */
export function searchNavItems(
  query: string,
  items: readonly NavItem[] = ALL_NAV_ITEMS,
): NavItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter((item) => {
    if (item.title.toLowerCase().includes(needle)) return true;
    return (item.keywords ?? []).some((word) => word.toLowerCase().includes(needle));
  });
}
