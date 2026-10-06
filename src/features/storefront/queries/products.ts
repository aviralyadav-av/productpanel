import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { rupeesToPaise } from "@/lib/money";
import {
  PRODUCT_CARD_SELECT,
  PRODUCT_DETAIL_SELECT,
  REVIEW_SELECT,
  rupees,
  serializeProductCard,
  serializeProductDetail,
  serializeReview,
  type PublicCategoryHeader,
  type PublicProductCard,
  type PublicProductDetail,
  type PublicReview,
} from "@/lib/serializers/public";
import { resolveCategoryAttributes, type EffectiveAttribute } from "@/features/catalog/attribute-resolution";
import { buildAttrWhere, buildFacets, parseAttrFilters, type AttrFilters, type Facet } from "@/features/catalog/facets";
import { breadcrumbFor, getCategoryHeader } from "./categories";
import {
  APPROVED_REVIEW_WHERE,
  categorySubtreeWhere,
  eligibleProductWhere,
  flagParam,
  orderByIds,
  pageMeta,
  parsePageInput,
  skipFor,
  textParam,
  type PageInput,
  type PageMeta,
} from "./shared";

/**
 * Product reads for `/api/v1/products*` (blueprint §14.A3, A4, A10 - the
 * fixed contract for the website).
 *
 * Listing = ONE eligibility rule (shared.ts) + the caller's filters, built as
 * an `AND` list so attribute filters (OR within, AND across - A3), the text
 * search's own OR and the flag filters never clobber each other. Facet counts
 * are computed against that same full `where` (A10 v1 semantics) by the
 * shared facet builder; this file only converts its paise to rupees.
 *
 * `parseProductListQuery` produces a NORMALISED object (sorted attribute
 * codes and values, clamped page size) because that object is the cache key.
 */

type Db = Prisma.TransactionClient;

export const PRODUCT_SORTS = ["position", "newest", "price_asc", "price_desc", "popular", "rating"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const PRODUCT_PAGE_SIZE_DEFAULT = 24;
export const PRODUCT_PAGE_SIZE_MAX = 48;

const SORT_ORDER: Record<ProductSort, Prisma.ProductOrderByWithRelationInput[]> = {
  position: [{ position: "asc" }, { createdAt: "desc" }],
  newest: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  price_asc: [{ effectivePricePaise: "asc" }, { position: "asc" }],
  price_desc: [{ effectivePricePaise: "desc" }, { position: "asc" }],
  popular: [{ orderCount: "desc" }, { viewCount: "desc" }, { createdAt: "desc" }],
  rating: [{ ratingAvg: "desc" }, { reviewCount: "desc" }, { createdAt: "desc" }],
};

export function productOrderBy(sort: ProductSort): Prisma.ProductOrderByWithRelationInput[] {
  return SORT_ORDER[sort];
}

export type ProductListQuery = {
  /** Category slug; matches the category AND its descendants. */
  category: string | null;
  q: string | null;
  /** attr[<code>]=v1,v2 / attr[<code>]=min..max, codes and values sorted. */
  attr: AttrFilters;
  /** Rupees. */
  minPrice: number | null;
  maxPrice: number | null;
  /** Seller slug. */
  seller: string | null;
  featured: boolean;
  newArrival: boolean;
  bestseller: boolean;
  trending: boolean;
  customizable: boolean;
  sort: ProductSort;
  page: number;
  pageSize: number;
  includeCategory: boolean;
  includeFacets: boolean;
};

function numberParam(searchParams: URLSearchParams, key: string): number | null {
  const raw = searchParams.get(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function normaliseAttrFilters(filters: AttrFilters): AttrFilters {
  const out: AttrFilters = {};
  for (const code of Object.keys(filters).sort()) {
    const filter = filters[code];
    out[code] = Array.isArray(filter) ? [...new Set(filter)].sort() : filter;
  }
  return out;
}

export function parseProductListQuery(searchParams: URLSearchParams): ProductListQuery {
  const { page, pageSize } = parsePageInput(searchParams, {
    defaultSize: PRODUCT_PAGE_SIZE_DEFAULT,
    maxSize: PRODUCT_PAGE_SIZE_MAX,
  });
  const include = new Set(
    (searchParams.get("include") ?? "")
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
  const sortRaw = (searchParams.get("sort") ?? "").trim() as ProductSort;
  const sort: ProductSort = (PRODUCT_SORTS as readonly string[]).includes(sortRaw) ? sortRaw : "position";

  let minPrice = numberParam(searchParams, "minPrice");
  let maxPrice = numberParam(searchParams, "maxPrice");
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) [minPrice, maxPrice] = [maxPrice, minPrice];

  return {
    category: textParam(searchParams, "category"),
    q: textParam(searchParams, "q", 100),
    attr: normaliseAttrFilters(parseAttrFilters(searchParams)),
    minPrice,
    maxPrice,
    seller: textParam(searchParams, "seller"),
    featured: flagParam(searchParams, "featured"),
    newArrival: flagParam(searchParams, "newArrival"),
    bestseller: flagParam(searchParams, "bestseller"),
    trending: flagParam(searchParams, "trending"),
    customizable: flagParam(searchParams, "customizable"),
    sort,
    page,
    pageSize,
    includeCategory: include.has("category"),
    includeFacets: include.has("facets"),
  };
}

/** A10 `meta.facets` / `meta.builtinFacets` / `meta.priceRange` (rupees). */
export type PublicFacets = {
  facets: Facet[];
  builtinFacets: {
    availability: { inStock: number };
    customizable: { count: number };
    sellers: Array<{ slug: string; name: string; count: number }>;
    rating: Array<{ min: number; count: number }>;
  };
  priceRange: { min: number; max: number } | null;
};

export type ProductListMeta = PageMeta & {
  sort: ProductSort;
  category?: PublicCategoryHeader;
} & Partial<PublicFacets>;

export type ProductListResult = { data: PublicProductCard[]; meta: ProductListMeta };

/**
 * Without a category there is no effective set to filter by, so every active
 * attribute that is filterable by default stands in (A10 "all filterable
 * attributes"), shaped like the resolver's globals so buildAttrWhere and
 * buildFacets need no special case.
 */
async function allFilterableAttributes(client: Db): Promise<EffectiveAttribute[]> {
  const attributes = await client.attribute.findMany({
    where: { isActive: true, isFilterableDefault: true, filterType: { not: "NONE" } },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      inputType: true,
      filterType: true,
      unit: true,
      isVariantDefining: true,
      isFilterableDefault: true,
      isGlobal: true,
      position: true,
      isActive: true,
      values: {
        where: { isActive: true },
        orderBy: [{ position: "asc" }, { value: "asc" }],
        select: { id: true, attributeId: true, value: true, label: true, colorHex: true, position: true, isActive: true },
      },
    },
  });
  return attributes.map(({ values, ...attribute }) => ({
    attribute,
    values,
    source: "global" as const,
    sourceCategoryId: null,
    categoryAttributeId: null,
    isRequired: false,
    isFilterable: true,
    isVariant: attribute.isVariantDefining,
    showInSpecs: true,
    position: attribute.position,
  }));
}

/** GET /api/v1/products */
export async function listProducts(query: ProductListQuery, tx?: Db): Promise<ProductListResult> {
  const client = tx ?? db;
  const now = new Date();

  const categoryResult = query.category ? await getCategoryHeader(query.category, client) : null;
  // An unknown category slug is an empty list, not a 404: the website renders
  // "no products" and the header stays absent from meta.
  if (query.category && !categoryResult) {
    return {
      data: [],
      meta: { ...pageMeta(0, query), sort: query.sort, ...(query.includeFacets ? emptyFacets() : {}) },
    };
  }

  const wantsAttributes = query.includeFacets || Object.keys(query.attr).length > 0;
  const effective = !wantsAttributes
    ? []
    : categoryResult
      ? await resolveCategoryAttributes(categoryResult.id, client)
      : await allFilterableAttributes(client);

  const clauses: Prisma.ProductWhereInput[] = [];
  if (categoryResult) clauses.push(categorySubtreeWhere(categoryResult.path));
  if (query.q) {
    clauses.push({
      OR: [
        { title: { contains: query.q, mode: "insensitive" } },
        { shortDescription: { contains: query.q, mode: "insensitive" } },
        { brand: { contains: query.q, mode: "insensitive" } },
        { tags: { some: { name: { contains: query.q, mode: "insensitive" } } } },
      ],
    });
  }
  if (query.seller) clauses.push({ seller: { slug: query.seller } });
  if (query.featured) clauses.push({ isFeatured: true });
  if (query.newArrival) clauses.push({ isNewArrival: true });
  if (query.bestseller) clauses.push({ isBestseller: true });
  if (query.trending) clauses.push({ isTrending: true });
  if (query.customizable) clauses.push({ isCustomizable: true });
  if (query.minPrice !== null || query.maxPrice !== null) {
    const effectivePricePaise: Prisma.IntFilter = {};
    if (query.minPrice !== null) effectivePricePaise.gte = rupeesToPaise(query.minPrice);
    if (query.maxPrice !== null) effectivePricePaise.lte = rupeesToPaise(query.maxPrice);
    clauses.push({ effectivePricePaise });
  }
  clauses.push(...buildAttrWhere(query.attr, effective));

  const where = eligibleProductWhere(clauses);
  const [total, rows, facets] = await Promise.all([
    client.product.count({ where }),
    client.product.findMany({
      where,
      orderBy: productOrderBy(query.sort),
      skip: skipFor(query),
      take: query.pageSize,
      select: PRODUCT_CARD_SELECT,
    }),
    query.includeFacets
      ? buildFacets(tx, { where, effectiveAttributes: effective, selected: query.attr })
      : Promise.resolve(null),
  ]);

  const meta: ProductListMeta = { ...pageMeta(total, query), sort: query.sort };
  if (query.includeCategory && categoryResult) meta.category = categoryResult.header;
  if (facets) {
    meta.facets = facets.facets;
    meta.builtinFacets = {
      availability: facets.builtinFacets.availability,
      customizable: facets.builtinFacets.customizable,
      sellers: facets.builtinFacets.sellers.map(({ slug, name, count }) => ({ slug, name, count })),
      rating: facets.builtinFacets.rating,
    };
    meta.priceRange = facets.priceRangePaise
      ? { min: rupees(facets.priceRangePaise.min), max: rupees(facets.priceRangePaise.max) }
      : null;
  }

  return { data: rows.map((row) => serializeProductCard(row, now)), meta };
}

function emptyFacets(): PublicFacets {
  return {
    facets: [],
    builtinFacets: { availability: { inStock: 0 }, customizable: { count: 0 }, sellers: [], rating: [] },
    priceRange: null,
  };
}

/**
 * Cards for rails (homepage sections, related products, blog related). Either
 * an explicit id list (kept in the given order, ineligible ids dropped) or a
 * where + orderBy. Always eligibility-filtered.
 */
export async function getProductCards(
  input: {
    ids?: readonly string[];
    where?: ReadonlyArray<Prisma.ProductWhereInput>;
    orderBy?: Prisma.ProductOrderByWithRelationInput[];
    take: number;
  },
  tx?: Db,
): Promise<PublicProductCard[]> {
  const client = tx ?? db;
  const now = new Date();
  if (input.ids) {
    if (input.ids.length === 0) return [];
    const rows = await client.product.findMany({
      where: eligibleProductWhere([{ id: { in: [...input.ids] } }, ...(input.where ?? [])]),
      select: PRODUCT_CARD_SELECT,
    });
    return orderByIds(rows, input.ids)
      .slice(0, input.take)
      .map((row) => serializeProductCard(row, now));
  }
  const rows = await client.product.findMany({
    where: eligibleProductWhere(input.where ?? []),
    orderBy: input.orderBy ?? productOrderBy("position"),
    take: input.take,
    select: PRODUCT_CARD_SELECT,
  });
  return rows.map((row) => serializeProductCard(row, now));
}

/** Any non-deleted product by slug, for preview-token verification (E6). */
export async function findProductIdBySlug(slug: string, tx?: Db): Promise<string | null> {
  const row = await (tx ?? db).product.findFirst({ where: { slug, deletedAt: null }, select: { id: true } });
  return row?.id ?? null;
}

export const RELATED_PRODUCTS_LIMIT = 8;

/**
 * GET /api/v1/products/:slug. `preview` lifts the status/seller filter for a
 * row the route has already authorised with a token; deleted rows never show.
 */
export async function getProductDetail(
  slug: string,
  options: { preview?: boolean } = {},
  tx?: Db,
): Promise<PublicProductDetail | null> {
  const client = tx ?? db;
  const now = new Date();
  const row = await client.product.findFirst({
    where: options.preview ? { slug, deletedAt: null } : eligibleProductWhere([{ slug }]),
    select: PRODUCT_DETAIL_SELECT,
  });
  if (!row) return null;

  const [effective, breadcrumb, related, buckets] = await Promise.all([
    resolveCategoryAttributes(row.categoryId, client),
    row.category ? breadcrumbFor(client, row.category.path) : Promise.resolve([]),
    row.category
      ? getProductCards(
          {
            where: [{ id: { not: row.id } }, categorySubtreeWhere(row.category.path)],
            orderBy: productOrderBy("popular"),
            take: RELATED_PRODUCTS_LIMIT,
          },
          client,
        )
      : Promise.resolve([]),
    client.review.groupBy({
      by: ["rating"],
      where: { ...APPROVED_REVIEW_WHERE, productId: row.id },
      _count: { _all: true },
    }),
  ]);

  return serializeProductDetail(row, {
    specAttributes: effective
      .filter((entry) => entry.showInSpecs)
      .map((entry) => ({
        id: entry.attribute.id,
        code: entry.attribute.code,
        name: entry.attribute.name,
        unit: entry.attribute.unit,
        inputType: entry.attribute.inputType,
        position: entry.position,
      })),
    breadcrumb,
    related,
    reviewBuckets: buckets.map((bucket) => ({ rating: bucket.rating, count: bucket._count._all })),
    now,
  });
}

export const REVIEW_PAGE_SIZE_DEFAULT = 10;
export const REVIEW_PAGE_SIZE_MAX = 50;

/** GET /api/v1/products/:slug/reviews - null when the product is not on sale. */
export async function listProductReviews(
  slug: string,
  page: PageInput,
  tx?: Db,
): Promise<{ data: PublicReview[]; meta: PageMeta } | null> {
  const client = tx ?? db;
  const product = await client.product.findFirst({ where: eligibleProductWhere([{ slug }]), select: { id: true } });
  if (!product) return null;

  const where: Prisma.ReviewWhereInput = { ...APPROVED_REVIEW_WHERE, productId: product.id };
  const [total, rows] = await Promise.all([
    client.review.count({ where }),
    client.review.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: skipFor(page),
      take: page.pageSize,
      select: REVIEW_SELECT,
    }),
  ]);
  return { data: rows.map(serializeReview), meta: pageMeta(total, page) };
}
