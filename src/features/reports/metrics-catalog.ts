import { Prisma } from "@prisma/client";

import type { StockState } from "@/lib/enums";
import { humanizeSlug, type CategoryLevel } from "./bucketing";
import { client, itemConditions, num, whereAll, type Db, type ItemFilters, type MetricRange } from "./sql";

/**
 * Catalogue-side metrics: what sold, by product and by category, and what
 * the shelves are worth. Sales figures are LINE-level (E4 revenue lives at
 * the order level and cannot be split by product):
 *
 *   units             Σ OrderItem.quantity            non-cancelled lines of counted orders
 *   itemRevenuePaise  Σ lineTotalPaise − refundedPaise what the line was finally worth
 *   discountPaise     Σ OrderItem.discountPaise        promotion + coupon allocations on the line
 *   taxPaise          Σ OrderItem.taxPaise
 *   orders            COUNT(DISTINCT orderId)
 */

export type CategorySales = {
  /** Rolled-up path ("/home-living") or null for lines without a category snapshot. */
  path: string | null;
  categoryId: string | null;
  name: string;
  units: number;
  lines: number;
  orders: number;
  itemRevenuePaise: number;
  discountPaise: number;
  taxPaise: number;
};

/**
 * Sales rolled up the category tree from `OrderItem.categoryPathSnapshot`
 * (the path at time of sale, so a category moved later does not rewrite
 * history). `root` groups every descendant under its top-level category;
 * `leaf` keeps exact paths. Names come from the live Category table by path;
 * a path whose category was deleted is humanised from its last slug.
 */
export async function salesByCategory(
  range: MetricRange,
  options: { level: CategoryLevel; filters?: ItemFilters },
  tx?: Db,
): Promise<CategorySales[]> {
  const db = client(tx);
  const grouped =
    options.level === "root"
      ? Prisma.sql`NULLIF('/' || split_part(oi."categoryPathSnapshot", '/', 2), '/')`
      : Prisma.sql`NULLIF(rtrim(oi."categoryPathSnapshot", '/'), '')`;

  const rows = await db.$queryRaw<
    Array<{ path: string | null; units: unknown; lines: unknown; orders: unknown; revenue: unknown; discount: unknown; tax: unknown }>
  >`
    SELECT ${grouped} AS path,
           COALESCE(SUM(oi.quantity), 0)::bigint AS units,
           COUNT(*)::int AS lines,
           COUNT(DISTINCT oi."orderId")::int AS orders,
           COALESCE(SUM(oi."lineTotalPaise" - oi."refundedPaise"), 0)::bigint AS revenue,
           COALESCE(SUM(oi."discountPaise"), 0)::bigint AS discount,
           COALESCE(SUM(oi."taxPaise"), 0)::bigint AS tax
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      ${whereAll(itemConditions(range, options.filters))}
     GROUP BY 1
     ORDER BY revenue DESC`;

  const paths = rows.map((row) => row.path).filter((path): path is string => Boolean(path));
  const categories = paths.length
    ? await db.category.findMany({ where: { path: { in: paths } }, select: { id: true, path: true, name: true } })
    : [];
  const byPath = new Map(categories.map((category) => [category.path, category]));

  return rows.map((row) => {
    const category = row.path ? byPath.get(row.path) : undefined;
    const lastSlug = row.path?.split("/").filter(Boolean).at(-1);
    return {
      path: row.path,
      categoryId: category?.id ?? null,
      name: category?.name ?? (lastSlug ? humanizeSlug(lastSlug) : "Uncategorised"),
      units: num(row.units),
      lines: num(row.lines),
      orders: num(row.orders),
      itemRevenuePaise: num(row.revenue),
      discountPaise: num(row.discount),
      taxPaise: num(row.tax),
    };
  });
}

export type ProductSales = {
  productId: string | null;
  variantId: string | null;
  title: string;
  variantName: string | null;
  sku: string | null;
  sellerId: string | null;
  sellerName: string | null;
  categoryPath: string | null;
  units: number;
  orders: number;
  itemRevenuePaise: number;
  discountPaise: number;
  refundedPaise: number;
  returnedQty: number;
  /** Σ(unit price × qty) ÷ units - the realised average selling price. */
  avgUnitPricePaise: number;
  /** Σ costPaiseSnapshot × qty, when the cost was snapshotted; margin = itemRevenue − cost. */
  costPaise: number | null;
};

const PRODUCT_SORTS: Record<string, string> = {
  units: "units",
  revenue: "revenue",
  orders: "orders",
  refunded: "refunded",
  title: "title",
  discount: "discount",
};

/**
 * Best sellers, grouped by (product, variant). Titles and SKUs are the
 * snapshots on the line, so a renamed product shows the name it sold under;
 * `title` is the most recent snapshot in the group. `limit` bounds the read
 * (the dashboard shows a handful; the report pages through with skip/take).
 */
export async function topProducts(
  range: MetricRange,
  options: {
    limit?: number;
    skip?: number;
    filters?: ItemFilters;
    by?: "units" | "revenue" | "orders" | "refunded" | "title" | "discount";
    order?: "asc" | "desc";
    /** Group by product only (variants folded together). */
    byProduct?: boolean;
  } = {},
  tx?: Db,
): Promise<{ rows: ProductSales[]; total: number }> {
  const groupKey = options.byProduct
    ? Prisma.sql`oi."productId", NULL::text`
    : Prisma.sql`oi."productId", oi."variantId"`;
  const sortColumn = PRODUCT_SORTS[options.by ?? "revenue"] ?? "revenue";
  const direction = options.order === "asc" ? "ASC" : "DESC";

  const rows = await client(tx).$queryRaw<
    Array<{
      productId: string | null;
      variantId: string | null;
      title: string;
      variantName: string | null;
      sku: string | null;
      sellerId: string | null;
      sellerName: string | null;
      categoryPath: string | null;
      units: unknown;
      orders: unknown;
      revenue: unknown;
      discount: unknown;
      refunded: unknown;
      returnedQty: unknown;
      grossUnits: unknown;
      cost: unknown;
      costed: unknown;
      total: unknown;
    }>
  >`
    SELECT g."productId", g."variantId",
           (array_agg(oi."titleSnapshot" ORDER BY o."placedAt" DESC))[1] AS title,
           (array_agg(oi."variantSnapshot" ORDER BY o."placedAt" DESC))[1] AS "variantName",
           (array_agg(oi."skuSnapshot" ORDER BY o."placedAt" DESC))[1] AS sku,
           (array_agg(oi."sellerId" ORDER BY o."placedAt" DESC))[1] AS "sellerId",
           (array_agg(oi."sellerNameSnapshot" ORDER BY o."placedAt" DESC))[1] AS "sellerName",
           (array_agg(oi."categoryPathSnapshot" ORDER BY o."placedAt" DESC))[1] AS "categoryPath",
           COALESCE(SUM(oi.quantity), 0)::bigint AS units,
           COUNT(DISTINCT oi."orderId")::int AS orders,
           COALESCE(SUM(oi."lineTotalPaise" - oi."refundedPaise"), 0)::bigint AS revenue,
           COALESCE(SUM(oi."discountPaise"), 0)::bigint AS discount,
           COALESCE(SUM(oi."refundedPaise"), 0)::bigint AS refunded,
           COALESCE(SUM(oi."returnedQty"), 0)::bigint AS "returnedQty",
           COALESCE(SUM((oi."unitPricePaise" + oi."customizationPaise")::bigint * oi.quantity), 0)::bigint AS "grossUnits",
           COALESCE(SUM(oi."costPaiseSnapshot"::bigint * oi.quantity), 0)::bigint AS cost,
           COUNT(oi."costPaiseSnapshot")::int AS costed,
           COUNT(*) OVER ()::int AS total
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      CROSS JOIN LATERAL (SELECT ${groupKey}) AS g("productId", "variantId")
      ${whereAll(itemConditions(range, options.filters))}
     GROUP BY g."productId", g."variantId"
     ${Prisma.raw(`ORDER BY ${sortColumn} ${direction} NULLS LAST, title ASC, g."productId", g."variantId"`)}
     LIMIT ${options.limit ?? 10} OFFSET ${options.skip ?? 0}`;

  return {
    total: rows.length ? num(rows[0].total) : 0,
    rows: rows.map((row) => {
      const units = num(row.units);
      return {
        productId: row.productId,
        variantId: row.variantId,
        title: row.title,
        variantName: row.variantName,
        sku: row.sku,
        sellerId: row.sellerId,
        sellerName: row.sellerName,
        categoryPath: row.categoryPath,
        units,
        orders: num(row.orders),
        itemRevenuePaise: num(row.revenue),
        discountPaise: num(row.discount),
        refundedPaise: num(row.refunded),
        returnedQty: num(row.returnedQty),
        avgUnitPricePaise: units > 0 ? Math.round(num(row.grossUnits) / units) : 0,
        costPaise: num(row.costed) > 0 ? num(row.cost) : null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Inventory valuation
// ---------------------------------------------------------------------------

export type InventoryValuation = {
  skus: number;
  unitsOnHand: number;
  unitsReserved: number;
  unitsAvailable: number;
  /** Σ onHand × (variant cost, else product cost); uncosted variants count as zero. */
  costValuePaise: number;
  /** Σ onHand × selling price (variant price, else product price) - what the stock would sell for at list. */
  retailValuePaise: number;
  byState: Record<StockState, number>;
  /** Variants that have no cost on record, so the cost valuation understates. */
  uncostedSkus: number;
};

export type InventoryScope = { sellerId?: string; categoryPath?: string; stockState?: StockState };

function inventoryConditions(scope: InventoryScope): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [Prisma.sql`v."deletedAt" IS NULL`, Prisma.sql`p."deletedAt" IS NULL`];
  if (scope.sellerId) conditions.push(Prisma.sql`p."sellerId" = ${scope.sellerId}`);
  if (scope.categoryPath) {
    conditions.push(Prisma.sql`(p."categoryPath" = ${scope.categoryPath} OR p."categoryPath" LIKE ${`${scope.categoryPath}/%`})`);
  }
  if (scope.stockState) conditions.push(Prisma.sql`i."stockState" = ${scope.stockState}`);
  return conditions;
}

/**
 * Stock on hand valued two ways in one pass: at cost (what the money tied up
 * is) and at list price (what it would sell for). The valuation multiplies
 * columns from two tables per row, which Prisma's aggregate API cannot
 * express - hence raw SQL, mirroring src/features/inventory/kpis.ts but
 * scoped by seller / category for the report filters.
 */
export async function inventoryValuation(scope: InventoryScope = {}, tx?: Db): Promise<InventoryValuation> {
  const rows = await client(tx).$queryRaw<
    Array<{
      skus: unknown;
      onHand: unknown;
      reserved: unknown;
      available: unknown;
      cost: unknown;
      retail: unknown;
      inStock: unknown;
      low: unknown;
      out: unknown;
      backorder: unknown;
      uncosted: unknown;
    }>
  >`
    SELECT COUNT(*)::int AS skus,
           COALESCE(SUM(i."onHand"), 0)::bigint AS "onHand",
           COALESCE(SUM(i.reserved), 0)::bigint AS reserved,
           COALESCE(SUM(i.available), 0)::bigint AS available,
           COALESCE(SUM(GREATEST(i."onHand", 0)::bigint * COALESCE(v."costPaise", p."costPaise", 0)), 0)::bigint AS cost,
           COALESCE(SUM(GREATEST(i."onHand", 0)::bigint * COALESCE(v."pricePaise", p."pricePaise", 0)), 0)::bigint AS retail,
           COUNT(*) FILTER (WHERE i."stockState" = 'IN_STOCK')::int AS "inStock",
           COUNT(*) FILTER (WHERE i."stockState" = 'LOW_STOCK')::int AS low,
           COUNT(*) FILTER (WHERE i."stockState" = 'OUT_OF_STOCK')::int AS out,
           COUNT(*) FILTER (WHERE i."stockState" = 'BACKORDER')::int AS backorder,
           COUNT(*) FILTER (WHERE COALESCE(v."costPaise", p."costPaise") IS NULL)::int AS uncosted
      FROM "InventoryItem" i
      JOIN "ProductVariant" v ON v.id = i."variantId"
      JOIN "Product" p ON p.id = v."productId"
      ${whereAll(inventoryConditions(scope))}`;
  const row = rows[0];
  return {
    skus: num(row?.skus),
    unitsOnHand: num(row?.onHand),
    unitsReserved: num(row?.reserved),
    unitsAvailable: num(row?.available),
    costValuePaise: num(row?.cost),
    retailValuePaise: num(row?.retail),
    byState: {
      IN_STOCK: num(row?.inStock),
      LOW_STOCK: num(row?.low),
      OUT_OF_STOCK: num(row?.out),
      BACKORDER: num(row?.backorder),
    },
    uncostedSkus: num(row?.uncosted),
  };
}

export type InventoryValuationRow = {
  variantId: string;
  productId: string;
  title: string;
  variantName: string;
  sku: string | null;
  sellerName: string | null;
  categoryName: string | null;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  stockState: StockState;
  unitCostPaise: number | null;
  unitPricePaise: number;
  costValuePaise: number;
  retailValuePaise: number;
  updatedAt: Date;
};

const INVENTORY_SORTS: Record<string, string> = {
  title: "p.title",
  sku: "v.sku",
  onHand: 'i."onHand"',
  available: "i.available",
  reserved: "i.reserved",
  costValue: '"costValue"',
  retailValue: '"retailValue"',
  stockState: 'i."stockState"',
  updatedAt: 'i."updatedAt"',
};

/** Per-variant valuation rows for the inventory report, sorted and paged in SQL. */
export async function inventoryValuationRows(
  scope: InventoryScope,
  page: { skip: number; take: number; sort: string; order: "asc" | "desc" },
  tx?: Db,
): Promise<{ rows: InventoryValuationRow[]; total: number }> {
  const sortColumn = INVENTORY_SORTS[page.sort] ?? INVENTORY_SORTS.costValue;
  const direction = page.order === "asc" ? "ASC" : "DESC";
  const rows = await client(tx).$queryRaw<
    Array<
      Omit<InventoryValuationRow, "onHand" | "reserved" | "available" | "lowStockThreshold" | "costValuePaise" | "retailValuePaise"> & {
        onHand: unknown;
        reserved: unknown;
        available: unknown;
        lowStockThreshold: unknown;
        costValue: unknown;
        retailValue: unknown;
        total: unknown;
      }
    >
  >`
    SELECT v.id AS "variantId", p.id AS "productId", p.title, v.name AS "variantName", v.sku,
           s."displayName" AS "sellerName", c.name AS "categoryName",
           i."onHand", i.reserved, i.available, i."lowStockThreshold", i."stockState", i."updatedAt",
           COALESCE(v."costPaise", p."costPaise") AS "unitCostPaise",
           COALESCE(v."pricePaise", p."pricePaise") AS "unitPricePaise",
           (GREATEST(i."onHand", 0)::bigint * COALESCE(v."costPaise", p."costPaise", 0))::bigint AS "costValue",
           (GREATEST(i."onHand", 0)::bigint * COALESCE(v."pricePaise", p."pricePaise", 0))::bigint AS "retailValue",
           COUNT(*) OVER ()::int AS total
      FROM "InventoryItem" i
      JOIN "ProductVariant" v ON v.id = i."variantId"
      JOIN "Product" p ON p.id = v."productId"
      LEFT JOIN "Seller" s ON s.id = p."sellerId"
      LEFT JOIN "Category" c ON c.id = p."categoryId"
      ${whereAll(inventoryConditions(scope))}
     ${Prisma.raw(`ORDER BY ${sortColumn} ${direction} NULLS LAST, p.title ASC, v.id ASC`)}
     LIMIT ${page.take} OFFSET ${page.skip}`;
  return {
    total: rows.length ? num(rows[0].total) : 0,
    rows: rows.map((row) => ({
      variantId: row.variantId,
      productId: row.productId,
      title: row.title,
      variantName: row.variantName,
      sku: row.sku,
      sellerName: row.sellerName,
      categoryName: row.categoryName,
      onHand: num(row.onHand),
      reserved: num(row.reserved),
      available: num(row.available),
      lowStockThreshold: num(row.lowStockThreshold),
      stockState: row.stockState,
      unitCostPaise: row.unitCostPaise === null ? null : num(row.unitCostPaise),
      unitPricePaise: num(row.unitPricePaise),
      costValuePaise: num(row.costValue),
      retailValuePaise: num(row.retailValue),
      updatedAt: row.updatedAt,
    })),
  };
}
