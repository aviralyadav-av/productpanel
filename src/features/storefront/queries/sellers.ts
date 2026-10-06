import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { SELLER_CARD_SELECT, serializeSellerCard, type PublicProductCard, type PublicSellerCard } from "@/lib/serializers/public";
import { listProducts, type ProductListQuery, type ProductSort } from "./products";
import { ACTIVE_SELLER_WHERE, type PageMeta } from "./shared";

/**
 * Seller shop pages for `/api/v1/sellers/:slug` (blueprint §5.3, D11).
 *
 * The profile is the D11 public field list and nothing more; the product
 * strip is the ordinary product listing filtered by seller, so it obeys the
 * same eligibility rule, sorts and page limits as `/products`.
 */

type Db = Prisma.TransactionClient;

export type PublicSellerProfile = PublicSellerCard & {
  /** Eligible (published) products, computed - Seller.publishedProductCount is an admin counter. */
  productCount: number;
};

export type SellerPageResult = {
  data: { seller: PublicSellerProfile; products: PublicProductCard[] };
  meta: PageMeta & { sort: ProductSort };
};

export async function getSellerPage(
  slug: string,
  input: { page: number; pageSize: number; sort: ProductSort },
  tx?: Db,
): Promise<SellerPageResult | null> {
  const client = tx ?? db;
  const seller = await client.seller.findFirst({
    where: { ...ACTIVE_SELLER_WHERE, slug },
    select: SELLER_CARD_SELECT,
  });
  if (!seller) return null;

  const query: ProductListQuery = {
    category: null,
    q: null,
    attr: {},
    minPrice: null,
    maxPrice: null,
    seller: slug,
    featured: false,
    newArrival: false,
    bestseller: false,
    trending: false,
    customizable: false,
    sort: input.sort,
    page: input.page,
    pageSize: input.pageSize,
    includeCategory: false,
    includeFacets: false,
  };
  const products = await listProducts(query, client);

  return {
    data: {
      seller: { ...serializeSellerCard(seller), productCount: products.meta.total },
      products: products.data,
    },
    meta: {
      page: products.meta.page,
      pageSize: products.meta.pageSize,
      total: products.meta.total,
      totalPages: products.meta.totalPages,
      sort: input.sort,
    },
  };
}

/** Seller cards for the homepage `seller_highlights` section. */
export async function getSellerCards(
  input: { source: "auto" | "manual"; sellerIds: readonly string[]; limit: number },
  tx?: Db,
): Promise<PublicSellerCard[]> {
  const client = tx ?? db;
  const rows = await client.seller.findMany({
    where: { ...ACTIVE_SELLER_WHERE, ...(input.source === "manual" ? { id: { in: [...input.sellerIds] } } : {}) },
    orderBy: [{ ratingAvg: "desc" }, { reviewCount: "desc" }, { publishedProductCount: "desc" }, { createdAt: "asc" }],
    take: input.source === "manual" ? undefined : input.limit,
    select: { id: true, ...SELLER_CARD_SELECT },
  });
  const ordered =
    input.source === "manual"
      ? input.sellerIds.map((id) => rows.find((row) => row.id === id)).filter((row): row is (typeof rows)[number] => Boolean(row))
      : rows;
  return ordered.slice(0, input.limit).map(serializeSellerCard);
}
