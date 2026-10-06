import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * In-memory registry shared by the demo modules within ONE seed run.
 *
 * Modules run in a fixed order (media → sellers → products → customers →
 * marketing → orders → returns → content) and each one RELOADS what it owns
 * from the database after upserting, so a second run - where every upsert is
 * a no-op - still hands the later modules the same ids as the first. Nothing
 * here is persisted; it is a cache of rows that already exist.
 *
 * Every demo row id starts with `demo_` (DEMO_PREFIX) so the dashboard can
 * detect demo data with one `startsWith` query.
 */
export const DEMO_PREFIX = "demo_";

export type DemoCategory = {
  id: string;
  slug: string;
  name: string;
  path: string;
  depth: number;
  parentId: string | null;
  isLeaf: boolean;
};

export type DemoSeller = {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  city: string | null;
  state: string | null;
  email: string;
};

export type DemoVariant = {
  id: string;
  productId: string;
  name: string;
  sku: string | null;
  optionKey: string | null;
  pricePaise: number | null;
  salePricePaise: number | null;
  isDefault: boolean;
  isActive: boolean;
  /** Labels by attribute name, e.g. { Colour: "Red", Size: "M" }. */
  attributes: Record<string, string>;
  /** Tracked while the orders module runs so reservations never overdraw. */
  available: number;
  allowBackorder: boolean;
};

export type DemoOption = {
  id: string;
  type: string;
  label: string;
  isRequired: boolean;
  priceDeltaPaise: number;
  maxFiles: number | null;
  choices: Array<{ value: string; label: string; priceDeltaPaise: number }>;
};

export type DemoProduct = {
  id: string;
  slug: string;
  title: string;
  brand: string | null;
  status: string;
  categoryId: string | null;
  categoryPath: string | null;
  sellerId: string | null;
  pricePaise: number;
  salePricePaise: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
  taxRateBps: number | null;
  hsnCode: string | null;
  costPaise: number | null;
  isCustomizable: boolean;
  isBestseller: boolean;
  createdAt: Date;
  imageUrl: string | null;
  variants: DemoVariant[];
  options: DemoOption[];
};

export type DemoAddress = {
  id: string;
  fullName: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pinCode: string;
  type: string;
  isDefault: boolean;
};

export type DemoCustomer = {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  status: string;
  createdAt: Date;
  addresses: DemoAddress[];
};

export type DemoCoupon = {
  id: string;
  code: string;
  type: string;
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number | null;
  appliesTo: string;
  categoryIds: string[];
  productIds: string[];
  sellerIds: string[];
  excludedProductIds: string[];
  usageLimit: number | null;
  usageCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  fundedBy: string;
  customerIds: string[];
  firstOrderOnly: boolean;
};

export type DemoPromotion = {
  id: string;
  discountType: string;
  value: number;
  appliesTo: string;
  categoryIds: string[];
  productIds: string[];
  sellerIds: string[];
  priority: number;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  fundedBy: string;
};

export type DemoState = {
  /** Fixed at the start of the run so every module agrees on "now". */
  now: Date;
  categories: Map<string, DemoCategory>;
  categoryById: Map<string, DemoCategory>;
  /** MediaAsset ids by logical name (e.g. "banner:hero-1", "category:candles"). */
  media: Map<string, string>;
  /** Public URL by MediaAsset id, for snapshots (OrderItem.imageUrl, ReviewImage.url). */
  mediaUrl: Map<string, string>;
  /** Registered public/legacy photos grouped by their sub-folder (handbags, tote, ...). */
  legacyPhotos: Map<string, Array<{ id: string; url: string; kind: string }>>;
  sellers: DemoSeller[];
  products: DemoProduct[];
  customers: DemoCustomer[];
  coupons: DemoCoupon[];
  promotions: DemoPromotion[];
  /** Order ids created (or found) by the orders module, in placement order. */
  orderIds: string[];
};

export const state: DemoState = {
  now: new Date(),
  categories: new Map(),
  categoryById: new Map(),
  media: new Map(),
  mediaUrl: new Map(),
  legacyPhotos: new Map(),
  sellers: [],
  products: [],
  customers: [],
  coupons: [],
  promotions: [],
  orderIds: [],
};

/** `demoId("prod", 7)` → `demo_prod_007`; `demoId("order", 1234)` → `demo_order_1234`. */
export function demoId(kind: string, ...parts: Array<number | string>): string {
  const suffix = parts
    .map((part) => (typeof part === "number" ? String(part).padStart(3, "0") : part))
    .join("_");
  return `${DEMO_PREFIX}${kind}${suffix ? `_${suffix}` : ""}`;
}

export function categoryBySlug(slug: string): DemoCategory {
  const category = state.categories.get(slug);
  if (!category) throw new Error(`Demo seed references unknown category slug "${slug}"`);
  return category;
}

/** Category ids root → leaf for a slug path such as "/fashion/kurta/mens-kurta". */
export function ancestorIdsForPath(path: string | null): string[] {
  if (!path) return [];
  const segments = path.split("/").filter(Boolean);
  const ids: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const prefix = `/${segments.slice(0, index + 1).join("/")}`;
    for (const category of state.categories.values()) {
      if (category.path === prefix) ids.push(category.id);
    }
  }
  return ids;
}

export async function loadCategories(db: PrismaClient): Promise<void> {
  const rows = await db.category.findMany({
    select: { id: true, slug: true, name: true, path: true, depth: true, parentId: true },
  });
  const parents = new Set(rows.map((row) => row.parentId).filter((id): id is string => Boolean(id)));
  state.categories.clear();
  state.categoryById.clear();
  for (const row of rows) {
    const category: DemoCategory = { ...row, isLeaf: !parents.has(row.id) };
    state.categories.set(row.slug, category);
    state.categoryById.set(row.id, category);
  }
}

export function mediaId(name: string): string {
  const id = state.media.get(name);
  if (!id) throw new Error(`Demo seed has no media registered as "${name}"`);
  return id;
}

export function registerMedia(name: string, id: string, url: string): void {
  state.media.set(name, id);
  state.mediaUrl.set(id, url);
}

export function mediaUrlOf(id: string | null | undefined): string | null {
  return id ? state.mediaUrl.get(id) ?? null : null;
}

export type Tx = Prisma.TransactionClient;

/** Interactive transaction with a generous timeout; the default 5 s is too tight for a product with variants. */
export function transaction<T>(db: PrismaClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(fn, { timeout: 120_000, maxWait: 30_000 });
}

/** Deterministic Indian sample data shared by sellers and customers. */
export const INDIAN_CITIES: ReadonlyArray<{ city: string; state: string; pin: string }> = [
  { city: "Jaipur", state: "Rajasthan", pin: "302001" },
  { city: "Udaipur", state: "Rajasthan", pin: "313001" },
  { city: "Ahmedabad", state: "Gujarat", pin: "380001" },
  { city: "Surat", state: "Gujarat", pin: "395003" },
  { city: "Mumbai", state: "Maharashtra", pin: "400001" },
  { city: "Pune", state: "Maharashtra", pin: "411001" },
  { city: "Nagpur", state: "Maharashtra", pin: "440001" },
  { city: "New Delhi", state: "Delhi", pin: "110001" },
  { city: "Gurugram", state: "Haryana", pin: "122001" },
  { city: "Noida", state: "Uttar Pradesh", pin: "201301" },
  { city: "Lucknow", state: "Uttar Pradesh", pin: "226001" },
  { city: "Varanasi", state: "Uttar Pradesh", pin: "221001" },
  { city: "Kolkata", state: "West Bengal", pin: "700001" },
  { city: "Bhubaneswar", state: "Odisha", pin: "751001" },
  { city: "Patna", state: "Bihar", pin: "800001" },
  { city: "Madhubani", state: "Bihar", pin: "847211" },
  { city: "Bengaluru", state: "Karnataka", pin: "560001" },
  { city: "Mysuru", state: "Karnataka", pin: "570001" },
  { city: "Chennai", state: "Tamil Nadu", pin: "600001" },
  { city: "Coimbatore", state: "Tamil Nadu", pin: "641001" },
  { city: "Hyderabad", state: "Telangana", pin: "500001" },
  { city: "Kochi", state: "Kerala", pin: "682001" },
  { city: "Thiruvananthapuram", state: "Kerala", pin: "695001" },
  { city: "Indore", state: "Madhya Pradesh", pin: "452001" },
  { city: "Bhopal", state: "Madhya Pradesh", pin: "462001" },
  { city: "Chandigarh", state: "Chandigarh", pin: "160017" },
  { city: "Amritsar", state: "Punjab", pin: "143001" },
  { city: "Dehradun", state: "Uttarakhand", pin: "248001" },
  { city: "Guwahati", state: "Assam", pin: "781001" },
  { city: "Panaji", state: "Goa", pin: "403001" },
];

export const STREETS: readonly string[] = [
  "MG Road",
  "Station Road",
  "Nehru Nagar",
  "Gandhi Marg",
  "Lake View Colony",
  "Civil Lines",
  "Park Street",
  "Rajaji Nagar",
  "Sector 15",
  "Model Town",
  "Anna Salai",
  "Banjara Hills",
  "Koregaon Park",
  "Salt Lake",
  "Vasant Vihar",
];
