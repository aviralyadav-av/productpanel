import "server-only";

import type { Prisma } from "@prisma/client";

import { asArray, asObject } from "@/lib/json";
import { discountPercentage, isOnSale, paiseToRupees } from "@/lib/money";
import { ORDER_STATUS_META, type OrderStatus } from "@/lib/enums";

/**
 * THE CUTOVER CONTRACT.
 *
 * These functions produce the EXACT JSON the storefront's adapters already
 * return today. Same field names, same types, same null semantics. That is what
 * makes the eventual cutover a base-URL change plus uncommenting an axios call,
 * instead of a rewrite of every component that reads a product.
 *
 * Two rules that are easy to get wrong and expensive to miss:
 *
 *   1. MONEY IS CONVERTED BACK TO RUPEES. The database stores paise. The
 *      storefront reads `price: 2999`. Ship paise and every price on the live
 *      site is 100x too high.
 *
 *   2. ORDER STATUS SHIPS AS ITS DISPLAY STRING. OrderReceipt.jsx and
 *      MyOrders.jsx render `order.status` directly, so they must receive
 *      "ORDER PLACED", not the internal token "PLACED".
 *
 * Fields may be ADDED (the storefront ignores what it does not read). Fields may
 * never be removed or retyped.
 */

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export type PublicProduct = {
  id: string;
  slug: string;
  title: string;
  gender: string;
  category: string;
  subcategory: string;
  price: number;
  description: string;
  isOnSale: boolean;
  salePrice: number | null;
  discountPercentage: number;
  orderCount: number;
  rating: number;
  reviewCount: number;
  createdAt: string;
  isFeatured: boolean;
  variants: Array<{ id: string; name: string; images: string[] }>;
};

export const productInclude = {
  category: { include: { parent: true } },
  variants: {
    where: { isActive: true },
    orderBy: { position: "asc" },
    include: {
      images: {
        orderBy: { position: "asc" },
        include: { media: true },
      },
    },
  },
} satisfies Prisma.ProductInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;

export function toPublicProduct(product: ProductWithRelations): PublicProduct {
  const onSale = isOnSale({
    pricePaise: product.pricePaise,
    salePricePaise: product.salePricePaise,
    saleStartsAt: product.saleStartsAt,
    saleEndsAt: product.saleEndsAt,
  });

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    gender: product.gender,
    // The legacy shape is flat: `category` is the PARENT slug ("bags") and
    // `subcategory` is the child ("handbags"). The database stores a tree.
    category: product.category?.parent?.slug ?? product.category?.slug ?? "",
    subcategory: product.category?.parent
      ? product.category.slug
      : "",
    price: paiseToRupees(product.pricePaise),
    description: product.description,
    isOnSale: onSale,
    salePrice:
      onSale && product.salePricePaise
        ? paiseToRupees(product.salePricePaise)
        : null,
    discountPercentage: onSale
      ? discountPercentage(product.pricePaise, product.salePricePaise)
      : 0,
    orderCount: product.orderCount,
    rating: product.ratingAvg,
    reviewCount: product.reviewCount,
    // The source data uses a plain date, not a timestamp.
    createdAt: product.createdAt.toISOString().slice(0, 10),
    isFeatured: product.isFeatured,
    variants: product.variants.map((variant) => ({
      // Variants had no id for 64 of 78 rows. Shipping a stable id is what stops
      // CartContext's key collapsing to the product id and merging colourways.
      id: variant.id,
      name: variant.name,
      images: variant.images.map((image) => image.media.url),
    })),
  };
}

// ---------------------------------------------------------------------------
// Categories
//
// getCategories() on the storefront derives these from the product list and
// returns { gender, name, filter, image, count }. The shape is reproduced here
// so CategorySection.jsx keeps working untouched.
// ---------------------------------------------------------------------------

export type PublicCategory = {
  gender: string;
  name: string;
  filter: string;
  image: string;
  count: number;
};

export function toPublicCategories(
  products: ProductWithRelations[],
): PublicCategory[] {
  const map = new Map<string, PublicCategory>();

  for (const product of products) {
    const subcategory = product.category?.parent ? product.category.slug : null;
    if (!subcategory) continue;

    const key = `${product.gender}-${subcategory}`;
    const existing = map.get(key);

    if (existing) {
      existing.count += 1;
      continue;
    }

    map.set(key, {
      gender: product.gender,
      name: subcategory,
      filter: subcategory,
      image: product.variants[0]?.images[0]?.media.url ?? "",
      count: 1,
    });
  }

  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Content sections
//
// Each of these returns the shape its component already destructures. The
// database stores blocks generically; the mapping back to the legacy shape
// happens here and nowhere else.
// ---------------------------------------------------------------------------

type BlockRow = { legacyId: string | null; enabled: boolean; payload: unknown };

export function toHeroBanners(blocks: BlockRow[]) {
  return blocks.filter((b) => b.enabled).map((block, index) => {
    const payload = asObject<Record<string, unknown>>(block.payload, {});
    return {
      id: block.legacyId ?? `hero-${index + 1}`,
      image: String(payload.image ?? ""),
      title: String(payload.title ?? ""),
      subtitle: String(payload.subtitle ?? ""),
      buttonText: String(payload.buttonText ?? ""),
      buttonLink: String(payload.buttonLink ?? "/shop"),
    };
  });
}

export function toAnnouncements(blocks: BlockRow[]) {
  return blocks.filter((b) => b.enabled).map((block, index) => {
    const payload = asObject<Record<string, unknown>>(block.payload, {});
    return {
      // The legacy announcements use numeric ids.
      id: Number(block.legacyId ?? index + 1),
      text: String(payload.text ?? ""),
    };
  });
}

export function toPromoBanners(blocks: BlockRow[]) {
  return blocks.map((block, index) => {
    const payload = asObject<Record<string, unknown>>(block.payload, {});
    return {
      id: block.legacyId ?? `promo-${index + 1}`,
      page: String(payload.page ?? "home"),
      position: String(payload.position ?? "after-hero"),
      image: String(payload.image ?? ""),
      title: String(payload.title ?? ""),
      alt: String(payload.alt ?? ""),
      // PromoBanner.jsx filters on `isActive === true`, so this must be a real
      // boolean, not a truthy value.
      isActive: block.enabled,
    };
  });
}

export function toReels(blocks: BlockRow[]) {
  return blocks.map((block, index) => {
    const payload = asObject<Record<string, unknown>>(block.payload, {});
    return {
      id: Number(block.legacyId ?? index + 1),
      video: String(payload.video ?? ""),
      title: String(payload.title ?? ""),
      isActive: block.enabled,
    };
  });
}

export function toTrustBadges(blocks: BlockRow[]) {
  return blocks.filter((b) => b.enabled).map((block) => {
    const payload = asObject<Record<string, unknown>>(block.payload, {});
    return {
      // TrustBadges.jsx currently imports react-icons components directly. Once
      // it reads this endpoint it needs a name -> component map; the icon name
      // is exported here so that map has something to key on.
      icon: String(payload.icon ?? "package"),
      title: String(payload.title ?? ""),
      text: String(payload.text ?? ""),
    };
  });
}

/** campaign_spotlight and brand_craftsmanship are singletons: the payload is the object. */
export function toSectionPayload(payload: unknown) {
  return asObject<Record<string, unknown>>(payload, {});
}

export function toPublicReviews(
  reviews: Array<{
    authorName: string;
    authorLocation: string | null;
    body: string;
    rating: number | null;
  }>,
) {
  return reviews.map((review) => ({
    name: review.authorName,
    location: review.authorLocation ?? "",
    text: review.body,
    // CustomerReviews.jsx renders `review.rating || 5`, so null is safe and
    // means "unrated testimonial" rather than "zero stars".
    rating: review.rating,
  }));
}

// ---------------------------------------------------------------------------
// Footer and CMS pages
// ---------------------------------------------------------------------------

export function toPublicFooter(config: {
  brandName: string;
  brandDescription: string;
  socialLinks: unknown;
  sections: unknown;
  customerService: unknown;
  legalLinks: unknown;
  copyright: string;
}) {
  return {
    brand: {
      name: config.brandName,
      description: config.brandDescription,
    },
    socialLinks: asArray(config.socialLinks),
    sections: asArray(config.sections),
    customerService: asObject(config.customerService, {}),
    legalLinks: asArray(config.legalLinks),
    copyright: config.copyright,
  };
}

export function toPublicPage(
  page: {
    slug: string;
    title: string;
    eyebrow: string | null;
    intro: string | null;
    body: unknown;
    extra: unknown;
  },
  faqs: Array<{ question: string; answer: string }> = [],
) {
  // The legacy pages carry different ad-hoc keys per slug (values[], quote,
  // contactDetails[], faqs[]). `extra` holds whatever that page had, and it is
  // spread back at the top level so each page component finds what it reads.
  const extra = asObject<Record<string, unknown>>(page.extra, {});

  return {
    slug: page.slug,
    eyebrow: page.eyebrow ?? "",
    title: page.title,
    intro: page.intro ?? "",
    sections: asArray(page.body),
    ...extra,
    ...(faqs.length > 0 ? { faqs } : {}),
  };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export function toPublicOrderStatus(status: string): string {
  return ORDER_STATUS_META[status as OrderStatus]?.storefrontLabel ?? status;
}
