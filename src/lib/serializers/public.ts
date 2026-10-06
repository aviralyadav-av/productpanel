import type { Prisma } from "@prisma/client";

import { env } from "@/lib/env";
import { asArray, asObject } from "@/lib/json";
import { discountPercentage, effectivePricePaise, isOnSale, paiseToRupees } from "@/lib/money";
import { sanitizeHtml } from "@/lib/sanitize/html";
import { promotionUnitPrice } from "@/features/finance/math";
import {
  STOREFRONT_PATHS,
  productAvailable,
  resolveLink,
  resolveNavigationLink,
  type PublicLink,
} from "@/features/storefront/links";

/**
 * Public serialisers for `/api/v1/**` (blueprint §14.D11, D12, A10).
 *
 * Every byte the customer website receives passes through a function in this
 * file, and every function is an EXPLICIT allowlist: it names each output key
 * and never spreads a Prisma row. That is what makes the D11 denylist
 * (costPaise, passwordHash, email, phone, pan, gstin, accountNumber, *Enc,
 * *Hash, ipAddress, userAgent, rawPayload, isInternal, draftPayload,
 * commissionPaise, sellerPayablePaise, notes, customerId) enforceable by a
 * deep scan instead of by hope.
 *
 * Conventions the website team can rely on (documented in docs/PUBLIC_API.md):
 *  - money is in RUPEES as a JSON number (paise / 100); the database is paise
 *  - dates are ISO-8601 strings in UTC
 *  - media is `{ url, alt, width, height }` with an ABSOLUTE url, because the
 *    website lives on another origin and "/media/…" would resolve against it
 *  - HTML columns are run through sanitizeHtml again on the way out (D12)
 *  - output is plain JSON: no Date objects, so a cached copy and a fresh
 *    query produce byte-identical bodies
 *
 * The `*_SELECT` constants next to each serialiser are the ONLY shape the
 * serialiser accepts (`Prisma.XGetPayload<{ select }>`), so a query cannot
 * accidentally load a column the serialiser then forgets to drop.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type PublicImage = { url: string; alt: string | null; width: number | null; height: number | null };
export type PublicStockState = "in" | "low" | "out" | "backorder";
export type PublicSeo = {
  metaTitle: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
  canonicalUrl: string | null;
  ogImage: PublicImage | null;
  noIndex: boolean;
};

export const MEDIA_SELECT = { url: true, alt: true, width: true, height: true } satisfies Prisma.MediaAssetSelect;
export type MediaRow = Prisma.MediaAssetGetPayload<{ select: typeof MEDIA_SELECT }>;

/** Rupees from paise; null stays null. Rounded to the paisa so 1234 → 12.34, never 12.340000001. */
export function rupees(paise: number): number;
export function rupees(paise: number | null | undefined): number | null;
export function rupees(paise: number | null | undefined): number | null {
  if (paise === null || paise === undefined) return null;
  return Math.round(paiseToRupees(paise) * 100) / 100;
}

export function toIso(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const value = typeof date === "string" ? new Date(date) : date;
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

/**
 * Absolute URL for a stored media path. MediaAsset.url is "/media/<key>" for
 * the local driver and already absolute for S3/external assets. `new URL`
 * percent-encodes spaces and leaves existing escapes alone, so both the
 * encoded and unencoded legacy forms come out the same.
 */
export function publicMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const value = url.trim();
  if (!value) return null;
  try {
    return new URL(value, env.APP_ORIGIN).toString();
  } catch {
    return null;
  }
}

export function serializeImage(
  media: MediaRow | null | undefined,
  altOverride?: string | null,
): PublicImage | null {
  if (!media) return null;
  const url = publicMediaUrl(media.url);
  if (!url) return null;
  return { url, alt: altOverride ?? media.alt ?? null, width: media.width, height: media.height };
}

const STOCK_RANK: Record<string, number> = { IN_STOCK: 0, LOW_STOCK: 1, BACKORDER: 2, OUT_OF_STOCK: 3 };
const STOCK_PUBLIC: Record<string, PublicStockState> = {
  IN_STOCK: "in",
  LOW_STOCK: "low",
  BACKORDER: "backorder",
  OUT_OF_STOCK: "out",
};

export function publicStockState(state: string | null | undefined): PublicStockState {
  return STOCK_PUBLIC[state ?? ""] ?? "out";
}

/** The best state across a product's purchasable variants; no variants means nothing to buy. */
export function aggregateStockState(
  variants: ReadonlyArray<{ inventory: { stockState: string } | null }>,
): PublicStockState {
  let best: string | null = null;
  for (const variant of variants) {
    const state = variant.inventory?.stockState ?? "OUT_OF_STOCK";
    if (best === null || (STOCK_RANK[state] ?? 3) < (STOCK_RANK[best] ?? 3)) best = state;
  }
  return publicStockState(best);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const CATEGORY_NODE_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  parentId: true,
  path: true,
  depth: true,
  position: true,
  isFeatured: true,
  iconName: true,
  image: { select: MEDIA_SELECT },
  icon: { select: MEDIA_SELECT },
  banner: { select: MEDIA_SELECT },
} satisfies Prisma.CategorySelect;
export type CategoryNodeRow = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_NODE_SELECT }>;

export const CATEGORY_SEO_SELECT = {
  metaTitle: true,
  metaDescription: true,
  metaKeywords: true,
  canonicalUrl: true,
  noIndex: true,
  ogImage: { select: MEDIA_SELECT },
} satisfies Prisma.CategorySelect;
export type CategorySeoRow = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SEO_SELECT }>;

export type PublicCategoryNode = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** Storefront path, e.g. "/c/fashion/kurta". */
  url: string;
  image: PublicImage | null;
  icon: PublicImage | null;
  /** lucide icon name or emoji, for categories without icon media. */
  iconName: string | null;
  banner: PublicImage | null;
  isFeatured: boolean;
  position: number;
  /** Eligible products in this category AND its descendants (A9, never stored). */
  productCount: number;
  children: PublicCategoryNode[];
};

export function serializeCategoryNode(
  row: CategoryNodeRow,
  productCount: number,
  children: PublicCategoryNode[],
): PublicCategoryNode {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    url: STOREFRONT_PATHS.category(row.path),
    image: serializeImage(row.image),
    icon: serializeImage(row.icon),
    iconName: row.iconName,
    banner: serializeImage(row.banner),
    isFeatured: row.isFeatured,
    position: row.position,
    productCount,
    children,
  };
}

export type PublicBreadcrumb = { slug: string; name: string; url: string };

export function serializeBreadcrumb(rows: ReadonlyArray<{ slug: string; name: string; path: string }>): PublicBreadcrumb[] {
  return rows.map((row) => ({ slug: row.slug, name: row.name, url: STOREFRONT_PATHS.category(row.path) }));
}

export type PublicCategoryChild = {
  slug: string;
  name: string;
  url: string;
  image: PublicImage | null;
  icon: PublicImage | null;
  iconName: string | null;
  productCount: number;
};

export function serializeCategoryChild(row: CategoryNodeRow, productCount: number): PublicCategoryChild {
  return {
    slug: row.slug,
    name: row.name,
    url: STOREFRONT_PATHS.category(row.path),
    image: serializeImage(row.image),
    icon: serializeImage(row.icon),
    iconName: row.iconName,
    productCount,
  };
}

export function serializeCategorySeo(row: CategorySeoRow): PublicSeo {
  return {
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    metaKeywords: row.metaKeywords,
    canonicalUrl: row.canonicalUrl,
    ogImage: serializeImage(row.ogImage),
    noIndex: row.noIndex,
  };
}

/** `meta.category` on /products and `category` on /categories/:slug (A10). */
export type PublicCategoryHeader = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  url: string;
  image: PublicImage | null;
  icon: PublicImage | null;
  iconName: string | null;
  banner: PublicImage | null;
  isFeatured: boolean;
  productCount: number;
  breadcrumb: PublicBreadcrumb[];
  children: PublicCategoryChild[];
  seo: PublicSeo;
};

// ---------------------------------------------------------------------------
// Sellers
// ---------------------------------------------------------------------------

/** D11: the public seller fields, and nothing else. */
export const SELLER_CARD_SELECT = {
  slug: true,
  displayName: true,
  description: true,
  city: true,
  state: true,
  ratingAvg: true,
  reviewCount: true,
  createdAt: true,
  logo: { select: MEDIA_SELECT },
  banner: { select: MEDIA_SELECT },
} satisfies Prisma.SellerSelect;
export type SellerCardRow = Prisma.SellerGetPayload<{ select: typeof SELLER_CARD_SELECT }>;

export type PublicSellerCard = {
  slug: string;
  displayName: string;
  url: string;
  description: string | null;
  logo: PublicImage | null;
  banner: PublicImage | null;
  city: string | null;
  state: string | null;
  ratingAvg: number;
  reviewCount: number;
  memberSince: string | null;
};

export function serializeSellerCard(row: SellerCardRow): PublicSellerCard {
  return {
    slug: row.slug,
    displayName: row.displayName,
    url: STOREFRONT_PATHS.seller(row.slug),
    description: row.description,
    logo: serializeImage(row.logo),
    banner: serializeImage(row.banner),
    city: row.city,
    state: row.state,
    ratingAvg: row.ratingAvg,
    reviewCount: row.reviewCount,
    memberSince: toIso(row.createdAt),
  };
}

export type PublicSellerRef = { slug: string; displayName: string; url: string };

export function serializeSellerRef(row: { slug: string; displayName: string } | null): PublicSellerRef | null {
  return row ? { slug: row.slug, displayName: row.displayName, url: STOREFRONT_PATHS.seller(row.slug) } : null;
}

// ---------------------------------------------------------------------------
// Product cards (A10 PublicProduct)
// ---------------------------------------------------------------------------

export const PRODUCT_PRICING_SELECT = {
  pricePaise: true,
  salePricePaise: true,
  saleStartsAt: true,
  saleEndsAt: true,
  effectivePricePaise: true,
  minVariantPricePaise: true,
  maxVariantPricePaise: true,
  promotionPricePaise: true,
  activePromotion: { select: { discountType: true, value: true, badgeText: true, endsAt: true } },
} satisfies Prisma.ProductSelect;

export const PRODUCT_CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  shortDescription: true,
  brand: true,
  isFeatured: true,
  isNewArrival: true,
  isBestseller: true,
  isTrending: true,
  isCustomizable: true,
  ratingAvg: true,
  reviewCount: true,
  createdAt: true,
  publishedAt: true,
  ...PRODUCT_PRICING_SELECT,
  // Primary first; product-level images before variant images; then position.
  images: {
    orderBy: [{ isPrimary: "desc" }, { variantId: { sort: "asc", nulls: "first" } }, { position: "asc" }],
    take: 1,
    select: { alt: true, media: { select: MEDIA_SELECT } },
  },
  seller: { select: { slug: true, displayName: true } },
  category: { select: { slug: true, name: true, path: true } },
  variants: {
    where: { isActive: true, deletedAt: null },
    select: { inventory: { select: { stockState: true } } },
  },
} satisfies Prisma.ProductSelect;
export type ProductCardRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_CARD_SELECT }>;

export type PublicPricing = {
  /** List price (rupees). */
  price: number;
  /** Sale price when the sale window is open, else null (rupees). */
  salePrice: number | null;
  /** What the shopper pays: lowest of list / sale / promotion (rupees, A4). */
  effectivePrice: number;
  /** Lowest / highest variant price (rupees) for "from ₹X" - equal to effectivePrice without variants. */
  priceFrom: number;
  priceTo: number;
  /** Whole-number percentage off the list price, 0 when not discounted. */
  discountPercent: number;
  /** Badge text of the promotion that produced effectivePrice, if any. */
  promotionBadge: string | null;
};

type PricingRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_PRICING_SELECT }>;

/**
 * A4: effectivePricePaise is service-maintained, but a product created before
 * the pricing job ran carries 0 - fall back to the sale-window rule so the
 * storefront never shows ₹0.
 */
export function serializePricing(row: PricingRow, now: Date = new Date()): PublicPricing {
  const saleActive = isOnSale({
    pricePaise: row.pricePaise,
    salePricePaise: row.salePricePaise,
    saleStartsAt: row.saleStartsAt,
    saleEndsAt: row.saleEndsAt,
    now,
  });
  const fallback = effectivePricePaise({
    pricePaise: row.pricePaise,
    salePricePaise: row.salePricePaise,
    saleStartsAt: row.saleStartsAt,
    saleEndsAt: row.saleEndsAt,
    now,
  });
  const effective = row.effectivePricePaise > 0 ? row.effectivePricePaise : fallback;
  const from = row.minVariantPricePaise > 0 ? row.minVariantPricePaise : effective;
  const to = row.maxVariantPricePaise > 0 ? row.maxVariantPricePaise : effective;
  const promotionWon =
    row.activePromotion !== null &&
    row.promotionPricePaise !== null &&
    row.promotionPricePaise === effective &&
    effective < row.pricePaise;

  return {
    price: rupees(row.pricePaise),
    salePrice: saleActive ? rupees(row.salePricePaise as number) : null,
    effectivePrice: rupees(effective),
    priceFrom: rupees(Math.min(from, to)),
    priceTo: rupees(Math.max(from, to)),
    discountPercent: discountPercentage(row.pricePaise, effective),
    promotionBadge: promotionWon ? (row.activePromotion?.badgeText ?? null) : null,
  };
}

export type PublicBadge = "sale" | "new" | "bestseller" | "trending" | "customizable";

export type PublicProductCard = PublicPricing & {
  id: string;
  slug: string;
  title: string;
  url: string;
  shortDescription: string | null;
  brand: string | null;
  image: PublicImage | null;
  badges: PublicBadge[];
  ratingAvg: number;
  reviewCount: number;
  seller: PublicSellerRef | null;
  category: { slug: string; name: string; url: string } | null;
  stockState: PublicStockState;
  isCustomizable: boolean;
  createdAt: string | null;
  publishedAt: string | null;
};

export function serializeProductCard(row: ProductCardRow, now: Date = new Date()): PublicProductCard {
  const pricing = serializePricing(row, now);
  const badges: PublicBadge[] = [];
  if (pricing.discountPercent > 0) badges.push("sale");
  if (row.isNewArrival) badges.push("new");
  if (row.isBestseller) badges.push("bestseller");
  if (row.isTrending) badges.push("trending");
  if (row.isCustomizable) badges.push("customizable");

  const primary = row.images[0];
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    url: STOREFRONT_PATHS.product(row.slug),
    shortDescription: row.shortDescription,
    brand: row.brand,
    image: primary ? serializeImage(primary.media, primary.alt) : null,
    ...pricing,
    badges,
    ratingAvg: row.ratingAvg,
    reviewCount: row.reviewCount,
    seller: serializeSellerRef(row.seller),
    category: row.category
      ? { slug: row.category.slug, name: row.category.name, url: STOREFRONT_PATHS.category(row.category.path) }
      : null,
    stockState: aggregateStockState(row.variants),
    isCustomizable: row.isCustomizable,
    createdAt: toIso(row.createdAt),
    publishedAt: toIso(row.publishedAt),
  };
}

// ---------------------------------------------------------------------------
// Product detail
// ---------------------------------------------------------------------------

export const PRODUCT_DETAIL_SELECT = {
  ...PRODUCT_CARD_SELECT,
  status: true,
  deletedAt: true,
  description: true,
  videoUrl: true,
  minOrderQty: true,
  maxOrderQty: true,
  customFields: true,
  metaTitle: true,
  metaDescription: true,
  metaKeywords: true,
  canonicalUrl: true,
  categoryId: true,
  video: { select: MEDIA_SELECT },
  ogImage: { select: MEDIA_SELECT },
  images: {
    where: { variantId: null },
    orderBy: [{ isPrimary: "desc" }, { position: "asc" }],
    select: { id: true, alt: true, isPrimary: true, media: { select: MEDIA_SELECT } },
  },
  tags: { select: { slug: true, name: true } },
  seller: { select: { ...SELLER_CARD_SELECT, status: true, deletedAt: true } },
  category: {
    select: { id: true, slug: true, name: true, path: true, isActive: true, description: true, image: { select: MEDIA_SELECT } },
  },
  attributeValues: {
    select: {
      attributeId: true,
      textValue: true,
      numberValue: true,
      boolValue: true,
      value: { select: { value: true, label: true, position: true } },
    },
  },
  variants: {
    where: { isActive: true, deletedAt: null },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      sku: true,
      pricePaise: true,
      salePricePaise: true,
      isDefault: true,
      inventory: { select: { stockState: true } },
      attributeValues: {
        select: {
          attribute: { select: { code: true, name: true, position: true } },
          value: { select: { value: true, label: true, colorHex: true, position: true } },
        },
      },
      images: {
        orderBy: { position: "asc" },
        select: { id: true, alt: true, isPrimary: true, media: { select: MEDIA_SELECT } },
      },
    },
  },
  customizationOptions: {
    where: { isActive: true },
    orderBy: { position: "asc" },
    select: {
      id: true,
      type: true,
      label: true,
      helpText: true,
      placeholder: true,
      isRequired: true,
      minLength: true,
      maxLength: true,
      maxFiles: true,
      allowedMimeTypes: true,
      choices: true,
      priceDeltaPaise: true,
    },
  },
} satisfies Prisma.ProductSelect;
export type ProductDetailRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_DETAIL_SELECT }>;

export type PublicGalleryImage = PublicImage & { id: string; isPrimary: boolean };

export function serializeGallery(
  images: ReadonlyArray<{ id: string; alt: string | null; isPrimary: boolean; media: MediaRow }>,
): PublicGalleryImage[] {
  const out: PublicGalleryImage[] = [];
  for (const image of images) {
    const media = serializeImage(image.media, image.alt);
    if (media) out.push({ id: image.id, isPrimary: image.isPrimary, ...media });
  }
  return out;
}

export type PublicVariantOption = {
  attributeCode: string;
  attributeName: string;
  value: string;
  label: string;
  colorHex: string | null;
};

export type PublicVariant = {
  id: string;
  name: string;
  sku: string | null;
  isDefault: boolean;
  price: number;
  salePrice: number | null;
  effectivePrice: number;
  stockState: PublicStockState;
  options: PublicVariantOption[];
  images: PublicGalleryImage[];
};

type VariantRow = ProductDetailRow["variants"][number];

/**
 * Variant prices inherit the product's when null and follow the product's
 * sale window (variants have none of their own); the product's active
 * promotion applies to the variant's own list price. Same rule as
 * computeProductPricing in features/catalog/pricing.ts, per variant.
 */
export function serializeVariant(variant: VariantRow, product: PricingRow, now: Date = new Date()): PublicVariant {
  const list = variant.pricePaise ?? product.pricePaise;
  const sale = variant.salePricePaise ?? (variant.pricePaise === null ? product.salePricePaise : null);
  const windowOpen =
    (!product.saleStartsAt || product.saleStartsAt <= now) && (!product.saleEndsAt || product.saleEndsAt >= now);
  const saleActive = windowOpen && sale !== null && sale > 0 && sale < list;
  const candidates = [list];
  if (saleActive) candidates.push(sale as number);
  if (product.activePromotion) candidates.push(promotionUnitPrice(list, product.activePromotion));
  const effective = Math.min(...candidates);

  return {
    id: variant.id,
    name: variant.name,
    sku: variant.sku,
    isDefault: variant.isDefault,
    price: rupees(list),
    salePrice: saleActive ? rupees(sale as number) : null,
    effectivePrice: rupees(effective),
    stockState: publicStockState(variant.inventory?.stockState),
    options: variant.attributeValues
      .slice()
      .sort((x, y) => x.attribute.position - y.attribute.position || x.attribute.code.localeCompare(y.attribute.code))
      .map((row) => ({
        attributeCode: row.attribute.code,
        attributeName: row.attribute.name,
        value: row.value.value,
        label: row.value.label ?? row.value.value,
        colorHex: row.value.colorHex,
      })),
    images: serializeGallery(variant.images),
  };
}

export type PublicVariantAxis = {
  code: string;
  name: string;
  values: Array<{ value: string; label: string; colorHex: string | null }>;
};

/** The distinct option axes across purchasable variants, in attribute then value order. */
export function serializeVariantAxes(variants: ReadonlyArray<VariantRow>): PublicVariantAxis[] {
  const axes = new Map<string, { name: string; position: number; values: Map<string, { value: string; label: string; colorHex: string | null; position: number }> }>();
  for (const variant of variants) {
    for (const row of variant.attributeValues) {
      const axis = axes.get(row.attribute.code) ?? {
        name: row.attribute.name,
        position: row.attribute.position,
        values: new Map(),
      };
      if (!axis.values.has(row.value.value)) {
        axis.values.set(row.value.value, {
          value: row.value.value,
          label: row.value.label ?? row.value.value,
          colorHex: row.value.colorHex,
          position: row.value.position,
        });
      }
      axes.set(row.attribute.code, axis);
    }
  }
  return [...axes.entries()]
    .sort((x, y) => x[1].position - y[1].position || x[0].localeCompare(y[0]))
    .map(([code, axis]) => ({
      code,
      name: axis.name,
      values: [...axis.values.values()]
        .sort((x, y) => x.position - y.position || x.value.localeCompare(y.value))
        .map(({ value, label, colorHex }) => ({ value, label, colorHex })),
    }));
}

export type PublicCustomizationChoice = {
  value: string;
  label: string;
  /** Per-unit surcharge for this choice (rupees). */
  priceDelta: number;
  image: string | null;
};

export type PublicCustomizationOption = {
  id: string;
  type: string;
  label: string;
  helpText: string | null;
  placeholder: string | null;
  isRequired: boolean;
  minLength: number | null;
  maxLength: number | null;
  maxFiles: number | null;
  allowedMimeTypes: string[];
  choices: PublicCustomizationChoice[];
  /** Per-unit surcharge (rupees). */
  priceDelta: number;
};

type CustomizationRow = ProductDetailRow["customizationOptions"][number];

export function serializeCustomizationOption(row: CustomizationRow): PublicCustomizationOption {
  const choices = asArray<Record<string, unknown>>(row.choices)
    .map((raw) => asObject<Record<string, unknown>>(raw, {}))
    .filter((choice) => typeof choice.value === "string" || typeof choice.label === "string")
    .map((choice) => {
      const value = String(choice.value ?? choice.label ?? "");
      const delta = Number(choice.priceDeltaPaise ?? 0);
      return {
        value,
        label: String(choice.label ?? value),
        priceDelta: rupees(Number.isFinite(delta) ? Math.round(delta) : 0),
        image: typeof choice.imageUrl === "string" ? publicMediaUrl(choice.imageUrl) : null,
      };
    });

  return {
    id: row.id,
    type: row.type,
    label: row.label,
    helpText: row.helpText,
    placeholder: row.placeholder,
    isRequired: row.isRequired,
    minLength: row.minLength,
    maxLength: row.maxLength,
    maxFiles: row.maxFiles,
    allowedMimeTypes: row.allowedMimeTypes,
    choices,
    priceDelta: rupees(row.priceDeltaPaise),
  };
}

export type PublicSpec = { code: string; name: string; unit: string | null; values: string[] };

/** Attribute descriptors the spec builder needs, from the effective set (A1). */
export type SpecAttribute = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  inputType: string;
  position: number;
};

/**
 * A10: `specs = [{ code, name, unit, values:[label] }]` from the effective
 * attributes flagged showInSpecs, followed by the product's free-form
 * customFields so an operator can add a one-off row without an attribute.
 */
export function serializeSpecs(
  attributes: ReadonlyArray<SpecAttribute>,
  values: ProductDetailRow["attributeValues"],
  customFields: unknown,
): PublicSpec[] {
  const byAttribute = new Map<string, ProductDetailRow["attributeValues"]>();
  for (const row of values) {
    const list = byAttribute.get(row.attributeId) ?? [];
    list.push(row);
    byAttribute.set(row.attributeId, list);
  }

  const specs: PublicSpec[] = [];
  for (const attribute of attributes) {
    const rows = byAttribute.get(attribute.id) ?? [];
    const labels: string[] = [];
    for (const row of rows.slice().sort((x, y) => (x.value?.position ?? 0) - (y.value?.position ?? 0))) {
      if (row.value) labels.push(row.value.label ?? row.value.value);
      else if (row.textValue) labels.push(row.textValue);
      else if (row.numberValue !== null) labels.push(String(row.numberValue));
      else if (row.boolValue !== null) labels.push(row.boolValue ? "Yes" : "No");
    }
    if (labels.length > 0) {
      specs.push({ code: attribute.code, name: attribute.name, unit: attribute.unit, values: labels });
    }
  }

  for (const [key, value] of Object.entries(asObject<Record<string, unknown>>(customFields, {}))) {
    if (value === null || value === undefined || value === "") continue;
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    specs.push({ code: key, name: key, unit: null, values: [text] });
  }
  return specs;
}

export type PublicReviewsSummary = {
  average: number;
  count: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
};

export function serializeReviewsSummary(
  buckets: ReadonlyArray<{ rating: number | null; count: number }>,
): PublicReviewsSummary {
  const distribution: PublicReviewsSummary["distribution"] = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  let count = 0;
  let sum = 0;
  for (const bucket of buckets) {
    if (bucket.rating === null || bucket.rating < 1 || bucket.rating > 5) continue;
    const key = String(Math.round(bucket.rating)) as keyof typeof distribution;
    distribution[key] += bucket.count;
    count += bucket.count;
    sum += bucket.rating * bucket.count;
  }
  return { average: count === 0 ? 0 : Math.round((sum / count) * 10) / 10, count, distribution };
}

export type PublicProductDetail = PublicProductCard & {
  /** Sanitised HTML (D12). */
  description: string;
  images: PublicGalleryImage[];
  video: string | null;
  minOrderQty: number;
  maxOrderQty: number | null;
  specs: PublicSpec[];
  variants: PublicVariant[];
  variantAxes: PublicVariantAxis[];
  customizationOptions: PublicCustomizationOption[];
  seller: PublicSellerCard | null;
  category: { id: string; slug: string; name: string; url: string; description: string | null; image: PublicImage | null } | null;
  breadcrumb: PublicBreadcrumb[];
  tags: Array<{ slug: string; name: string }>;
  seo: PublicSeo;
  related: PublicProductCard[];
  reviewsSummary: PublicReviewsSummary;
};

export function serializeProductDetail(
  row: ProductDetailRow,
  extras: {
    specAttributes: ReadonlyArray<SpecAttribute>;
    breadcrumb: ReadonlyArray<{ slug: string; name: string; path: string }>;
    related: PublicProductCard[];
    reviewBuckets: ReadonlyArray<{ rating: number | null; count: number }>;
    now?: Date;
  },
): PublicProductDetail {
  const now = extras.now ?? new Date();
  // The card serialiser wants exactly one image; the detail select loads the
  // whole gallery, so hand it the primary explicitly.
  const primary = row.images[0];
  const card = serializeProductCard(
    { ...row, images: primary ? [{ alt: primary.alt, media: primary.media }] : [] },
    now,
  );
  // A seller who is no longer ACTIVE only shows up under a preview token; the
  // card must still not leak anything beyond the public seller fields.
  const sellerRow = row.seller;
  const seller = sellerRow && sellerRow.status === "ACTIVE" && !sellerRow.deletedAt ? serializeSellerCard(sellerRow) : null;

  return {
    ...card,
    description: sanitizeHtml(row.description, "rich"),
    images: serializeGallery(row.images),
    video: row.videoUrl ?? publicMediaUrl(row.video?.url),
    minOrderQty: row.minOrderQty,
    maxOrderQty: row.maxOrderQty,
    specs: serializeSpecs(extras.specAttributes, row.attributeValues, row.customFields),
    variants: row.variants.map((variant) => serializeVariant(variant, row, now)),
    variantAxes: serializeVariantAxes(row.variants),
    customizationOptions: row.customizationOptions.map(serializeCustomizationOption),
    seller,
    category: row.category
      ? {
          id: row.category.id,
          slug: row.category.slug,
          name: row.category.name,
          url: STOREFRONT_PATHS.category(row.category.path),
          description: row.category.description,
          image: serializeImage(row.category.image),
        }
      : null,
    breadcrumb: serializeBreadcrumb(extras.breadcrumb),
    tags: row.tags.map((tag) => ({ slug: tag.slug, name: tag.name })),
    seo: {
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
      metaKeywords: row.metaKeywords,
      canonicalUrl: row.canonicalUrl,
      ogImage: serializeImage(row.ogImage) ?? (primary ? serializeImage(primary.media, primary.alt) : null),
      noIndex: false,
    },
    related: extras.related,
    reviewsSummary: serializeReviewsSummary(extras.reviewBuckets),
  };
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export const REVIEW_SELECT = {
  id: true,
  authorName: true,
  authorLocation: true,
  rating: true,
  title: true,
  body: true,
  isVerifiedPurchase: true,
  helpfulCount: true,
  reply: true,
  repliedAt: true,
  createdAt: true,
  images: { orderBy: { position: "asc" }, select: { url: true, media: { select: MEDIA_SELECT } } },
  product: { select: { slug: true, title: true, status: true, deletedAt: true, seller: { select: { status: true, deletedAt: true } } } },
} satisfies Prisma.ReviewSelect;
export type ReviewRow = Prisma.ReviewGetPayload<{ select: typeof REVIEW_SELECT }>;

export type PublicReview = {
  id: string;
  authorName: string;
  authorLocation: string | null;
  rating: number | null;
  title: string | null;
  /** Plain text; rendered with HTML escaping by the website. */
  body: string;
  images: PublicImage[];
  isVerifiedPurchase: boolean;
  helpfulCount: number;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string | null;
  /** The reviewed product when it is still on sale; null for seller/site testimonials. */
  product: { slug: string; title: string; url: string } | null;
};

export function serializeReview(row: ReviewRow): PublicReview {
  const images: PublicImage[] = [];
  for (const image of row.images) {
    const fromMedia = serializeImage(image.media);
    if (fromMedia) images.push(fromMedia);
    else {
      const url = publicMediaUrl(image.url);
      if (url) images.push({ url, alt: null, width: null, height: null });
    }
  }
  return {
    id: row.id,
    authorName: row.authorName,
    authorLocation: row.authorLocation,
    rating: row.rating,
    title: row.title,
    body: row.body,
    images,
    isVerifiedPurchase: row.isVerifiedPurchase,
    helpfulCount: row.helpfulCount,
    reply: row.reply,
    repliedAt: toIso(row.repliedAt),
    createdAt: toIso(row.createdAt),
    product: productAvailable(row.product)
      ? { slug: row.product.slug, title: row.product.title, url: STOREFRONT_PATHS.product(row.product.slug) }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

export const BANNER_SELECT = {
  id: true,
  title: true,
  subtitle: true,
  placement: true,
  altText: true,
  linkType: true,
  linkUrl: true,
  buttonText: true,
  textColor: true,
  bgColor: true,
  position: true,
  startsAt: true,
  endsAt: true,
  media: { select: MEDIA_SELECT },
  mobileMedia: { select: MEDIA_SELECT },
  category: { select: { path: true, isActive: true } },
  product: { select: { slug: true, status: true, deletedAt: true, seller: { select: { status: true, deletedAt: true } } } },
  page: { select: { slug: true, status: true } },
} satisfies Prisma.BannerSelect;
export type BannerRow = Prisma.BannerGetPayload<{ select: typeof BANNER_SELECT }>;

export type PublicBanner = {
  id: string;
  title: string;
  subtitle: string | null;
  placement: string;
  image: PublicImage | null;
  mobileImage: PublicImage | null;
  altText: string | null;
  link: PublicLink;
  buttonText: string | null;
  textColor: string | null;
  bgColor: string | null;
  position: number;
  startsAt: string | null;
  endsAt: string | null;
};

export function serializeBanner(row: BannerRow): PublicBanner {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    placement: row.placement,
    image: serializeImage(row.media, row.altText),
    mobileImage: serializeImage(row.mobileMedia, row.altText),
    altText: row.altText,
    link: resolveLink({
      linkType: row.linkType,
      linkUrl: row.linkUrl,
      category: row.category,
      product: row.product,
      page: row.page,
    }),
    buttonText: row.buttonText,
    textColor: row.textColor,
    bgColor: row.bgColor,
    position: row.position,
    startsAt: toIso(row.startsAt),
    endsAt: toIso(row.endsAt),
  };
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export const NAV_ITEM_SELECT = {
  id: true,
  parentId: true,
  label: true,
  type: true,
  url: true,
  iconName: true,
  badgeText: true,
  openInNewTab: true,
  isMegaMenu: true,
  position: true,
  category: { select: { path: true, isActive: true } },
  product: { select: { slug: true, status: true, deletedAt: true, seller: { select: { status: true, deletedAt: true } } } },
  page: { select: { slug: true, status: true } },
} satisfies Prisma.NavigationItemSelect;
export type NavItemRow = Prisma.NavigationItemGetPayload<{ select: typeof NAV_ITEM_SELECT }>;

export type PublicNavItem = {
  id: string;
  label: string;
  type: string;
  url: string | null;
  /** false when the target is missing, unpublished or inactive - render disabled or skip. */
  isAvailable: boolean;
  iconName: string | null;
  badgeText: string | null;
  openInNewTab: boolean;
  isMegaMenu: boolean;
  children: PublicNavItem[];
};

export function serializeNavItem(row: NavItemRow, children: PublicNavItem[]): PublicNavItem {
  const link = resolveNavigationLink({
    type: row.type,
    url: row.url,
    category: row.category,
    product: row.product,
    page: row.page,
  });
  return {
    id: row.id,
    label: row.label,
    type: row.type,
    url: link.url,
    isAvailable: link.isAvailable,
    iconName: row.iconName,
    badgeText: row.badgeText,
    openInNewTab: row.openInNewTab,
    isMegaMenu: row.isMegaMenu,
    children,
  };
}

export type PublicMenu = { slug: string; name: string; items: PublicNavItem[] };

// ---------------------------------------------------------------------------
// CMS pages
// ---------------------------------------------------------------------------

export const CMS_PAGE_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  content: true,
  template: true,
  status: true,
  publishedAt: true,
  updatedAt: true,
  metaTitle: true,
  metaDescription: true,
  metaKeywords: true,
  canonicalUrl: true,
  noIndex: true,
  ogImage: { select: MEDIA_SELECT },
} satisfies Prisma.CmsPageSelect;
export type CmsPageRow = Prisma.CmsPageGetPayload<{ select: typeof CMS_PAGE_SELECT }>;

export type PublicPage = {
  id: string;
  slug: string;
  title: string;
  url: string;
  excerpt: string | null;
  /** Sanitised HTML (D12). */
  content: string;
  /** DEFAULT | ABOUT | CONTACT | FAQ | POLICY - FAQ pages render /faqs beneath the content. */
  template: string;
  publishedAt: string | null;
  updatedAt: string | null;
  seo: PublicSeo;
};

export function serializePage(row: CmsPageRow): PublicPage {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    url: STOREFRONT_PATHS.page(row.slug),
    excerpt: row.excerpt,
    content: sanitizeHtml(row.content, "rich"),
    template: row.template,
    publishedAt: toIso(row.publishedAt),
    updatedAt: toIso(row.updatedAt),
    seo: {
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
      metaKeywords: row.metaKeywords,
      canonicalUrl: row.canonicalUrl,
      ogImage: serializeImage(row.ogImage),
      noIndex: row.noIndex,
    },
  };
}

// ---------------------------------------------------------------------------
// FAQs
// ---------------------------------------------------------------------------

export const FAQ_SELECT = {
  id: true,
  question: true,
  answer: true,
  group: true,
  position: true,
  isFeatured: true,
} satisfies Prisma.FaqSelect;
export type FaqRow = Prisma.FaqGetPayload<{ select: typeof FAQ_SELECT }>;

export type PublicFaq = { id: string; question: string; answer: string; isFeatured: boolean };
export type PublicFaqGroup = { group: string; items: PublicFaq[] };

export function serializeFaq(row: FaqRow): PublicFaq {
  return {
    id: row.id,
    question: row.question,
    answer: sanitizeHtml(row.answer, "basic"),
    isFeatured: row.isFeatured,
  };
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

export const FOOTER_SELECT = {
  brandName: true,
  brandDescription: true,
  socialLinks: true,
  customerService: true,
  legalLinks: true,
  paymentIcons: true,
  appLinks: true,
  copyright: true,
  updatedAt: true,
} satisfies Prisma.FooterConfigSelect;
export type FooterRow = Prisma.FooterConfigGetPayload<{ select: typeof FOOTER_SELECT }>;

export type PublicFooter = {
  brandName: string;
  brandDescription: string;
  socialLinks: Array<{ platform: string; url: string }>;
  /**
   * Public profile URLs from the `social.*` settings (Facebook, Instagram…),
   * empty strings dropped. socialLinks above is the footer's own editable list.
   */
  social: Record<string, string>;
  /** `supportEmail`, not `email`: the D11 scan treats the bare key as a PII leak. */
  customerService: { heading: string | null; description: string | null; supportEmail: string | null };
  legalLinks: Array<{ label: string; url: string }>;
  paymentIcons: string[];
  appLinks: { playStore: string | null; appStore: string | null };
  copyright: string;
  menus: PublicMenu[];
  updatedAt: string | null;
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function serializeFooter(
  row: FooterRow | null,
  social: Record<string, string>,
  menus: PublicMenu[],
): PublicFooter {
  const service = asObject<Record<string, unknown>>(row?.customerService, {});
  const apps = asObject<Record<string, unknown>>(row?.appLinks, {});

  const socialLinks: PublicFooter["socialLinks"] = [];
  for (const raw of asArray<unknown>(row?.socialLinks)) {
    const item = asObject<Record<string, unknown>>(raw, {});
    const platform = optionalString(item.platform);
    const url = safeHttpUrl(item.url);
    if (platform && url) socialLinks.push({ platform, url });
  }

  const legalLinks: PublicFooter["legalLinks"] = [];
  for (const raw of asArray<unknown>(row?.legalLinks)) {
    const item = asObject<Record<string, unknown>>(raw, {});
    const label = optionalString(item.label);
    const url = optionalString(item.path) ?? optionalString(item.url);
    if (label && url && (url.startsWith("/") || /^https?:\/\//i.test(url))) legalLinks.push({ label, url });
  }

  return {
    brandName: row?.brandName ?? "",
    brandDescription: row?.brandDescription ?? "",
    socialLinks,
    social,
    customerService: {
      heading: optionalString(service.heading),
      description: optionalString(service.description),
      supportEmail: optionalString(service.email),
    },
    legalLinks,
    paymentIcons: row?.paymentIcons ?? [],
    appLinks: { playStore: safeHttpUrl(apps.playStore), appStore: safeHttpUrl(apps.appStore) },
    copyright: row?.copyright ?? "",
    menus,
    updatedAt: toIso(row?.updatedAt),
  };
}

function safeHttpUrl(value: unknown): string | null {
  const text = optionalString(value);
  return text && /^https?:\/\//i.test(text) ? text : null;
}

// ---------------------------------------------------------------------------
// Blog
// ---------------------------------------------------------------------------

export const BLOG_CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  tags: true,
  authorName: true,
  publishedAt: true,
  readingMinutes: true,
  isFeatured: true,
  featuredImage: { select: MEDIA_SELECT },
  category: { select: { slug: true, name: true, isActive: true } },
} satisfies Prisma.BlogPostSelect;
export type BlogCardRow = Prisma.BlogPostGetPayload<{ select: typeof BLOG_CARD_SELECT }>;

export type PublicBlogCard = {
  id: string;
  slug: string;
  title: string;
  url: string;
  excerpt: string | null;
  featuredImage: PublicImage | null;
  category: { slug: string; name: string } | null;
  tags: string[];
  authorName: string | null;
  publishedAt: string | null;
  readingMinutes: number | null;
  isFeatured: boolean;
};

export function serializeBlogCard(row: BlogCardRow): PublicBlogCard {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    url: STOREFRONT_PATHS.blog(row.slug),
    excerpt: row.excerpt,
    featuredImage: serializeImage(row.featuredImage),
    category: row.category && row.category.isActive ? { slug: row.category.slug, name: row.category.name } : null,
    tags: row.tags,
    authorName: row.authorName,
    publishedAt: toIso(row.publishedAt),
    readingMinutes: row.readingMinutes,
    isFeatured: row.isFeatured,
  };
}

export const BLOG_DETAIL_SELECT = {
  ...BLOG_CARD_SELECT,
  status: true,
  content: true,
  updatedAt: true,
  metaTitle: true,
  metaDescription: true,
  metaKeywords: true,
  canonicalUrl: true,
  relatedProductIds: true,
  relatedCategoryIds: true,
} satisfies Prisma.BlogPostSelect;
export type BlogDetailRow = Prisma.BlogPostGetPayload<{ select: typeof BLOG_DETAIL_SELECT }>;

export type PublicBlogPost = PublicBlogCard & {
  /** Sanitised HTML (D12). */
  content: string;
  updatedAt: string | null;
  seo: PublicSeo;
  relatedProducts: PublicProductCard[];
  relatedCategories: Array<{ slug: string; name: string; url: string; image: PublicImage | null }>;
};

export function serializeBlogPost(
  row: BlogDetailRow,
  extras: { relatedProducts: PublicProductCard[]; relatedCategories: CategoryNodeRow[] },
): PublicBlogPost {
  const card = serializeBlogCard(row);
  return {
    ...card,
    content: sanitizeHtml(row.content, "rich"),
    updatedAt: toIso(row.updatedAt),
    seo: {
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
      metaKeywords: row.metaKeywords,
      canonicalUrl: row.canonicalUrl,
      ogImage: card.featuredImage,
      noIndex: false,
    },
    relatedProducts: extras.relatedProducts,
    relatedCategories: extras.relatedCategories.map((category) => ({
      slug: category.slug,
      name: category.name,
      url: STOREFRONT_PATHS.category(category.path),
      image: serializeImage(category.image),
    })),
  };
}

export type PublicBlogCategory = { slug: string; name: string; description: string | null; postCount: number };

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

export type PublicHomeSection = {
  key: string;
  type: string;
  title: string;
  subtitle: string | null;
  image: PublicImage | null;
  link: PublicLink;
  buttonText: string | null;
  /** The section payload with internal id lists removed and media ids resolved to URLs. */
  settings: Record<string, unknown>;
  items: unknown[];
};

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

export type PublicSitemapUrl = {
  /** Storefront PATH ("/p/blue-mug"); the website prefixes its own origin. */
  loc: string;
  lastmod: string | null;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
};
