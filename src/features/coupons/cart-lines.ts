import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { isOnSale } from "@/lib/money";
import { promotionUnitPrice } from "@/features/finance/math";
import { promotionActive } from "@/features/catalog/pricing";

import type { CartLine } from "./rules";

/**
 * Turn `{ productId, variantId?, quantity }` items from the storefront into
 * priced `CartLine`s for the rule engine: published products only (seller
 * active or platform-owned, category active), active non-deleted variants,
 * the sale price when its window is open, and the product's active promotion
 * allocated per unit so the coupon is computed on what the promotion left
 * (B2). Unknown or unavailable items are reported, not silently dropped, so
 * the caller can decide whether that invalidates the cart.
 *
 * No next/server-only imports: the public route, the check script and any
 * checkout code can all use it.
 */

export type CartItemInput = { productId: string; variantId?: string | null; quantity: number };

export type LoadedCart = {
  lines: CartLine[];
  /** Items whose product/variant is not purchasable right now. */
  missing: CartItemInput[];
  /** Σ lineGross − promotion, the figure minimum-order checks use. */
  subtotalPaise: number;
};

const ELIGIBLE: Prisma.ProductWhereInput = {
  status: "PUBLISHED",
  deletedAt: null,
  AND: [
    { OR: [{ sellerId: null }, { seller: { status: "ACTIVE", deletedAt: null } }] },
    { OR: [{ categoryId: null }, { category: { isActive: true } }] },
  ],
};

export async function loadCartLines(
  items: readonly CartItemInput[],
  options: { tx?: Prisma.TransactionClient; now?: Date } = {},
): Promise<LoadedCart> {
  const client = options.tx ?? db;
  const now = options.now ?? new Date();
  if (items.length === 0) return { lines: [], missing: [], subtotalPaise: 0 };

  const products = await client.product.findMany({
    where: { ...ELIGIBLE, id: { in: [...new Set(items.map((item) => item.productId))] } },
    select: {
      id: true,
      sellerId: true,
      categoryId: true,
      categoryPath: true,
      pricePaise: true,
      salePricePaise: true,
      saleStartsAt: true,
      saleEndsAt: true,
      activePromotionId: true,
      variants: {
        where: { isActive: true, deletedAt: null },
        select: { id: true, pricePaise: true, salePricePaise: true },
      },
    },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  const promotionIds = [...new Set(products.map((product) => product.activePromotionId).filter((id): id is string => Boolean(id)))];
  const promotions =
    promotionIds.length > 0
      ? await client.promotion.findMany({
          where: { id: { in: promotionIds } },
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
        })
      : [];
  const promotionById = new Map(promotions.filter((promotion) => promotionActive(promotion, now)).map((promotion) => [promotion.id, promotion]));

  const lines: CartLine[] = [];
  const missing: CartItemInput[] = [];

  for (const item of items) {
    const product = byId.get(item.productId);
    const quantity = Math.max(1, Math.floor(item.quantity));
    if (!product) {
      missing.push(item);
      continue;
    }

    let listPaise = product.pricePaise;
    let salePaise = product.salePricePaise;
    if (item.variantId) {
      const variant = product.variants.find((row) => row.id === item.variantId);
      if (!variant) {
        missing.push(item);
        continue;
      }
      listPaise = variant.pricePaise ?? product.pricePaise;
      // A variant sale price follows the product's window; a variant with its
      // own list price does not inherit the product's sale (pricing.ts rule).
      salePaise = variant.salePricePaise ?? (variant.pricePaise === null ? product.salePricePaise : null);
    }

    const saleActive = isOnSale({ pricePaise: listPaise, salePricePaise: salePaise, saleStartsAt: product.saleStartsAt, saleEndsAt: product.saleEndsAt, now });
    const unitPricePaise = saleActive && salePaise !== null ? salePaise : listPaise;

    const promotion = product.activePromotionId ? promotionById.get(product.activePromotionId) : undefined;
    const promotedUnit = promotion ? Math.min(unitPricePaise, promotionUnitPrice(listPaise, promotion)) : unitPricePaise;
    const promotionDiscountPaise = Math.max(0, unitPricePaise - promotedUnit) * quantity;

    lines.push({
      productId: product.id,
      variantId: item.variantId ?? null,
      sellerId: product.sellerId,
      categoryId: product.categoryId,
      categoryPath: product.categoryPath,
      quantity,
      unitPricePaise,
      customizationPaise: 0,
      promotionDiscountPaise,
    });
  }

  const subtotalPaise = lines.reduce((sum, line) => sum + Math.max(0, line.unitPricePaise * line.quantity - (line.promotionDiscountPaise ?? 0)), 0);
  return { lines, missing, subtotalPaise };
}
