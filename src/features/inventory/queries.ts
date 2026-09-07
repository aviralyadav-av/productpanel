import "server-only";

import { cache } from "react";

import { db } from "@/lib/db";
import { buildPageMeta, type ListParams } from "@/lib/list-params";
import { effectivePricePaise } from "@/lib/money";
import {
  STOCK_MOVEMENT_TYPES,
  stockState,
  type StockMovementType,
  type StockState,
} from "@/lib/enums";

/**
 * Stock levels are read in full and filtered in JavaScript, deliberately.
 *
 * The two facts an operator sorts and filters by - available (onHand minus
 * reserved) and the stock state (available compared against this row's own
 * threshold) - are both comparisons between two columns of the same row.
 * Prisma's `where` cannot express either, so a database-side filter would need
 * raw SQL per branch. This store has 78 variants: the whole table is a handful
 * of kilobytes and one query. If the catalogue ever reaches five figures of
 * variants, add a generated `available` column with an index and move the
 * filtering back into SQL.
 *
 * The movement ledger is the opposite case - it grows without bound - so it is
 * filtered, sorted and paginated in the database.
 */

/** The column default in prisma/schema.prisma, for variants with no row yet. */
const DEFAULT_LOW_STOCK_THRESHOLD = 3;

export type InventoryRow = {
  variantId: string;
  variantName: string;
  sku: string | null;
  isActive: boolean;
  productId: string;
  productTitle: string;
  productStatus: string;
  categoryId: string | null;
  categoryName: string;
  imageUrl: string | null;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  state: StockState;
  unitPricePaise: number;
  valuePaise: number;
  /** False when no InventoryItem row exists yet - it reads as zero on hand. */
  isTracked: boolean;
};

/**
 * A variant with no price of its own inherits the product price, and with it
 * the product sale. A variant that sets its own price owns its own sale price
 * too: inheriting the product sale onto a different base would invent a
 * discount nobody configured.
 */
function resolveUnitPricePaise(
  variant: { pricePaise: number | null; salePricePaise: number | null },
  product: {
    pricePaise: number;
    salePricePaise: number | null;
    saleStartsAt: Date | null;
    saleEndsAt: Date | null;
  },
): number {
  const overridesPrice = variant.pricePaise !== null;

  return effectivePricePaise({
    pricePaise: variant.pricePaise ?? product.pricePaise,
    salePricePaise: overridesPrice
      ? variant.salePricePaise
      : (variant.salePricePaise ?? product.salePricePaise),
    saleStartsAt: product.saleStartsAt,
    saleEndsAt: product.saleEndsAt,
  });
}

/**
 * Cached per request so the KPI row and the table below it share one query
 * instead of reading the same 78 rows twice.
 */
export const getInventoryRows = cache(async (): Promise<InventoryRow[]> => {
  const variants = await db.productVariant.findMany({
    orderBy: [{ product: { title: "asc" } }, { position: "asc" }],
    select: {
      id: true,
      name: true,
      sku: true,
      isActive: true,
      pricePaise: true,
      salePricePaise: true,
      inventory: {
        select: { onHand: true, reserved: true, lowStockThreshold: true },
      },
      images: {
        take: 1,
        orderBy: { position: "asc" },
        select: { media: { select: { url: true } } },
      },
      product: {
        select: {
          id: true,
          title: true,
          status: true,
          pricePaise: true,
          salePricePaise: true,
          saleStartsAt: true,
          saleEndsAt: true,
          categoryId: true,
          category: { select: { id: true, name: true } },
          images: {
            take: 1,
            orderBy: { position: "asc" },
            select: { media: { select: { url: true } } },
          },
        },
      },
    },
  });

  return variants.map((variant) => {
    const onHand = variant.inventory?.onHand ?? 0;
    const reserved = variant.inventory?.reserved ?? 0;
    const lowStockThreshold =
      variant.inventory?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
    const available = onHand - reserved;
    const unitPricePaise = resolveUnitPricePaise(variant, variant.product);

    return {
      variantId: variant.id,
      variantName: variant.name,
      sku: variant.sku,
      isActive: variant.isActive,
      productId: variant.product.id,
      productTitle: variant.product.title,
      productStatus: variant.product.status,
      categoryId: variant.product.categoryId,
      categoryName: variant.product.category?.name ?? "Uncategorised",
      imageUrl:
        variant.images[0]?.media.url ??
        variant.product.images[0]?.media.url ??
        null,
      onHand,
      reserved,
      available,
      lowStockThreshold,
      state: stockState(available, lowStockThreshold),
      unitPricePaise,
      valuePaise: onHand * unitPricePaise,
      isTracked: variant.inventory !== null,
    };
  });
});

export type InventorySummary = Awaited<ReturnType<typeof getInventorySummary>>;

export async function getInventorySummary() {
  const rows = await getInventoryRows();

  const countOf = (state: StockState) =>
    rows.filter((row) => row.state === state).length;

  return {
    variants: rows.length,
    inStock: countOf("IN_STOCK"),
    lowStock: countOf("LOW_STOCK"),
    outOfStock: countOf("OUT_OF_STOCK"),
    unitsOnHand: rows.reduce((sum, row) => sum + row.onHand, 0),
    /**
     * Retail, not cost. Product.costPaise exists in the schema but nothing
     * writes it yet, so a cost valuation here would be a guess.
     */
    retailValuePaise: rows.reduce((sum, row) => sum + row.valuePaise, 0),
    untracked: rows.filter((row) => !row.isTracked).length,
  };
}

export type InventoryCategoryOption = {
  id: string;
  name: string;
  count: number;
};

export type InventoryLevelsResult = {
  rows: InventoryRow[];
  meta: ReturnType<typeof buildPageMeta>;
  counts: Record<"all" | StockState, number>;
  categories: InventoryCategoryOption[];
};

function matchesQuery(row: InventoryRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    row.productTitle.toLowerCase().includes(needle) ||
    row.variantName.toLowerCase().includes(needle) ||
    (row.sku?.toLowerCase().includes(needle) ?? false)
  );
}

export async function getInventoryLevels(
  list: ListParams,
  filters: { stock?: StockState; categoryId?: string } = {},
): Promise<InventoryLevelsResult> {
  const all = await getInventoryRows();

  // The counts on the stock tabs respect the search and the category, but not
  // the stock filter itself - a tab reporting its own filtered count would
  // always read the same number as the rows below it.
  const scoped = all.filter(
    (row) =>
      matchesQuery(row, list.q) &&
      (!filters.categoryId || row.categoryId === filters.categoryId),
  );

  const counts = {
    all: scoped.length,
    IN_STOCK: scoped.filter((row) => row.state === "IN_STOCK").length,
    LOW_STOCK: scoped.filter((row) => row.state === "LOW_STOCK").length,
    OUT_OF_STOCK: scoped.filter((row) => row.state === "OUT_OF_STOCK").length,
  };

  const filtered = filters.stock
    ? scoped.filter((row) => row.state === filters.stock)
    : scoped;

  const direction = list.order === "desc" ? -1 : 1;
  const sorted = [...filtered].sort((a, b) => {
    switch (list.sort) {
      case "title": {
        const byTitle =
          a.productTitle.localeCompare(b.productTitle) ||
          a.variantName.localeCompare(b.variantName);
        return byTitle * direction;
      }
      case "onHand": {
        const byOnHand = a.onHand - b.onHand;
        return byOnHand !== 0
          ? byOnHand * direction
          : a.productTitle.localeCompare(b.productTitle);
      }
      case "available":
      default: {
        const byAvailable = a.available - b.available;
        // Ties break on title so the order is stable between renders.
        return byAvailable !== 0
          ? byAvailable * direction
          : a.productTitle.localeCompare(b.productTitle);
      }
    }
  });

  const meta = buildPageMeta(sorted.length, list);
  // meta.page is clamped to the last page, so a stale ?page= in the URL shows
  // the end of the list rather than an empty table.
  const skip = (meta.page - 1) * meta.pageSize;

  return {
    rows: sorted.slice(skip, skip + meta.pageSize),
    meta,
    counts,
    // Only categories that actually hold a variant, so the filter can never
    // offer a choice that returns nothing.
    categories: buildCategoryOptions(
      all.filter((row) => matchesQuery(row, list.q)),
    ),
  };
}

function buildCategoryOptions(rows: InventoryRow[]): InventoryCategoryOption[] {
  const map = new Map<string, InventoryCategoryOption>();

  for (const row of rows) {
    if (!row.categoryId) continue;
    const existing = map.get(row.categoryId);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(row.categoryId, {
        id: row.categoryId,
        name: row.categoryName,
        count: 1,
      });
    }
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Movement ledger
// ---------------------------------------------------------------------------

export type MovementRow = {
  id: string;
  createdAt: Date;
  type: string;
  delta: number;
  balance: number;
  reason: string | null;
  note: string | null;
  orderId: string | null;
  orderNumber: string | null;
  variantId: string;
  variantName: string;
  productId: string;
  productTitle: string;
  sku: string | null;
  actorName: string | null;
};

export type MovementsResult = {
  rows: MovementRow[];
  meta: ReturnType<typeof buildPageMeta>;
  typeCounts: Array<{ type: StockMovementType; count: number }>;
  total: number;
  /** Set when ?variant= is filtering, so the page can name what it filtered. */
  variantLabel: string | null;
};

export async function getStockMovements(
  list: ListParams,
  filters: { type?: StockMovementType; variantId?: string } = {},
): Promise<MovementsResult> {
  // The type tabs count within the variant scope but ignore the type filter,
  // for the same reason the stock tabs do.
  const scopeWhere = filters.variantId ? { variantId: filters.variantId } : {};
  const where = filters.type
    ? { ...scopeWhere, type: filters.type }
    : scopeWhere;

  const [total, movements, grouped, variant] = await Promise.all([
    db.stockMovement.count({ where }),
    db.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: list.skip,
      take: list.pageSize,
      select: {
        id: true,
        createdAt: true,
        type: true,
        delta: true,
        balance: true,
        reason: true,
        note: true,
        orderId: true,
        order: { select: { orderNumber: true } },
        actor: { select: { name: true, email: true } },
        variant: {
          select: {
            id: true,
            name: true,
            sku: true,
            product: { select: { id: true, title: true } },
          },
        },
      },
    }),
    db.stockMovement.groupBy({
      by: ["type"],
      where: scopeWhere,
      _count: { _all: true },
    }),
    filters.variantId
      ? db.productVariant.findUnique({
          where: { id: filters.variantId },
          select: { name: true, product: { select: { title: true } } },
        })
      : Promise.resolve(null),
  ]);

  const countByType = new Map(
    grouped.map((row) => [row.type, row._count._all] as const),
  );

  return {
    rows: movements.map((movement) => ({
      id: movement.id,
      createdAt: movement.createdAt,
      type: movement.type,
      delta: movement.delta,
      balance: movement.balance,
      reason: movement.reason,
      note: movement.note,
      orderId: movement.orderId,
      orderNumber: movement.order?.orderNumber ?? null,
      variantId: movement.variant.id,
      variantName: movement.variant.name,
      productId: movement.variant.product.id,
      productTitle: movement.variant.product.title,
      sku: movement.variant.sku,
      // A null actor means the seeder or order flow wrote the row, not a person.
      actorName: movement.actor?.name ?? movement.actor?.email ?? null,
    })),
    meta: buildPageMeta(total, list),
    typeCounts: STOCK_MOVEMENT_TYPES.filter((type) =>
      countByType.has(type),
    ).map((type) => ({ type, count: countByType.get(type) ?? 0 })),
    total,
    variantLabel: variant ? `${variant.product.title} · ${variant.name}` : null,
  };
}
