import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { stockState, type ProductStatus, type StockState } from "@/lib/enums";
import { discountPercentage, isOnSale } from "@/lib/money";
import type { ListParams } from "@/lib/list-params";
import {
  resolveProductSort,
  type ProductFlag,
  type ProductListFilters,
  type ProductSort,
} from "@/features/products/filters";

/**
 * Read side of the catalogue. Nothing here invents a number: stock is summed
 * from real InventoryItem rows, the discount percentage is computed from the
 * two prices, and "on sale" respects the stored date window.
 *
 * The sort/flag vocabulary these queries accept lives in ./filters, which the
 * Client Component toolbar shares - see the note there.
 */

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

type StockTotals = { available: number; onHand: number; threshold: number };

/**
 * One pass over the 78 inventory rows, keyed by product.
 *
 * Prisma cannot group across a relation, and a product's stock is the sum of
 * its variants' inventory. At this size a single findMany plus a Map is both
 * simpler and faster than a raw aggregate, and it stays dialect-agnostic.
 */
async function getStockByProduct(): Promise<Map<string, StockTotals>> {
  const items = await db.inventoryItem.findMany({
    select: {
      onHand: true,
      reserved: true,
      lowStockThreshold: true,
      variant: { select: { productId: true } },
    },
  });

  const totals = new Map<string, StockTotals>();

  for (const item of items) {
    const key = item.variant.productId;
    const current = totals.get(key) ?? {
      available: 0,
      onHand: 0,
      threshold: 0,
    };
    current.available += item.onHand - item.reserved;
    current.onHand += item.onHand;
    current.threshold += item.lowStockThreshold;
    totals.set(key, current);
  }

  return totals;
}

/**
 * "Sale price below list price" compares two columns of the same row, which
 * Prisma's portable filter language cannot express. Rather than drop to
 * dialect-specific SQL, the handful of rows that actually carry a sale price
 * are read and compared in JavaScript, and the resulting id lists are used as
 * ordinary `in` filters.
 */
async function getSaleFlagIds(): Promise<{
  badSale: string[];
  onSale: string[];
}> {
  const rows = await db.product.findMany({
    where: { salePricePaise: { not: null } },
    select: {
      id: true,
      pricePaise: true,
      salePricePaise: true,
      saleStartsAt: true,
      saleEndsAt: true,
    },
  });

  const now = new Date();

  return {
    badSale: rows
      .filter((row) => (row.salePricePaise ?? 0) >= row.pricePaise)
      .map((row) => row.id),
    onSale: rows
      .filter((row) =>
        isOnSale({
          pricePaise: row.pricePaise,
          salePricePaise: row.salePricePaise,
          saleStartsAt: row.saleStartsAt,
          saleEndsAt: row.saleEndsAt,
          now,
        }),
      )
      .map((row) => row.id),
  };
}

/** "none" filters to products with no category, which is a real state. */
const UNCATEGORISED = "none";

function buildWhere(
  q: string,
  filters: ProductListFilters,
  flags: { badSale: string[]; onSale: string[] },
): Prisma.ProductWhereInput {
  const clauses: Prisma.ProductWhereInput[] = [];

  if (q) {
    clauses.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  if (filters.status) clauses.push({ status: filters.status });
  if (filters.gender) clauses.push({ gender: filters.gender });

  if (filters.categoryId === UNCATEGORISED) {
    clauses.push({ categoryId: null });
  } else if (filters.categoryId) {
    clauses.push({ categoryId: filters.categoryId });
  }

  if (filters.flag === "no-image") clauses.push({ images: { none: {} } });
  if (filters.flag === "bad-sale-price") {
    clauses.push({ id: { in: flags.badSale } });
  }
  if (filters.flag === "on-sale") clauses.push({ id: { in: flags.onSale } });

  return clauses.length > 0 ? { AND: clauses } : {};
}

const LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  status: true,
  gender: true,
  isFeatured: true,
  pricePaise: true,
  salePricePaise: true,
  saleStartsAt: true,
  saleEndsAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  images: {
    take: 1,
    orderBy: { position: "asc" },
    select: { media: { select: { url: true } } },
  },
  _count: { select: { variants: true, images: true } },
} satisfies Prisma.ProductSelect;

export type ProductRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  gender: string;
  isFeatured: boolean;
  categoryName: string | null;
  imageUrl: string | null;
  pricePaise: number;
  salePricePaise: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
  discountPercent: number;
  onSale: boolean;
  saleIsBroken: boolean;
  variantCount: number;
  imageCount: number;
  available: number;
  stockState: StockState;
  updatedAt: Date;
};

function toRow(
  product: Prisma.ProductGetPayload<{ select: typeof LIST_SELECT }>,
  stock: Map<string, StockTotals>,
  now: Date,
): ProductRow {
  const totals = stock.get(product.id) ?? {
    available: 0,
    onHand: 0,
    threshold: 0,
  };

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    status: product.status,
    gender: product.gender,
    isFeatured: product.isFeatured,
    categoryName: product.category?.name ?? null,
    imageUrl: product.images[0]?.media.url ?? null,
    pricePaise: product.pricePaise,
    salePricePaise: product.salePricePaise,
    saleStartsAt: product.saleStartsAt,
    saleEndsAt: product.saleEndsAt,
    discountPercent: discountPercentage(
      product.pricePaise,
      product.salePricePaise,
    ),
    onSale: isOnSale({
      pricePaise: product.pricePaise,
      salePricePaise: product.salePricePaise,
      saleStartsAt: product.saleStartsAt,
      saleEndsAt: product.saleEndsAt,
      now,
    }),
    saleIsBroken:
      product.salePricePaise !== null &&
      product.salePricePaise >= product.pricePaise,
    variantCount: product._count.variants,
    imageCount: product._count.images,
    available: totals.available,
    // A product is low when its total available stock is at or below the sum
    // of its variants' own thresholds - the same rule the inventory page uses
    // per variant, rolled up.
    stockState: stockState(totals.available, totals.threshold),
    updatedAt: product.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Products tab
// ---------------------------------------------------------------------------

export type CategoryOption = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  parentName: string | null;
  productCount: number;
};

export type ProductsTabData = {
  rows: ProductRow[];
  total: number;
  statusCounts: Record<"all" | ProductStatus, number>;
  categories: CategoryOption[];
  genders: Array<{ value: string; count: number }>;
  uncategorisedCount: number;
};

/**
 * One entry point for the whole Products tab so the shared work - the stock
 * roll-up and the sale-price comparison - happens once per request instead of
 * once per widget.
 */
export async function getProductsTabData(
  params: ListParams,
  filters: ProductListFilters,
): Promise<ProductsTabData> {
  const [flags, stock] = await Promise.all([
    getSaleFlagIds(),
    getStockByProduct(),
  ]);

  const where = buildWhere(params.q, filters, flags);
  const sort = resolveProductSort(params.sort);
  const now = new Date();

  const [total, statusGroups, categories, genderGroups, uncategorisedCount] =
    await Promise.all([
      db.product.count({ where }),
      // Status counts ignore the status filter, otherwise every tab but the
      // active one would read zero.
      db.product.groupBy({
        by: ["status"],
        where: buildWhere(params.q, { ...filters, status: undefined }, flags),
        _count: { _all: true },
      }),
      db.category.findMany({
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          slug: true,
          parentId: true,
          parent: { select: { name: true } },
          _count: { select: { products: true } },
        },
      }),
      db.product.groupBy({ by: ["gender"], _count: { _all: true } }),
      db.product.count({ where: { categoryId: null } }),
    ]);

  let rows: ProductRow[];

  if (sort === "stock") {
    // Stock lives in a related table and is a sum, so it cannot be an ORDER BY
    // here. The id list for the current filter is small enough (tens of rows)
    // to sort in memory and slice; if this catalogue ever reaches thousands of
    // products, this branch needs a denormalised stock column.
    const ids = await db.product.findMany({ where, select: { id: true } });

    const ordered = ids
      .map((row) => ({
        id: row.id,
        available: stock.get(row.id)?.available ?? 0,
      }))
      .sort((a, b) =>
        params.order === "asc"
          ? a.available - b.available || a.id.localeCompare(b.id)
          : b.available - a.available || a.id.localeCompare(b.id),
      )
      .slice(params.skip, params.skip + params.pageSize)
      .map((row) => row.id);

    const page = await db.product.findMany({
      where: { id: { in: ordered } },
      select: LIST_SELECT,
    });
    const byId = new Map(page.map((product) => [product.id, product]));

    rows = ordered.flatMap((id) => {
      const product = byId.get(id);
      return product ? [toRow(product, stock, now)] : [];
    });
  } else {
    const orderBy: Prisma.ProductOrderByWithRelationInput[] =
      sort === "title"
        ? [{ title: params.order }, { id: "asc" }]
        : sort === "price"
          ? [{ pricePaise: params.order }, { id: "asc" }]
          : [{ updatedAt: params.order }, { id: "asc" }];

    const page = await db.product.findMany({
      where,
      orderBy,
      skip: params.skip,
      take: params.pageSize,
      select: LIST_SELECT,
    });

    rows = page.map((product) => toRow(product, stock, now));
  }

  const statusCounts = {
    all: 0,
    DRAFT: 0,
    PUBLISHED: 0,
    ARCHIVED: 0,
  } as Record<"all" | ProductStatus, number>;

  for (const group of statusGroups) {
    statusCounts.all += group._count._all;
    if (group.status in statusCounts) {
      statusCounts[group.status as ProductStatus] = group._count._all;
    }
  }

  return {
    rows,
    total,
    statusCounts,
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      parentId: category.parentId,
      parentName: category.parent?.name ?? null,
      productCount: category._count.products,
    })),
    genders: genderGroups
      .map((group) => ({ value: group.gender, count: group._count._all }))
      .sort((a, b) => b.count - a.count),
    uncategorisedCount,
  };
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export type EditorVariant = {
  id: string;
  name: string;
  sku: string | null;
  position: number;
  isActive: boolean;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  hasInventory: boolean;
};

export type EditorImage = {
  id: string;
  mediaId: string;
  url: string;
  filename: string;
  alt: string | null;
  position: number;
  variantId: string | null;
  variantName: string | null;
};

export type MediaOption = {
  id: string;
  url: string;
  filename: string;
  folder: string;
  kind: string;
  alt: string | null;
};

export type ProductEditorData = {
  id: string;
  slug: string;
  title: string;
  description: string;
  gender: string;
  categoryId: string | null;
  status: string;
  isFeatured: boolean;
  position: number;
  pricePaise: number;
  salePricePaise: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
  metaTitle: string | null;
  metaDescription: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  orderItemCount: number;
  reviewCount: number;
  variants: EditorVariant[];
  images: EditorImage[];
};

export async function getProductForEditor(
  id: string,
): Promise<ProductEditorData | null> {
  const product = await db.product.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      gender: true,
      categoryId: true,
      status: true,
      isFeatured: true,
      position: true,
      pricePaise: true,
      salePricePaise: true,
      saleStartsAt: true,
      saleEndsAt: true,
      metaTitle: true,
      metaDescription: true,
      createdAt: true,
      updatedAt: true,
      publishedAt: true,
      _count: { select: { orderItems: true, reviews: true } },
      variants: {
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          sku: true,
          position: true,
          isActive: true,
          inventory: {
            select: {
              onHand: true,
              reserved: true,
              lowStockThreshold: true,
            },
          },
        },
      },
      images: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          mediaId: true,
          alt: true,
          position: true,
          variantId: true,
          variant: { select: { name: true } },
          media: { select: { url: true, filename: true } },
        },
      },
    },
  });

  if (!product) return null;

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    description: product.description,
    gender: product.gender,
    categoryId: product.categoryId,
    status: product.status,
    isFeatured: product.isFeatured,
    position: product.position,
    pricePaise: product.pricePaise,
    salePricePaise: product.salePricePaise,
    saleStartsAt: product.saleStartsAt,
    saleEndsAt: product.saleEndsAt,
    metaTitle: product.metaTitle,
    metaDescription: product.metaDescription,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    publishedAt: product.publishedAt,
    orderItemCount: product._count.orderItems,
    reviewCount: product._count.reviews,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      sku: variant.sku,
      position: variant.position,
      isActive: variant.isActive,
      onHand: variant.inventory?.onHand ?? 0,
      reserved: variant.inventory?.reserved ?? 0,
      available:
        (variant.inventory?.onHand ?? 0) - (variant.inventory?.reserved ?? 0),
      lowStockThreshold: variant.inventory?.lowStockThreshold ?? 0,
      hasInventory: variant.inventory !== null,
    })),
    images: product.images.map((image) => ({
      id: image.id,
      mediaId: image.mediaId,
      url: image.media.url,
      filename: image.media.filename,
      alt: image.alt,
      position: image.position,
      variantId: image.variantId,
      variantName: image.variant?.name ?? null,
    })),
  };
}

export async function getCategoryOptions(): Promise<CategoryOption[]> {
  const categories = await db.category.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      parentId: true,
      parent: { select: { name: true } },
      _count: { select: { products: true } },
    },
  });

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    parentId: category.parentId,
    parentName: category.parent?.name ?? null,
    productCount: category._count.products,
  }));
}

/**
 * The picker over already-imported assets. There is no upload endpoint yet, so
 * this list plus "add by URL" is the entire way an image reaches a product.
 */
export async function getMediaOptions(take = 60): Promise<MediaOption[]> {
  const assets = await db.mediaAsset.findMany({
    orderBy: [{ createdAt: "desc" }],
    take,
    select: {
      id: true,
      url: true,
      filename: true,
      folder: true,
      kind: true,
      alt: true,
    },
  });

  return assets;
}

// ---------------------------------------------------------------------------
// Categories tab
// ---------------------------------------------------------------------------

export type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  position: number;
  isActive: boolean;
  isFeatured: boolean;
  directProductCount: number;
  totalProductCount: number;
  children: CategoryNode[];
};

export async function getCategoryTree(): Promise<CategoryNode[]> {
  const categories = await db.category.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      parentId: true,
      position: true,
      isActive: true,
      isFeatured: true,
      _count: { select: { products: true } },
    },
  });

  const nodes = new Map<string, CategoryNode>(
    categories.map((category) => [
      category.id,
      {
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        parentId: category.parentId,
        position: category.position,
        isActive: category.isActive,
        isFeatured: category.isFeatured,
        directProductCount: category._count.products,
        totalProductCount: category._count.products,
        children: [],
      },
    ]),
  );

  const roots: CategoryNode[] = [];

  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
      // Products hang off the child categories, so a parent's real reach is
      // its own products plus its children's.
      parent.totalProductCount += node.directProductCount;
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ---------------------------------------------------------------------------
// Sale tab
// ---------------------------------------------------------------------------

export type SaleRow = ProductRow & { scheduled: boolean };

export type SaleTabData = {
  rows: SaleRow[];
  onSaleCount: number;
  scheduledCount: number;
  brokenCount: number;
  expiredCount: number;
};

/**
 * The whole catalogue, sale rows first. At 39 products a single table an
 * operator can scan and tick beats a paginated picker.
 */
export async function getSaleTabData(): Promise<SaleTabData> {
  const [products, stock] = await Promise.all([
    db.product.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: [{ title: "asc" }],
      select: LIST_SELECT,
    }),
    getStockByProduct(),
  ]);

  const now = new Date();

  const rows: SaleRow[] = products
    .map((product) => {
      const row = toRow(product, stock, now);
      return {
        ...row,
        scheduled:
          row.salePricePaise !== null &&
          !row.onSale &&
          !row.saleIsBroken &&
          row.saleStartsAt !== null &&
          row.saleStartsAt > now,
      };
    })
    .sort((a, b) => {
      const rank = (row: SaleRow) =>
        row.saleIsBroken ? 0 : row.onSale ? 1 : row.salePricePaise !== null ? 2 : 3;
      return rank(a) - rank(b) || a.title.localeCompare(b.title);
    });

  return {
    rows,
    onSaleCount: rows.filter((row) => row.onSale).length,
    scheduledCount: rows.filter((row) => row.scheduled).length,
    brokenCount: rows.filter((row) => row.saleIsBroken).length,
    expiredCount: rows.filter(
      (row) =>
        row.salePricePaise !== null &&
        !row.onSale &&
        !row.saleIsBroken &&
        row.saleEndsAt !== null &&
        row.saleEndsAt < now,
    ).length,
  };
}
