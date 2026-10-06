import "server-only";

import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export type InventoryKpis = {
  skusTracked: number;
  unitsOnHand: number;
  unitsReserved: number;
  /** On hand × unit cost (variant cost, else product cost). Untracked and uncosted read as zero. */
  costValuePaise: number;
  low: number;
  out: number;
  backorder: number;
  inStock: number;
};

type KpiRow = {
  skus: number;
  onHand: number;
  reserved: number;
  costValuePaise: bigint | number;
  low: number;
  out: number;
  backorder: number;
  inStock: number;
};

/**
 * One aggregate query. The valuation multiplies two columns from different
 * tables per row, which Prisma's aggregate API cannot express, so this is the
 * one raw read in the module. Soft-deleted variants and products are out.
 */
export async function getInventoryKpis(): Promise<InventoryKpis> {
  const rows = await db.$queryRaw<KpiRow[]>`
    SELECT COUNT(*)::int AS "skus",
           COALESCE(SUM(i."onHand"), 0)::int AS "onHand",
           COALESCE(SUM(i.reserved), 0)::int AS "reserved",
           COALESCE(SUM(GREATEST(i."onHand", 0)::bigint * COALESCE(v."costPaise", p."costPaise", 0)), 0)::bigint AS "costValuePaise",
           COUNT(*) FILTER (WHERE i."stockState" = 'LOW_STOCK')::int AS "low",
           COUNT(*) FILTER (WHERE i."stockState" = 'OUT_OF_STOCK')::int AS "out",
           COUNT(*) FILTER (WHERE i."stockState" = 'BACKORDER')::int AS "backorder",
           COUNT(*) FILTER (WHERE i."stockState" = 'IN_STOCK')::int AS "inStock"
      FROM "InventoryItem" i
      JOIN "ProductVariant" v ON v.id = i."variantId"
      JOIN "Product" p ON p.id = v."productId"
     WHERE v."deletedAt" IS NULL AND p."deletedAt" IS NULL`;
  const row = rows[0];
  return {
    skusTracked: row?.skus ?? 0,
    unitsOnHand: row?.onHand ?? 0,
    unitsReserved: row?.reserved ?? 0,
    costValuePaise: Number(row?.costValuePaise ?? 0),
    low: row?.low ?? 0,
    out: row?.out ?? 0,
    backorder: row?.backorder ?? 0,
    inStock: row?.inStock ?? 0,
  };
}
