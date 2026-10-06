/**
 * Every Setting key the platform reads (blueprint §14.E2 - frozen for wave 3).
 *
 * The Setting table is seeded from SETTING_DEFINITIONS; the settings UI renders
 * a control per `type` and groups by `group`. `isPublic` rows are exposed via
 * /api/v1/settings - secrets never are, regardless of the flag. Defaults are
 * strings because the column is a string; `getSetting()` in ./settings.ts
 * parses by type.
 *
 * Money defaults are paise; rates are bps. Global commission deliberately has
 * NO mirror here - it lives only in the GLOBAL CommissionRule row (B3).
 */
import type { SettingType } from "./enums";

export type SettingGroup =
  | "general"
  | "storefront"
  | "tax"
  | "orders"
  | "checkout"
  | "inventory"
  | "returns"
  | "shipping"
  | "email"
  | "marketplace"
  | "customers"
  | "seo"
  | "social"
  | "security"
  | "notifications";

export type SettingDefinition = {
  key: string;
  type: SettingType;
  group: SettingGroup;
  label: string;
  helpText: string;
  isPublic: boolean;
  defaultValue: string;
};

export const SETTING_GROUPS: Record<SettingGroup, { label: string; description: string }> = {
  general: { label: "Store", description: "Name, contact details and locale." },
  storefront: { label: "Storefront", description: "Where the customer website lives and how it may call this API." },
  tax: { label: "Tax", description: "Default GST handling for product prices and commission." },
  orders: { label: "Orders", description: "COD, minimum order, confirmation and abuse limits." },
  checkout: { label: "Checkout", description: "Payment timeouts, bot protection and blocklists." },
  inventory: { label: "Inventory", description: "Stock thresholds and backorder defaults." },
  returns: { label: "Returns", description: "Return window and pickup charges." },
  shipping: { label: "Shipping", description: "Free-shipping threshold and delivery estimates." },
  email: { label: "Email", description: "SMTP transport and sender identity." },
  marketplace: { label: "Marketplace", description: "Seller registration, payout schedule and charges." },
  customers: { label: "Customers", description: "Segment thresholds." },
  seo: { label: "SEO", description: "Default meta tags, robots and sitemap." },
  social: { label: "Social", description: "Profile links shown on the storefront." },
  security: { label: "Security", description: "Session lifetimes and 2FA policy." },
  notifications: { label: "Notifications", description: "Digest and delivery preferences." },
};

function def(
  key: string,
  type: SettingType,
  group: SettingGroup,
  label: string,
  defaultValue: string,
  helpText: string,
  isPublic = false,
): SettingDefinition {
  return { key, type, group, label, helpText, isPublic, defaultValue };
}

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  // ---- store ---------------------------------------------------------------
  def("store.name", "string", "general", "Store name", "DIY Baazar", "Shown in the admin header, emails and storefront title.", true),
  def("store.tagline", "string", "general", "Tagline", "Handmade, personalised, made in India.", "Short line under the logo.", true),
  def("store.logo_media_id", "string", "general", "Logo", "", "Media asset id for the storefront logo.", true),
  def("store.favicon_media_id", "string", "general", "Favicon", "", "Media asset id for the storefront favicon.", true),
  def("store.contact_email", "string", "general", "Contact email", "hello@diybaazar.local", "Shown on the contact page and in email footers.", true),
  def("store.contact_phone", "string", "general", "Contact phone", "+91 00000 00000", "Customer care number.", true),
  def("store.whatsapp", "string", "general", "WhatsApp number", "", "International format, digits only.", true),
  def("store.address", "string", "general", "Postal address", "", "Registered address printed on invoices.", true),
  def("store.currency", "string", "general", "Currency", "INR", "ISO 4217 code. Only INR is supported today.", true),
  def("store.timezone", "string", "general", "Timezone", "Asia/Kolkata", "IANA zone used for daily bucketing and date filters."),

  // ---- storefront ----------------------------------------------------------
  def("storefront.base_url", "string", "storefront", "Storefront URL", "http://localhost:5173", "Base URL of the customer website; used for preview and reset links."),
  def("storefront.cors_origins", "string", "storefront", "Extra CORS origins", "", "Comma-separated origins allowed in addition to STOREFRONT_ORIGINS."),
  def("storefront.preview_enabled", "boolean", "storefront", "Preview links", "true", "Allow admins to open draft content on the storefront with a preview token."),

  // ---- tax -----------------------------------------------------------------
  def("tax.default_bps", "number", "tax", "Default tax rate (bps)", "0", "Applied when a product has no tax rate. 1800 = 18%."),
  def("tax.prices_include_tax", "boolean", "tax", "Prices include tax", "true", "When on, tax is extracted from the price; otherwise added on top."),
  def("tax.goods_remitted_by", "string", "tax", "Goods tax remitted by", "SELLER", "SELLER or PLATFORM - decides whether the seller's payable is tax-inclusive."),
  def("tax.commission_tax_bps", "number", "tax", "Tax on commission (bps)", "0", "GST charged on the platform commission (reserved)."),

  // ---- orders --------------------------------------------------------------
  def("orders.cod_enabled", "boolean", "orders", "COD enabled", "true", "Offer cash on delivery at checkout.", true),
  def("orders.cod_fee_paise", "money", "orders", "COD fee", "4900", "Charged per COD order; never waived by free shipping.", true),
  def("orders.cod_max_paise", "money", "orders", "COD maximum order value", "1000000", "COD is hidden above this total.", true),
  def("orders.min_order_paise", "money", "orders", "Minimum order value", "0", "Checkout rejects smaller orders.", true),
  def("orders.auto_confirm_prepaid", "boolean", "orders", "Auto-confirm prepaid orders", "true", "Move PENDING to CONFIRMED when payment succeeds."),
  def("orders.cod_confirm_hours", "number", "orders", "COD confirmation window (hours)", "48", "Unconfirmed COD orders auto-cancel after this."),
  def("orders.max_open_per_email", "number", "orders", "Max open orders per email", "3", "Open PENDING orders allowed per email address."),
  def("orders.max_per_ip_per_day", "number", "orders", "Max orders per IP per day", "10", "Checkout abuse control."),

  // ---- checkout ------------------------------------------------------------
  def("checkout.payment_timeout_minutes", "number", "checkout", "Payment timeout (minutes)", "20", "Unpaid online orders release their reservation after this."),
  def("checkout.turnstile_secret", "secret", "checkout", "Turnstile secret", "", "Cloudflare Turnstile secret; when set, checkout verifies the token."),
  def("checkout.blocklist", "json", "checkout", "Blocklist", '{"emails":[],"phones":[],"pincodes":[]}', "Emails, phones and pincodes refused at checkout."),

  // ---- inventory -----------------------------------------------------------
  def("inventory.default_low_stock_threshold", "number", "inventory", "Low-stock threshold", "3", "Default threshold for new variants."),
  def("inventory.allow_backorder_default", "boolean", "inventory", "Allow backorders by default", "false", "Default for new variants."),

  // ---- returns -------------------------------------------------------------
  def("returns.enabled", "boolean", "returns", "Returns enabled", "true", "Accept return requests from the storefront.", true),
  def("returns.window_days", "number", "returns", "Return window (days)", "7", "Counted from the line's delivery date.", true),
  def("returns.pickup_fee_paise", "money", "returns", "Pickup fee", "0", "Charged to the seller for seller-fault returns."),
  def("returns.customer_pays_pickup", "boolean", "returns", "Customer pays pickup", "false", "Deduct the pickup fee from the refund for change-of-mind returns."),

  // ---- shipping ------------------------------------------------------------
  def("shipping.free_above_paise", "money", "shipping", "Free shipping above", "99900", "Item subtotal after discounts at which shipping is free. Empty disables.", true),
  def("shipping.default_estimate_days", "number", "shipping", "Default delivery estimate (days)", "5", "Shown when no pincode data exists.", true),

  // ---- email ---------------------------------------------------------------
  def("email.transport", "string", "email", "Transport", "console", "smtp or console. Console prints emails to the server log."),
  def("email.smtp_host", "string", "email", "SMTP host", "", ""),
  def("email.smtp_port", "number", "email", "SMTP port", "587", ""),
  def("email.smtp_user", "string", "email", "SMTP user", "", ""),
  def("email.smtp_password", "secret", "email", "SMTP password", "", "Encrypted at rest."),
  def("email.smtp_secure", "boolean", "email", "SMTP secure (TLS)", "false", "Use implicit TLS (port 465)."),
  def("email.from_name", "string", "email", "From name", "DIY Baazar", ""),
  def("email.from_address", "string", "email", "From address", "no-reply@diybaazar.local", ""),
  def("email.reply_to", "string", "email", "Reply-to", "hello@diybaazar.local", ""),

  // ---- marketplace ---------------------------------------------------------
  def("marketplace.seller_registration_open", "boolean", "marketplace", "Seller registration open", "true", "Accept new seller registrations from the storefront.", true),
  def("marketplace.payout_hold_days", "number", "marketplace", "Payout hold (days)", "7", "Earnings become available this many days after delivery."),
  def("marketplace.payout_cycle", "string", "marketplace", "Payout cycle", "WEEKLY", "WEEKLY, FORTNIGHTLY or MONTHLY."),
  def("marketplace.min_payout_paise", "money", "marketplace", "Minimum payout", "50000", "Statements below this are held and carried forward."),
  def("marketplace.charges", "json", "marketplace", "Marketplace charges", "[]", "[{ code, label, type, valueBps|valuePaise, appliesWhen }] deducted from seller payables."),

  // ---- customers -----------------------------------------------------------
  def("customers.new_days", "number", "customers", "New customer (days)", "30", "Customers created within this window are NEW."),
  def("customers.returning_min_orders", "number", "customers", "Returning (min orders)", "2", ""),
  def("customers.vip_min_orders", "number", "customers", "VIP (min orders)", "10", ""),
  def("customers.high_value_min_spend_paise", "money", "customers", "High value (min spend)", "2000000", ""),
  def("customers.inactive_days", "number", "customers", "Inactive (days)", "180", "No order within this window."),

  // ---- seo -----------------------------------------------------------------
  def("seo.meta_title", "string", "seo", "Default meta title", "DIY Baazar - Handmade & Personalised Gifts", "", true),
  def("seo.meta_description", "string", "seo", "Default meta description", "Shop handmade home decor, fashion, jewellery, gifts, stationery and paintings from Indian artisans.", "", true),
  def("seo.og_image_media_id", "string", "seo", "Default share image", "", "Media asset id.", true),
  def("seo.robots_txt", "string", "seo", "robots.txt", "User-agent: *\nAllow: /\n", "", true),
  def("seo.sitemap_enabled", "boolean", "seo", "Sitemap enabled", "true", "", true),

  // ---- social --------------------------------------------------------------
  def("social.facebook", "string", "social", "Facebook", "", "", true),
  def("social.instagram", "string", "social", "Instagram", "", "", true),
  def("social.youtube", "string", "social", "YouTube", "", "", true),
  def("social.whatsapp", "string", "social", "WhatsApp", "", "", true),
  def("social.twitter", "string", "social", "X / Twitter", "", "", true),
  def("social.pinterest", "string", "social", "Pinterest", "", "", true),

  // ---- security ------------------------------------------------------------
  def("security.session_hours", "number", "security", "Session lifetime (hours)", "12", "Absolute admin session lifetime."),
  def("security.idle_minutes", "number", "security", "Idle timeout (minutes)", "60", "Admin sessions expire after this much inactivity."),
  def("security.require_2fa_for_super_admin", "boolean", "security", "Require 2FA for super-admins", "false", ""),

  // ---- notifications -------------------------------------------------------
  def("notifications.digest_enabled", "boolean", "notifications", "Daily digest", "false", "Send a daily email digest of unread notifications."),
];

export const SETTING_KEYS = SETTING_DEFINITIONS.map((item) => item.key) as readonly string[];
export type SettingKey = (typeof SETTING_DEFINITIONS)[number]["key"];

const BY_KEY = new Map(SETTING_DEFINITIONS.map((item) => [item.key, item]));

export function settingDefinition(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}

export function isSettingKey(key: string): boolean {
  return BY_KEY.has(key);
}
