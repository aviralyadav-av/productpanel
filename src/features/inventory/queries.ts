import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";
import {
  STOCK_MOVEMENT_TYPES,
  STOCK_STATES,
  type StockMovementType,
  type StockState,
} from "@/lib/enums";
import { descendantIds } from "@/features/catalog/category-tree";
import type { EntityRef } from "@/components/shared/entity-picker";
import type { InventoryFilters, InventorySort, MovementFilters } from "./schemas";

// The KPI aggregate lives in its own file to keep this one readable; it is
// re-exported so callers import everything from one place.
export { getInventoryKpis, type InventoryKpis } from "./kpis";

/**
 * Read side of the inventory module (blueprint §1 Inventory, §11.28, F7).
 *
 * Everything here is filtered, sorted and paginated IN THE DATABASE. The
 * projection columns F7 added to InventoryItem (`available`, `stockState`)
 * exist precisely so that "show me what is low" is an indexed equality
 * rather than a per-row comparison in JavaScript, and the ledger grows without
 * bound, so no query in this file reads a table without `take`.
 *
 * The list is anchored on ProductVariant, not InventoryItem: a variant that
 * was never counted has no item row yet, and an operator needs to see it
 * (as zero, "untracked") to give it an opening balance.
 */

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export type VariantOption = { attribute: string; value: string; colorHex: string | null };

export type InventoryRow = {
  variantId: string;
  variantName: string;
  sku: string | null;
  isActive: boolean;
  options: VariantOption[];
  productId: string;
  productTitle: string;
  productStatus: string;
  categoryId: string | null;
  categoryName: string | null;
  sellerId: string | null;
  sellerName: string | null;
  imageUrl: string | null;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  allowBackorder: boolean;
  stockState: StockState;
  /** Unit cost used for the valuation: variant cost, else product cost, else 0. */
  costPaise: number;
  valuePaise: number;
  /** False when no InventoryItem row exists yet - it reads as zero on hand. */
  isTracked: boolean;
  updatedAt: Date | null;
  lastMovement: { at: Date; type: StockMovementType; delta: number } | null;
};

export type InventoryListResult = {
  rows: InventoryRow[];
  meta: PageMeta;
  counts: Record<"all" | StockState, number> & { untracked: number };
};

const ROW_SELECT = {
  id: true,
  name: true,
  sku: true,
  isActive: true,
  costPaise: true,
  inventory: true,
  attributeValues: {
    select: {
      attribute: { select: { name: true, position: true } },
      value: { select: { value: true, label: true, colorHex: true } },
    },
  },
  images: {
    take: 1,
    orderBy: { position: "asc" },
    select: { media: { select: { url: true, thumbnailUrl: true } } },
  },
  movements: {
    take: 1,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true, type: true, delta: true },
  },
  product: {
    select: {
      id: true,
      title: true,
      status: true,
      costPaise: true,
      categoryId: true,
      sellerId: true,
      category: { select: { name: true } },
      seller: { select: { displayName: true } },
      images: {
        where: { variantId: null },
        take: 1,
        orderBy: [{ isPrimary: "desc" }, { position: "asc" }],
        select: { media: { select: { url: true, thumbnailUrl: true } } },
      },
    },
  },
} satisfies Prisma.ProductVariantSelect;

type VariantRecord = Prisma.ProductVariantGetPayload<{ select: typeof ROW_SELECT }>;

/** The column default in prisma/schema.prisma, for variants with no row yet. */
const DEFAULT_LOW_STOCK_THRESHOLD = 3;

export function mapInventoryRow(variant: VariantRecord): InventoryRow {
  const item = variant.inventory;
  const onHand = item?.onHand ?? 0;
  const reserved = item?.reserved ?? 0;
  const costPaise = variant.costPaise ?? variant.product.costPaise ?? 0;
  const last = variant.movements[0];

  return {
    variantId: variant.id,
    variantName: variant.name,
    sku: variant.sku,
    isActive: variant.isActive,
    options: [...variant.attributeValues]
      .sort((a, b) => a.attribute.position - b.attribute.position)
      .map((row) => ({
        attribute: row.attribute.name,
        value: row.value.label ?? row.value.value,
        colorHex: row.value.colorHex,
      })),
    productId: variant.product.id,
    productTitle: variant.product.title,
    productStatus: variant.product.status,
    categoryId: variant.product.categoryId,
    categoryName: variant.product.category?.name ?? null,
    sellerId: variant.product.sellerId,
    sellerName: variant.product.seller?.displayName ?? null,
    imageUrl:
      variant.images[0]?.media.thumbnailUrl ??
      variant.images[0]?.media.url ??
      variant.product.images[0]?.media.thumbnailUrl ??
      variant.product.images[0]?.media.url ??
      null,
    onHand,
    reserved,
    available: item?.available ?? onHand - reserved,
    lowStockThreshold: item?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
    allowBackorder: item?.allowBackorder ?? false,
    stockState: (item?.stockState as StockState | undefined) ?? "OUT_OF_STOCK",
    costPaise,
    valuePaise: onHand * costPaise,
    isTracked: item !== null,
    updatedAt: item?.updatedAt ?? null,
    lastMovement: last
      ? { at: last.createdAt, type: last.type as StockMovementType, delta: last.delta }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Where / orderBy builders (shared with the export stream)
// ---------------------------------------------------------------------------

/**
 * The scope every count on the page respects: search, category, seller and
 * an explicit id list - but NOT the stock-state tab, so a tab can report how
 * many rows it would show before the operator clicks it.
 */
export async function buildVariantScope(
  q: string,
  filters: InventoryFilters,
): Promise<Prisma.ProductVariantWhereInput> {
  const product: Prisma.ProductWhereInput = { deletedAt: null };
  if (filters.categoryId) {
    // "In this category" means the category and everything below it (A2).
    const ids = [filters.categoryId, ...(await descendantIds(undefined, filters.categoryId))];
    product.categoryId = { in: ids };
  }
  if (filters.sellerId) product.sellerId = filters.sellerId;

  const where: Prisma.ProductVariantWhereInput = { deletedAt: null, product };
  if (filters.variantIds) where.id = { in: filters.variantIds };

  const needle = q.trim();
  if (needle) {
    where.OR = [
      { sku: { contains: needle, mode: "insensitive" } },
      { name: { contains: needle, mode: "insensitive" } },
      { product: { title: { contains: needle, mode: "insensitive" } } },
    ];
  }
  return where;
}

export function withStockFilter(
  scope: Prisma.ProductVariantWhereInput,
  filters: InventoryFilters,
): Prisma.ProductVariantWhereInput {
  const inventory: Prisma.InventoryItemWhereInput = {};
  if (filters.stock) inventory.stockState = filters.stock;
  if (filters.thresholdOnly) inventory.lowStockThreshold = { gt: 0 };
  return Object.keys(inventory).length > 0 ? { ...scope, inventory } : scope;
}

export function inventoryOrderBy(
  sort: InventorySort,
  order: "asc" | "desc",
): Prisma.ProductVariantOrderByWithRelationInput[] {
  switch (sort) {
    case "product":
      return [{ product: { title: order } }, { position: "asc" }, { id: "asc" }];
    case "sku":
      return [{ sku: order }, { id: "asc" }];
    case "onHand":
      return [{ inventory: { onHand: order } }, { id: "asc" }];
    case "reserved":
      return [{ inventory: { reserved: order } }, { id: "asc" }];
    case "updated":
      return [{ inventory: { updatedAt: order } }, { id: "asc" }];
    case "available":
    default:
      return [{ inventory: { available: order } }, { id: "asc" }];
  }
}

// ---------------------------------------------------------------------------
// Stock levels list
// ---------------------------------------------------------------------------

export async function listInventory(
  list: ListParams & { sort: InventorySort },
  filters: InventoryFilters,
): Promise<InventoryListResult> {
  const scope = await buildVariantScope(list.q, filters);
  const where = withStockFilter(scope, filters);

  const [total, variants, all, grouped] = await Promise.all([
    db.productVariant.count({ where }),
    db.productVariant.findMany({
      where,
      orderBy: inventoryOrderBy(list.sort, list.order),
      skip: list.skip,
      take: list.pageSize,
      select: ROW_SELECT,
    }),
    db.productVariant.count({ where: scope }),
    db.inventoryItem.groupBy({
      by: ["stockState"],
      where: { variant: scope },
      _count: { _all: true },
    }),
  ]);

  const byState = new Map(grouped.map((row) => [row.stockState, row._count._all] as const));
  const counts = {
    all,
    IN_STOCK: byState.get("IN_STOCK") ?? 0,
    LOW_STOCK: byState.get("LOW_STOCK") ?? 0,
    OUT_OF_STOCK: byState.get("OUT_OF_STOCK") ?? 0,
    BACKORDER: byState.get("BACKORDER") ?? 0,
    untracked: 0,
  };
  counts.untracked = Math.max(
    0,
    all - STOCK_STATES.reduce((sum, state) => sum + counts[state], 0),
  );

  return { rows: variants.map(mapInventoryRow), meta: buildPageMeta(total, list), counts };
}

/** One page of rows for the export stream; same where/order as the table. */
export async function fetchInventoryPage(
  where: Prisma.ProductVariantWhereInput,
  orderBy: Prisma.ProductVariantOrderByWithRelationInput[],
  skip: number,
  take: number,
): Promise<InventoryRow[]> {
  const variants = await db.productVariant.findMany({ where, orderBy, skip, take, select: ROW_SELECT });
  return variants.map(mapInventoryRow);
}

/** Rows for a handful of known variants (bulk dialogs re-reading fresh balances). */
export async function getInventoryRowsByIds(variantIds: readonly string[]): Promise<InventoryRow[]> {
  if (variantIds.length === 0) return [];
  const variants = await db.productVariant.findMany({
    where: { id: { in: [...variantIds] }, deletedAt: null },
    orderBy: [{ product: { title: "asc" } }, { position: "asc" }],
    take: variantIds.length,
    select: ROW_SELECT,
  });
  return variants.map(mapInventoryRow);
}

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

export type CategoryOption = { id: string; name: string; depth: number };

/** Every active category in tree order (path sort), for the category select. */
export async function getCategoryOptions(): Promise<CategoryOption[]> {
  const rows = await db.category.findMany({
    where: { isActive: true },
    orderBy: { path: "asc" },
    take: 2000,
    select: { id: true, name: true, depth: true },
  });
  return rows;
}

/** The chip the seller EntityPicker shows for a `?seller=` already in the URL. */
export async function getSellerRef(sellerId: string): Promise<EntityRef | null> {
  const seller = await db.seller.findUnique({
    where: { id: sellerId },
    select: { id: true, displayName: true, email: true },
  });
  return seller ? { id: seller.id, title: seller.displayName, subtitle: seller.email } : null;
}

// ---------------------------------------------------------------------------
// Movement ledger
// ---------------------------------------------------------------------------

export type MovementRow = {
  id: string;
  createdAt: Date;
  type: StockMovementType;
  delta: number;
  reservedDelta: number;
  balance: number;
  reservedBalance: number;
  reason: string | null;
  note: string | null;
  orderId: string | null;
  orderNumber: string | null;
  variantId: string;
  variantName: string;
  sku: string | null;
  productId: string;
  productTitle: string;
  actorName: string | null;
};

export type MovementListResult = {
  rows: MovementRow[];
  meta: PageMeta;
  typeCounts: Array<{ type: StockMovementType; count: number }>;
};

const MOVEMENT_SELECT = {
  id: true,
  createdAt: true,
  type: true,
  delta: true,
  reservedDelta: true,
  balance: true,
  reservedBalance: true,
  reason: true,
  note: true,
  orderId: true,
  order: { select: { orderNumber: true } },
  actor: { select: { name: true, email: true } },
  variant: {
    select: { id: true, name: true, sku: true, product: { select: { id: true, title: true } } },
  },
} satisfies Prisma.StockMovementSelect;

type MovementRecord = Prisma.StockMovementGetPayload<{ select: typeof MOVEMENT_SELECT }>;

export function mapMovementRow(movement: MovementRecord): MovementRow {
  return {
    id: movement.id,
    createdAt: movement.createdAt,
    type: movement.type as StockMovementType,
    delta: movement.delta,
    reservedDelta: movement.reservedDelta,
    balance: movement.balance,
    reservedBalance: movement.reservedBalance,
    reason: movement.reason,
    note: movement.note,
    orderId: movement.orderId,
    orderNumber: movement.order?.orderNumber ?? null,
    variantId: movement.variant.id,
    variantName: movement.variant.name,
    sku: movement.variant.sku,
    productId: movement.variant.product.id,
    productTitle: movement.variant.product.title,
    // A null actor means order flow, a job or the seed wrote the row, not a person.
    actorName: movement.actor?.name ?? movement.actor?.email ?? null,
  };
}

/** The ledger scope before the type filter: variant, order, date window, search. */
export function buildMovementScope(
  filters: MovementFilters & { q?: string; orderId?: string },
): Prisma.StockMovementWhereInput {
  const where: Prisma.StockMovementWhereInput = {};
  if (filters.variantId) where.variantId = filters.variantId;
  if (filters.orderId) where.orderId = filters.orderId;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  const needle = filters.q?.trim();
  if (needle) {
    where.OR = [
      { variant: { sku: { contains: needle, mode: "insensitive" } } },
      { variant: { name: { contains: needle, mode: "insensitive" } } },
      { variant: { product: { title: { contains: needle, mode: "insensitive" } } } },
      { order: { orderNumber: { contains: needle, mode: "insensitive" } } },
    ];
  }
  return where;
}

export function movementOrderBy(
  sort: string,
  order: "asc" | "desc",
): Prisma.StockMovementOrderByWithRelationInput[] {
  // id breaks ties so two movements in the same millisecond page deterministically.
  return sort === "delta"
    ? [{ delta: order }, { createdAt: "desc" }, { id: "desc" }]
    : [{ createdAt: order }, { id: order }];
}

export async function listStockMovements(
  list: ListParams,
  filters: MovementFilters & { q?: string; orderId?: string },
): Promise<MovementListResult> {
  const scope = buildMovementScope(filters);
  const where = filters.type ? { ...scope, type: filters.type } : scope;

  const [total, rows, grouped] = await Promise.all([
    db.stockMovement.count({ where }),
    db.stockMovement.findMany({
      where,
      orderBy: movementOrderBy(list.sort, list.order),
      skip: list.skip,
      take: list.pageSize,
      select: MOVEMENT_SELECT,
    }),
    db.stockMovement.groupBy({ by: ["type"], where: scope, _count: { _all: true } }),
  ]);

  const countByType = new Map(grouped.map((row) => [row.type, row._count._all] as const));
  return {
    rows: rows.map(mapMovementRow),
    meta: buildPageMeta(total, list),
    typeCounts: STOCK_MOVEMENT_TYPES.filter((type) => countByType.has(type)).map((type) => ({
      type,
      count: countByType.get(type) ?? 0,
    })),
  };
}

export async function fetchMovementPage(
  where: Prisma.StockMovementWhereInput,
  skip: number,
  take: number,
): Promise<MovementRow[]> {
  const rows = await db.stockMovement.findMany({
    where,
    orderBy: movementOrderBy("createdAt", "desc"),
    skip,
    take,
    select: MOVEMENT_SELECT,
  });
  return rows.map(mapMovementRow);
}

// ---------------------------------------------------------------------------
// One variant: header + on-hand series for the history sheet / detail API
// ---------------------------------------------------------------------------

export type VariantInventoryDetail = InventoryRow & {
  /** On-hand balance after each of the most recent movements, oldest first. */
  series: number[];
  movementCount: number;
};

const SERIES_POINTS = 60;

export async function getVariantInventory(variantId: string): Promise<VariantInventoryDetail | null> {
  const [variant, recent, movementCount] = await Promise.all([
    db.productVariant.findFirst({ where: { id: variantId, deletedAt: null }, select: ROW_SELECT }),
    db.stockMovement.findMany({
      where: { variantId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: SERIES_POINTS,
      select: { balance: true },
    }),
    db.stockMovement.count({ where: { variantId } }),
  ]);
  if (!variant) return null;
  return {
    ...mapInventoryRow(variant),
    series: recent.map((row) => row.balance).reverse(),
    movementCount,
  };
}

// ---------------------------------------------------------------------------
// Alerts tab
// ---------------------------------------------------------------------------

export type StockAlerts = {
  low: InventoryRow[];
  out: InventoryRow[];
  lowTotal: number;
  outTotal: number;
};

const ALERT_ROWS = 50;

/**
 * The worst offenders first (fewest available), capped: the tab is a triage
 * list with a quick-adjust button, and the full set lives one click away in
 * the levels table with `?stock=`.
 */
export async function getStockAlerts(): Promise<StockAlerts> {
  const base: Prisma.ProductVariantWhereInput = {
    deletedAt: null,
    isActive: true,
    product: { deletedAt: null },
  };
  const lowWhere = { ...base, inventory: { stockState: "LOW_STOCK" } };
  const outWhere = { ...base, inventory: { stockState: { in: ["OUT_OF_STOCK", "BACKORDER"] } } };
  const orderBy = inventoryOrderBy("available", "asc");

  const [low, out, lowTotal, outTotal] = await Promise.all([
    db.productVariant.findMany({ where: lowWhere, orderBy, take: ALERT_ROWS, select: ROW_SELECT }),
    db.productVariant.findMany({ where: outWhere, orderBy, take: ALERT_ROWS, select: ROW_SELECT }),
    db.productVariant.count({ where: lowWhere }),
    db.productVariant.count({ where: outWhere }),
  ]);

  return {
    low: low.map(mapInventoryRow),
    out: out.map(mapInventoryRow),
    lowTotal,
    outTotal,
  };
}
