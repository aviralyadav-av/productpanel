import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import { isOnSale } from "@/lib/money";
import { lineInScope, promotionUnitPrice } from "@/features/finance/math";

/**
 * Effective prices (blueprint §14.A4).
 *
 * The storefront sorts, filters and shows "from ₹X" by `effectivePricePaise`,
 * `minVariantPricePaise` and `maxVariantPricePaise`. They are stored, not
 * computed per request, because "sort by price" over a promotion that applies
 * to a category subtree cannot be expressed in one SQL ORDER BY otherwise.
 * The cost is that they go stale at every sale/promotion boundary - which is
 * what the `pricing.refresh` job scheduled by `schedulePricingRefresh` fixes.
 *
 * Rule: lowest of list price, active sale price, active promotion price wins.
 * Never stacked.
 */

type Db = Prisma.TransactionClient;

export type PromotionRow = {
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
};

export type PricedProduct = {
  id: string;
  categoryId: string | null;
  categoryPath: string | null;
  sellerId: string | null;
  pricePaise: number;
  salePricePaise: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
};

export function promotionActive(promotion: PromotionRow, now: Date): boolean {
  return promotion.isActive && promotion.startsAt <= now && promotion.endsAt >= now;
}

/** Applicable, active promotions - best (lowest resulting price, then priority) first. */
export function findApplicablePromotions(
  product: PricedProduct & { categoryAncestorIds: readonly string[] },
  promotions: readonly PromotionRow[],
  now: Date,
): PromotionRow[] {
  return promotions
    .filter((promotion) => promotionActive(promotion, now))
    .filter((promotion) =>
      lineInScope(promotion, {
        productId: product.id,
        sellerId: product.sellerId,
        categoryAncestorIds: product.categoryAncestorIds,
      }),
    )
    .sort(
      (x, y) =>
        promotionUnitPrice(product.pricePaise, x) - promotionUnitPrice(product.pricePaise, y) ||
        y.priority - x.priority,
    );
}

export type PricingResult = {
  effectivePricePaise: number;
  minVariantPricePaise: number;
  maxVariantPricePaise: number;
  activePromotionId: string | null;
  promotionPricePaise: number | null;
};

/**
 * Pure pricing for one product given its variants and the promotions that
 * apply. Variant prices inherit the product's when null; a variant sale price
 * follows the product's sale window because variants have none of their own.
 */
export function computeProductPricing(input: {
  product: PricedProduct;
  variants: ReadonlyArray<{ pricePaise: number | null; salePricePaise: number | null; isActive: boolean }>;
  promotion: PromotionRow | null;
  now: Date;
}): PricingResult {
  const { product, promotion, now } = input;
  const saleWindowOpen =
    (!product.saleStartsAt || product.saleStartsAt <= now) &&
    (!product.saleEndsAt || product.saleEndsAt >= now);

  const priceOf = (list: number, sale: number | null): { price: number; viaPromotion: boolean; promotionPrice: number | null } => {
    const saleActive = saleWindowOpen && sale !== null && sale > 0 && sale < list;
    const candidates = [list];
    if (saleActive) candidates.push(sale as number);
    const promotionPrice = promotion ? promotionUnitPrice(list, promotion) : null;
    if (promotionPrice !== null) candidates.push(promotionPrice);
    const price = Math.min(...candidates);
    return {
      price,
      viaPromotion: promotionPrice !== null && promotionPrice === price && promotionPrice < (saleActive ? (sale as number) : list),
      promotionPrice,
    };
  };

  const productSale = isOnSale({
    pricePaise: product.pricePaise,
    salePricePaise: product.salePricePaise,
    saleStartsAt: product.saleStartsAt,
    saleEndsAt: product.saleEndsAt,
    now,
  })
    ? product.salePricePaise
    : null;
  const base = priceOf(product.pricePaise, productSale);

  const active = input.variants.filter((variant) => variant.isActive);
  let minVariant = base.price;
  let maxVariant = base.price;
  if (active.length > 0) {
    const prices = active.map((variant) => {
      const list = variant.pricePaise ?? product.pricePaise;
      const sale =
        variant.salePricePaise ?? (variant.pricePaise === null ? product.salePricePaise : null);
      return priceOf(list, sale).price;
    });
    minVariant = Math.min(...prices);
    maxVariant = Math.max(...prices);
  }

  return {
    effectivePricePaise: base.price,
    minVariantPricePaise: minVariant,
    maxVariantPricePaise: maxVariant,
    activePromotionId: base.viaPromotion && promotion ? promotion.id : null,
    promotionPricePaise: base.promotionPrice,
  };
}

async function ancestorIndex(tx: Db): Promise<Array<{ id: string; path: string }>> {
  return tx.category.findMany({ select: { id: true, path: true } });
}

function ancestorsFor(
  categoryPath: string | null,
  categoryId: string | null,
  categories: ReadonlyArray<{ id: string; path: string }>,
): string[] {
  if (!categoryPath) return categoryId ? [categoryId] : [];
  return categories
    .filter((category) => categoryPath === category.path || categoryPath.startsWith(`${category.path}/`))
    .map((category) => category.id);
}

/**
 * Recompute and store pricing columns for a set of products: an explicit list,
 * everything a promotion could touch, or everything under a category. With no
 * selector at all, every live product (the job's nightly safety net).
 */
export async function recomputeProductPricing(
  tx: Db,
  input: { productIds?: readonly string[]; promotionId?: string; categoryId?: string; now?: Date } = {},
): Promise<{ updated: number; productIds: string[] }> {
  const now = input.now ?? new Date();

  const where: Prisma.ProductWhereInput = { deletedAt: null };
  if (input.productIds) where.id = { in: [...input.productIds] };
  if (input.categoryId) {
    const category = await tx.category.findUnique({
      where: { id: input.categoryId },
      select: { path: true },
    });
    if (category) {
      where.OR = [{ categoryPath: category.path }, { categoryPath: { startsWith: `${category.path}/` } }];
    }
  }

  const promotions: PromotionRow[] = await tx.promotion.findMany({
    select: {
      id: true,
      discountType: true,
      value: true,
      appliesTo: true,
      categoryIds: true,
      productIds: true,
      sellerIds: true,
      priority: true,
      startsAt: true,
      endsAt: true,
      isActive: true,
    },
  });

  // For a promotion trigger, also re-price products that USED to carry it, so
  // an expired or narrowed promotion is removed from them.
  if (input.promotionId && !input.productIds) {
    const promotion = promotions.find((row) => row.id === input.promotionId);
    const scoped: Prisma.ProductWhereInput[] = [{ activePromotionId: input.promotionId }];
    if (promotion) {
      switch (promotion.appliesTo) {
        case "PRODUCTS":
          scoped.push({ id: { in: promotion.productIds } });
          break;
        case "SELLERS":
          scoped.push({ sellerId: { in: promotion.sellerIds } });
          break;
        case "CATEGORIES": {
          const categories = await tx.category.findMany({
            where: { id: { in: promotion.categoryIds } },
            select: { path: true },
          });
          for (const category of categories) {
            scoped.push({ categoryPath: category.path }, { categoryPath: { startsWith: `${category.path}/` } });
          }
          break;
        }
        default:
          scoped.push({});
      }
    }
    where.OR = scoped;
  }

  const products = await tx.product.findMany({
    where,
    select: {
      id: true,
      categoryId: true,
      categoryPath: true,
      sellerId: true,
      pricePaise: true,
      salePricePaise: true,
      saleStartsAt: true,
      saleEndsAt: true,
      effectivePricePaise: true,
      minVariantPricePaise: true,
      maxVariantPricePaise: true,
      activePromotionId: true,
      promotionPricePaise: true,
      variants: {
        where: { deletedAt: null },
        select: { pricePaise: true, salePricePaise: true, isActive: true },
      },
    },
  });
  if (products.length === 0) return { updated: 0, productIds: [] };

  const categories = await ancestorIndex(tx);
  let updated = 0;

  for (const product of products) {
    const applicable = findApplicablePromotions(
      { ...product, categoryAncestorIds: ancestorsFor(product.categoryPath, product.categoryId, categories) },
      promotions,
      now,
    );
    const pricing = computeProductPricing({
      product,
      variants: product.variants,
      promotion: applicable[0] ?? null,
      now,
    });

    const unchanged =
      pricing.effectivePricePaise === product.effectivePricePaise &&
      pricing.minVariantPricePaise === product.minVariantPricePaise &&
      pricing.maxVariantPricePaise === product.maxVariantPricePaise &&
      pricing.activePromotionId === product.activePromotionId &&
      pricing.promotionPricePaise === product.promotionPricePaise;

    await tx.product.update({
      where: { id: product.id },
      data: unchanged ? { pricingRecomputedAt: now } : { ...pricing, pricingRecomputedAt: now },
    });
    if (!unchanged) updated += 1;
  }

  return { updated, productIds: products.map((product) => product.id) };
}

/** Job handler body for `pricing.refresh`. */
export async function pricingRefreshJob(payload: {
  productIds?: string[];
  promotionId?: string;
  categoryId?: string;
}): Promise<{ updated: number; scanned: number; nextRefreshAt: string | null }> {
  const result = await db.$transaction(
    (tx) =>
      recomputeProductPricing(tx, {
        productIds: payload.productIds,
        promotionId: payload.promotionId,
        categoryId: payload.categoryId,
      }),
    { timeout: 120_000 },
  );
  const next = await schedulePricingRefresh();
  return { updated: result.updated, scanned: result.productIds.length, nextRefreshAt: next?.toISOString() ?? null };
}

/**
 * Find the next sale/promotion boundary after `now` and queue one refresh for
 * that instant (deduplicated by timestamp). Called after every product or
 * promotion save and by the job itself, so the chain never breaks.
 */
export async function schedulePricingRefresh(tx?: Db, now: Date = new Date()): Promise<Date | null> {
  const client = tx ?? db;
  const [saleStart, saleEnd, promoStart, promoEnd] = await Promise.all([
    client.product.findFirst({ where: { deletedAt: null, saleStartsAt: { gt: now } }, orderBy: { saleStartsAt: "asc" }, select: { saleStartsAt: true } }),
    client.product.findFirst({ where: { deletedAt: null, saleEndsAt: { gt: now } }, orderBy: { saleEndsAt: "asc" }, select: { saleEndsAt: true } }),
    client.promotion.findFirst({ where: { isActive: true, startsAt: { gt: now } }, orderBy: { startsAt: "asc" }, select: { startsAt: true } }),
    client.promotion.findFirst({ where: { isActive: true, endsAt: { gt: now } }, orderBy: { endsAt: "asc" }, select: { endsAt: true } }),
  ]);

  const candidates = [saleStart?.saleStartsAt, saleEnd?.saleEndsAt, promoStart?.startsAt, promoEnd?.endsAt].filter(
    (date): date is Date => date instanceof Date,
  );
  if (candidates.length === 0) return null;

  // One second past the boundary so the window comparison has already flipped.
  const boundary = new Date(Math.min(...candidates.map((date) => date.getTime())) + 1000);
  await enqueue("pricing.refresh", {}, { tx, runAt: boundary, dedupeKey: `pricing.refresh:${boundary.toISOString()}` });
  return boundary;
}
