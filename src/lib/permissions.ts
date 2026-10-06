/**
 * RBAC vocabulary (blueprint §3 + D14).
 *
 * Permission codes are `group.action`. `*.view` is required to open a module;
 * finer-grained codes gate individual actions. The rows in the Permission
 * table are seeded from PERMISSIONS and the nine system roles from
 * ROLE_DEFINITIONS; the admin can create additional roles from the same codes.
 *
 * `super-admin` has an empty grant list on purpose: it bypasses every check via
 * Actor.isSuperAdmin (guards.ts), so it never needs individual rows.
 */

export type PermissionGroup =
  | "dashboard"
  | "products"
  | "categories"
  | "attributes"
  | "inventory"
  | "orders"
  | "payments"
  | "refunds"
  | "returns"
  | "shipping"
  | "sellers"
  | "commissions"
  | "payouts"
  | "customers"
  | "coupons"
  | "promotions"
  | "banners"
  | "homepage"
  | "navigation"
  | "pages"
  | "blog"
  | "faqs"
  | "reviews"
  | "inquiries"
  | "newsletter"
  | "reports"
  | "notifications"
  | "media"
  | "email_templates"
  | "email_outbox"
  | "users"
  | "roles"
  | "audit"
  | "settings"
  | "jobs";

export type PermissionDefinition = {
  code: string;
  group: PermissionGroup;
  label: string;
  description: string;
};

export const PERMISSION_GROUPS: Record<PermissionGroup, { label: string }> = {
  dashboard: { label: "Dashboard" },
  products: { label: "Products" },
  categories: { label: "Categories" },
  attributes: { label: "Attributes" },
  inventory: { label: "Inventory" },
  orders: { label: "Orders" },
  payments: { label: "Payments" },
  refunds: { label: "Refunds" },
  returns: { label: "Returns" },
  shipping: { label: "Shipping" },
  sellers: { label: "Sellers" },
  commissions: { label: "Commissions" },
  payouts: { label: "Payouts" },
  customers: { label: "Customers" },
  coupons: { label: "Coupons" },
  promotions: { label: "Promotions" },
  banners: { label: "Banners" },
  homepage: { label: "Homepage" },
  navigation: { label: "Navigation" },
  pages: { label: "Pages" },
  blog: { label: "Blog" },
  faqs: { label: "FAQs" },
  reviews: { label: "Reviews" },
  inquiries: { label: "Inquiries" },
  newsletter: { label: "Newsletter" },
  reports: { label: "Reports" },
  notifications: { label: "Notifications" },
  media: { label: "Media library" },
  email_templates: { label: "Email templates" },
  email_outbox: { label: "Email outbox" },
  users: { label: "Admin users" },
  roles: { label: "Roles" },
  audit: { label: "Audit log" },
  settings: { label: "Settings" },
  jobs: { label: "Background jobs" },
};

function p(
  group: PermissionGroup,
  action: string,
  label: string,
  description: string,
): PermissionDefinition {
  return { code: `${group}.${action}`, group, label, description };
}

export const PERMISSIONS: readonly PermissionDefinition[] = [
  p("dashboard", "view", "View dashboard", "Open the dashboard. Widgets are further filtered by module permissions."),

  p("products", "view", "View products", "Open the product list and detail pages."),
  p("products", "create", "Create products", "Add new products, variants and customisation options."),
  p("products", "edit", "Edit products", "Change any product field, variant, image or attribute value."),
  p("products", "delete", "Delete products", "Soft-delete products."),
  p("products", "publish", "Publish products", "Move products between DRAFT, PUBLISHED and ARCHIVED."),
  p("products", "bulk", "Bulk product actions", "Run bulk operations over up to 500 products."),

  p("categories", "view", "View categories", "Open the category tree."),
  p("categories", "manage", "Manage categories", "Create, edit, reorder, delete categories and assign attributes."),

  p("attributes", "view", "View attributes", "Open attribute definitions."),
  p("attributes", "manage", "Manage attributes", "Create, edit and delete attributes and values."),

  p("inventory", "view", "View inventory", "See stock levels and movement history."),
  p("inventory", "adjust", "Adjust inventory", "Record stock adjustments and bulk updates."),

  p("orders", "view", "View orders", "Open the order list and detail pages."),
  p("orders", "create", "Create orders", "Key manual orders."),
  p("orders", "update", "Update orders", "Change order status and addresses."),
  p("orders", "cancel", "Cancel orders", "Cancel whole orders or individual lines."),
  p("orders", "notes", "Order notes", "Add internal and customer-facing notes."),
  p("orders", "ship", "Ship orders", "Create and update shipments."),
  p("orders", "export", "Export orders", "Download order exports."),

  p("payments", "view", "View payments", "See payment transactions."),
  p("payments", "manage", "Manage payments", "Record manual payments and captures."),

  p("refunds", "view", "View refunds", "See refund records."),
  p("refunds", "process", "Process refunds", "Create, approve, process and complete refunds."),

  p("returns", "view", "View returns", "See return requests."),
  p("returns", "manage", "Manage returns", "Move RMAs through the return workflow and QC."),

  p("shipping", "view", "View shipping", "See zones, rates, partners and pincodes."),
  p("shipping", "manage", "Manage shipping", "Edit zones, rates, partners and import pincodes."),

  p("sellers", "view", "View sellers", "Open seller list and profiles."),
  p("sellers", "create", "Create sellers", "Register sellers from the admin."),
  p("sellers", "edit", "Edit sellers", "Change seller profile, documents and bank accounts."),
  p("sellers", "approve", "Approve sellers", "Review, approve, reject and activate sellers."),
  p("sellers", "suspend", "Suspend sellers", "Suspend and reinstate sellers."),
  p("sellers", "delete", "Delete sellers", "Soft-delete sellers."),

  p("commissions", "view", "View commissions", "See commission rules and the earnings ledger."),
  p("commissions", "manage", "Manage commissions", "Create and edit commission rules."),

  p("payouts", "view", "View payouts", "See payout statements."),
  p("payouts", "approve", "Approve payouts", "Generate and approve statements."),
  p("payouts", "process", "Process payouts", "Mark statements processing, paid or failed; reveal bank details."),
  p("payouts", "adjust", "Ledger adjustments", "Record manual ledger adjustments."),

  p("customers", "view", "View customers", "Open the customer list and profiles."),
  p("customers", "create", "Create customers", "Add customers from the admin."),
  p("customers", "edit", "Edit customers", "Change customer profile, addresses, notes and tags."),
  p("customers", "block", "Block customers", "Block and unblock customers."),
  p("customers", "delete", "Delete customers", "Soft-delete customers."),
  p("customers", "reset_password", "Reset customer password", "Send a password reset link to a customer."),

  p("coupons", "view", "View coupons", "See coupons and usage history."),
  p("coupons", "manage", "Manage coupons", "Create, edit and disable coupons."),

  p("promotions", "view", "View promotions", "See sale campaigns."),
  p("promotions", "manage", "Manage promotions", "Create, edit and end promotions."),

  p("banners", "view", "View banners", "See banners by placement."),
  p("banners", "manage", "Manage banners", "Create, edit, schedule and delete banners."),

  p("homepage", "view", "View homepage", "See homepage sections and footer."),
  p("homepage", "manage", "Manage homepage", "Edit, reorder, schedule sections and the footer."),

  p("navigation", "view", "View navigation", "See menus."),
  p("navigation", "manage", "Manage navigation", "Edit menus and items."),

  p("pages", "view", "View pages", "See CMS pages."),
  p("pages", "manage", "Manage pages", "Create and edit CMS pages."),
  p("pages", "publish", "Publish pages", "Publish and unpublish CMS pages."),

  p("blog", "view", "View blog", "See posts and blog categories."),
  p("blog", "manage", "Manage blog", "Create and edit posts and categories."),
  p("blog", "publish", "Publish blog", "Publish, schedule and archive posts."),

  p("faqs", "view", "View FAQs", "See FAQ entries."),
  p("faqs", "manage", "Manage FAQs", "Create, edit, reorder and delete FAQs."),

  p("reviews", "view", "View reviews", "See product reviews and testimonials."),
  p("reviews", "moderate", "Moderate reviews", "Approve, reject and feature reviews."),
  p("reviews", "reply", "Reply to reviews", "Post a public reply."),
  p("reviews", "delete", "Delete reviews", "Delete reviews."),

  p("inquiries", "view", "View inquiries", "See contact inquiries."),
  p("inquiries", "manage", "Manage inquiries", "Assign, reply, resolve and mark spam."),

  p("newsletter", "view", "View subscribers", "See newsletter subscribers."),
  p("newsletter", "manage", "Manage subscribers", "Unsubscribe and edit subscribers."),
  p("newsletter", "export", "Export subscribers", "Download the subscriber list."),

  p("reports", "view", "View reports", "Open reports (each report also needs its module's view permission)."),
  p("reports", "export", "Export reports", "Download CSV/XLSX/print exports."),

  p("notifications", "view", "View notifications", "See the notification centre."),

  p("media", "view", "View media", "Browse the media library and use the picker."),
  p("media", "upload", "Upload media", "Upload, replace and organise files."),
  p("media", "delete", "Delete media", "Delete unused media."),

  p("email_templates", "view", "View email templates", "See templates and preview them."),
  p("email_templates", "manage", "Manage email templates", "Edit template subject and bodies."),
  p("email_outbox", "view", "View email outbox", "See queued and sent emails."),

  p("users", "view", "View admin users", "See admin accounts and sessions."),
  p("users", "create", "Create admin users", "Invite admin users."),
  p("users", "edit", "Edit admin users", "Change role, activate/deactivate, revoke sessions."),
  p("users", "delete", "Delete admin users", "Deactivate and anonymise admin users."),

  p("roles", "view", "View roles", "See roles and the permission matrix."),
  p("roles", "manage", "Manage roles", "Create roles and edit permission grants."),

  p("audit", "view", "View audit log", "Read the audit trail."),

  p("settings", "view", "View settings", "See settings."),
  p("settings", "manage", "Manage settings", "Edit general, e-commerce, email, marketplace, SEO and social settings."),
  p("settings", "manage_payments", "Manage payment providers", "Edit payment provider credentials and modes (super-admin only)."),
  p("settings", "manage_security", "Manage security settings", "Edit session, 2FA and security settings (super-admin only)."),

  p("jobs", "view", "View jobs", "See the background job queue."),
  p("jobs", "manage", "Manage jobs", "Retry, cancel and trigger jobs."),
];

export const PERMISSION_CODES = PERMISSIONS.map((item) => item.code) as readonly string[];
export type PermissionCode = (typeof PERMISSIONS)[number]["code"];

const PERMISSION_CODE_SET: ReadonlySet<string> = new Set(PERMISSION_CODES);

export function isPermissionCode(code: string): boolean {
  return PERMISSION_CODE_SET.has(code);
}

/** Every code in a group, e.g. group("orders") -> orders.view, orders.create, ... */
function group(name: PermissionGroup): string[] {
  return PERMISSIONS.filter((item) => item.group === name).map((item) => item.code);
}

function codes(...list: string[]): string[] {
  for (const code of list) {
    if (!PERMISSION_CODE_SET.has(code)) {
      throw new Error(`Unknown permission code in role definition: ${code}`);
    }
  }
  return list;
}

function unique(list: string[]): string[] {
  return Array.from(new Set(list)).sort();
}

export const SUPER_ADMIN_ROLE_SLUG = "super-admin";

/** Only super-admin may hold these (D14). */
export const SUPER_ADMIN_ONLY_PERMISSIONS: readonly string[] = [
  "settings.manage_payments",
  "settings.manage_security",
];

export type RoleDefinition = {
  slug: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
};

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    slug: SUPER_ADMIN_ROLE_SLUG,
    name: "Super Admin",
    description:
      "Bypasses all permission checks. Cannot be deleted; at least one active super-admin must always exist.",
    isSystem: true,
    permissions: [],
  },
  {
    slug: "admin",
    name: "Admin",
    description:
      "Everything except role management, deleting admin users, and payment/security settings.",
    isSystem: true,
    permissions: unique(
      PERMISSION_CODES.filter(
        (code) =>
          code !== "roles.manage" &&
          code !== "users.delete" &&
          !SUPER_ADMIN_ONLY_PERMISSIONS.includes(code),
      ),
    ),
  },
  {
    slug: "catalog-manager",
    name: "Catalog Manager",
    description: "Products, categories, attributes, inventory and media uploads.",
    isSystem: true,
    permissions: unique([
      ...codes("dashboard.view"),
      ...group("products"),
      ...group("categories"),
      ...group("attributes"),
      ...group("inventory"),
      ...codes("media.view", "media.upload", "reviews.view"),
    ]),
  },
  {
    slug: "order-manager",
    name: "Order Manager",
    description: "Orders, payments, refunds, returns and shipping.",
    isSystem: true,
    permissions: unique([
      ...codes("dashboard.view"),
      ...group("orders"),
      ...codes("payments.view", "payments.manage"),
      ...group("refunds"),
      ...group("returns"),
      ...group("shipping"),
      ...codes("customers.view", "inventory.view", "notifications.view"),
    ]),
  },
  {
    slug: "seller-manager",
    name: "Seller Manager",
    description: "Seller onboarding, commissions and payout visibility.",
    isSystem: true,
    permissions: unique([
      ...codes("dashboard.view"),
      ...group("sellers"),
      ...codes("commissions.view", "commissions.manage", "payouts.view"),
      ...codes("products.view", "orders.view", "reviews.view"),
    ]),
  },
  {
    slug: "customer-support",
    name: "Customer Support",
    description: "Customer care: customers, order notes, returns, reviews and inquiries.",
    isSystem: true,
    permissions: unique([
      ...codes("dashboard.view"),
      ...codes("customers.view", "customers.edit", "customers.reset_password"),
      ...codes("orders.view", "orders.notes"),
      ...group("returns"),
      ...codes("refunds.view"),
      ...codes("reviews.view", "reviews.moderate", "reviews.reply"),
      ...group("inquiries"),
      ...codes("notifications.view"),
    ]),
  },
  {
    slug: "content-manager",
    name: "Content Manager",
    description: "Homepage, navigation, pages, blog, FAQs, banners, review moderation and media.",
    isSystem: true,
    permissions: unique([
      ...codes("dashboard.view"),
      ...group("homepage"),
      ...group("navigation"),
      ...group("pages"),
      ...group("blog"),
      ...group("faqs"),
      ...group("banners"),
      ...codes("reviews.view", "reviews.moderate"),
      ...group("media"),
    ]),
  },
  {
    slug: "finance-manager",
    name: "Finance Manager",
    description: "Payments, refunds, payouts, commissions and reports.",
    isSystem: true,
    permissions: unique([
      ...codes("dashboard.view"),
      ...group("payments"),
      ...group("refunds"),
      ...group("payouts"),
      ...group("commissions"),
      ...group("reports"),
      ...codes("orders.view", "sellers.view"),
    ]),
  },
  {
    slug: "marketing-manager",
    name: "Marketing Manager",
    description: "Coupons, promotions, banners, newsletter and homepage content.",
    isSystem: true,
    permissions: unique([
      ...codes("dashboard.view"),
      ...group("coupons"),
      ...group("promotions"),
      ...group("banners"),
      ...group("newsletter"),
      ...codes("homepage.view", "homepage.manage"),
      ...codes("reports.view", "customers.view"),
    ]),
  },
];

export const ROLE_SLUGS = ROLE_DEFINITIONS.map((role) => role.slug) as readonly string[];

/**
 * True when the permission set covers the code. Accepts an array of codes as
 * "any of". Super-admin is handled by the caller (Actor.isSuperAdmin) so a
 * plain Set can be tested here without knowing who owns it.
 */
export function hasPermission(
  set: ReadonlySet<string>,
  code: string | readonly string[],
): boolean {
  if (typeof code === "string") return set.has(code);
  return code.some((item) => set.has(item));
}

/** The `.view` code for a permission group, e.g. viewCode("orders") -> "orders.view". */
export function viewCode(groupName: PermissionGroup): string {
  return `${groupName}.view`;
}
