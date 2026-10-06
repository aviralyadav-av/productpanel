import { Prisma } from "@prisma/client";

import { ORDER_STATUSES, type OrderStatus } from "@/lib/enums";
import { bucketLabel, zeroFill, type Bucket } from "./bucketing";
import {
  client,
  inRange,
  istBucketKey,
  itemConditions,
  num,
  orderConditions,
  whereAll,
  type Db,
  type ItemFilters,
  type MetricRange,
} from "./sql";

/**
 * Sales-side metrics shared by the reports and the dashboard (E4).
 *
 * DEFINITIONS (every figure below is integer paise, orders bucketed by
 * `placedAt` in IST; see sql.ts for the status rule):
 *
 *   gross          Σ Order.totalPaise           what customers were charged
 *   refunded       Σ Order.refundedPaise        Refund rows COMPLETED (B6 derivation)
 *   revenue        gross − refunded             THE revenue number (E4)
 *   netSales       revenue − shipping − codFee  merchandise revenue; shipping and
 *                                               the COD fee are platform charges
 *                                               with no tax line (B1)
 *   tax            Σ Order.taxPaise             Σ line taxes at placement
 *   discounts      Σ discountPaise + couponDiscountPaise (promotion + coupon allocations)
 *   subtotal       Σ Order.subtotalPaise        Σ lineGross before any discount
 *   units          Σ OrderItem.quantity for non-cancelled lines
 *
 * Refunds are attributed to the ORDER's placement bucket, not the refund's
 * date: a report for "August" then shows what August's orders were finally
 * worth. The refunds report itself is dated by the refund.
 */

export type RevenueBucket = {
  key: string;
  label: string;
  orders: number;
  units: number;
  subtotalPaise: number;
  discountPaise: number;
  couponDiscountPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  taxPaise: number;
  grossPaise: number;
  refundedPaise: number;
  revenuePaise: number;
  netSalesPaise: number;
};

type RevenueRow = {
  key: string;
  orders: unknown;
  units: unknown;
  subtotal: unknown;
  discount: unknown;
  coupon: unknown;
  shipping: unknown;
  codFee: unknown;
  tax: unknown;
  gross: unknown;
  refunded: unknown;
};

function toRevenueBucket(row: RevenueRow, bucket: Bucket): RevenueBucket {
  const gross = num(row.gross);
  const refunded = num(row.refunded);
  const shipping = num(row.shipping);
  const codFee = num(row.codFee);
  return {
    key: row.key,
    label: bucketLabel(row.key, bucket),
    orders: num(row.orders),
    units: num(row.units),
    subtotalPaise: num(row.subtotal),
    discountPaise: num(row.discount),
    couponDiscountPaise: num(row.coupon),
    shippingPaise: shipping,
    codFeePaise: codFee,
    taxPaise: num(row.tax),
    grossPaise: gross,
    refundedPaise: refunded,
    revenuePaise: gross - refunded,
    netSalesPaise: gross - refunded - shipping - codFee,
  };
}

export function emptyRevenueBucket(key: string, bucket: Bucket): RevenueBucket {
  return {
    key,
    label: bucketLabel(key, bucket),
    orders: 0,
    units: 0,
    subtotalPaise: 0,
    discountPaise: 0,
    couponDiscountPaise: 0,
    shippingPaise: 0,
    codFeePaise: 0,
    taxPaise: 0,
    grossPaise: 0,
    refundedPaise: 0,
    revenuePaise: 0,
    netSalesPaise: 0,
  };
}

/** The SELECT list shared by the series and the totals; `units` is a correlated sum so lines are not double-counted by a join. */
const REVENUE_SELECT = Prisma.sql`
  COUNT(*)::int AS orders,
  COALESCE(SUM((SELECT SUM(oi.quantity) FROM "OrderItem" oi WHERE oi."orderId" = o.id AND oi.status <> 'CANCELLED')), 0)::bigint AS units,
  COALESCE(SUM(o."subtotalPaise"), 0)::bigint AS subtotal,
  COALESCE(SUM(o."discountPaise"), 0)::bigint AS discount,
  COALESCE(SUM(o."couponDiscountPaise"), 0)::bigint AS coupon,
  COALESCE(SUM(o."shippingPaise"), 0)::bigint AS shipping,
  COALESCE(SUM(o."codFeePaise"), 0)::bigint AS "codFee",
  COALESCE(SUM(o."taxPaise"), 0)::bigint AS tax,
  COALESCE(SUM(o."totalPaise"), 0)::bigint AS gross,
  COALESCE(SUM(o."refundedPaise"), 0)::bigint AS refunded`;

/** Revenue and its components per bucket, zero-filled across the range. */
export async function revenueSeries(
  range: MetricRange,
  options: { bucket: Bucket; filters?: ItemFilters },
  tx?: Db,
): Promise<RevenueBucket[]> {
  const key = istBucketKey(options.bucket, Prisma.sql`o."placedAt"`);
  const rows = await client(tx).$queryRaw<RevenueRow[]>`
    SELECT ${key} AS key, ${REVENUE_SELECT}
      FROM "Order" o
      ${whereAll(orderConditions(range, options.filters))}
     GROUP BY 1
     ORDER BY 1`;
  return zeroFill(
    range,
    options.bucket,
    rows.map((row) => toRevenueBucket(row, options.bucket)),
    (k) => emptyRevenueBucket(k, options.bucket),
  );
}

/** One row of the same figures for the whole range (the totals strip, KPI tiles). */
export async function revenueTotals(range: MetricRange, filters?: ItemFilters, tx?: Db): Promise<RevenueBucket> {
  const rows = await client(tx).$queryRaw<RevenueRow[]>`
    SELECT 'total' AS key, ${REVENUE_SELECT}
      FROM "Order" o
      ${whereAll(orderConditions(range, filters))}`;
  const row = rows[0];
  const bucket = row ? toRevenueBucket(row, "day") : emptyRevenueBucket("total", "day");
  return { ...bucket, key: "total", label: "Total" };
}

// ---------------------------------------------------------------------------
// Order counts
// ---------------------------------------------------------------------------

export type OrderCountBucket = {
  key: string;
  label: string;
  total: number;
  byStatus: Record<OrderStatus, number>;
};

export function emptyStatusCounts(): Record<OrderStatus, number> {
  return Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0])) as Record<OrderStatus, number>;
}

/**
 * Orders placed per bucket, split by CURRENT status. Unlike revenue this
 * includes CANCELLED and FAILED orders - the point of the series is to see
 * what share of demand converts - unless a single status is requested.
 */
export async function orderCountSeries(
  range: MetricRange,
  options: { bucket: Bucket; filters?: ItemFilters },
  tx?: Db,
): Promise<OrderCountBucket[]> {
  const key = istBucketKey(options.bucket, Prisma.sql`o."placedAt"`);
  const conditions = orderConditions(range, options.filters, "o", { allStatuses: true });
  const rows = await client(tx).$queryRaw<Array<{ key: string; status: string; n: unknown }>>`
    SELECT ${key} AS key, o.status, COUNT(*)::int AS n
      FROM "Order" o
      ${whereAll(conditions)}
     GROUP BY 1, 2
     ORDER BY 1`;

  const buckets = new Map<string, OrderCountBucket>();
  for (const row of rows) {
    const bucket =
      buckets.get(row.key) ?? { key: row.key, label: bucketLabel(row.key, options.bucket), total: 0, byStatus: emptyStatusCounts() };
    const count = num(row.n);
    bucket.total += count;
    if (row.status in bucket.byStatus) bucket.byStatus[row.status as OrderStatus] += count;
    buckets.set(row.key, bucket);
  }
  return zeroFill(range, options.bucket, [...buckets.values()], (k) => ({
    key: k,
    label: bucketLabel(k, options.bucket),
    total: 0,
    byStatus: emptyStatusCounts(),
  }));
}

/** Status mix for the range (donut on the orders report, dashboard tiles). Includes cancelled/failed. */
export async function ordersByStatus(
  range: MetricRange,
  filters?: ItemFilters,
  tx?: Db,
): Promise<{ total: number; byStatus: Record<OrderStatus, number> }> {
  const conditions = orderConditions(range, filters, "o", { allStatuses: true });
  const rows = await client(tx).$queryRaw<Array<{ status: string; n: unknown }>>`
    SELECT o.status, COUNT(*)::int AS n FROM "Order" o ${whereAll(conditions)} GROUP BY 1`;
  const byStatus = emptyStatusCounts();
  let total = 0;
  for (const row of rows) {
    const count = num(row.n);
    total += count;
    if (row.status in byStatus) byStatus[row.status as OrderStatus] += count;
  }
  return { total, byStatus };
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export type UnitsBucket = { key: string; label: string; units: number; lines: number; itemRevenuePaise: number };

/**
 * Units sold per bucket from non-cancelled lines of counted orders.
 * `itemRevenuePaise` = Σ lineTotalPaise − Σ OrderItem.refundedPaise: the
 * line-level twin of revenue (it excludes shipping and COD fee by
 * construction, so it is closer to net sales).
 */
export async function productSalesSeries(
  range: MetricRange,
  options: { bucket: Bucket; filters?: ItemFilters },
  tx?: Db,
): Promise<UnitsBucket[]> {
  const key = istBucketKey(options.bucket, Prisma.sql`o."placedAt"`);
  const rows = await client(tx).$queryRaw<Array<{ key: string; units: unknown; lines: unknown; revenue: unknown }>>`
    SELECT ${key} AS key,
           COALESCE(SUM(oi.quantity), 0)::bigint AS units,
           COUNT(*)::int AS lines,
           COALESCE(SUM(oi."lineTotalPaise" - oi."refundedPaise"), 0)::bigint AS revenue
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      ${whereAll(itemConditions(range, options.filters))}
     GROUP BY 1
     ORDER BY 1`;
  return zeroFill(
    range,
    options.bucket,
    rows.map((row) => ({
      key: row.key,
      label: bucketLabel(row.key, options.bucket),
      units: num(row.units),
      lines: num(row.lines),
      itemRevenuePaise: num(row.revenue),
    })),
    (k) => ({ key: k, label: bucketLabel(k, options.bucket), units: 0, lines: 0, itemRevenuePaise: 0 }),
  );
}

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

export type GrowthBucket = { key: string; label: string; count: number; cumulative: number };

/**
 * New customer accounts per bucket (Customer.createdAt, soft-deleted rows
 * excluded) with a running total that starts from everyone who signed up
 * before the range - so the line reads as "customers we have", not "since
 * the chart began".
 */
export async function customerGrowthSeries(
  range: MetricRange,
  options: { bucket: Bucket },
  tx?: Db,
): Promise<GrowthBucket[]> {
  const db = client(tx);
  const key = istBucketKey(options.bucket, Prisma.sql`c."createdAt"`);
  const [rows, before] = await Promise.all([
    db.$queryRaw<Array<{ key: string; n: unknown }>>`
      SELECT ${key} AS key, COUNT(*)::int AS n
        FROM "Customer" c
       WHERE c."deletedAt" IS NULL AND ${inRange(Prisma.sql`c."createdAt"`, range)}
       GROUP BY 1 ORDER BY 1`,
    db.customer.count({ where: { deletedAt: null, createdAt: { lt: range.from } } }),
  ]);
  return accumulate(range, options.bucket, rows, before);
}

/**
 * Seller registrations per bucket (Seller.createdAt), running total of all
 * registrations before the range. `activated` counts sellers whose
 * `approvedAt` falls in the bucket - onboarding throughput, not sign-ups.
 */
export async function sellerGrowthSeries(
  range: MetricRange,
  options: { bucket: Bucket },
  tx?: Db,
): Promise<Array<GrowthBucket & { activated: number }>> {
  const db = client(tx);
  const registeredKey = istBucketKey(options.bucket, Prisma.sql`s."createdAt"`);
  const approvedKey = istBucketKey(options.bucket, Prisma.sql`s."approvedAt"`);
  const [registered, approved, before] = await Promise.all([
    db.$queryRaw<Array<{ key: string; n: unknown }>>`
      SELECT ${registeredKey} AS key, COUNT(*)::int AS n
        FROM "Seller" s
       WHERE s."deletedAt" IS NULL AND ${inRange(Prisma.sql`s."createdAt"`, range)}
       GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<Array<{ key: string; n: unknown }>>`
      SELECT ${approvedKey} AS key, COUNT(*)::int AS n
        FROM "Seller" s
       WHERE s."deletedAt" IS NULL AND s."approvedAt" IS NOT NULL AND ${inRange(Prisma.sql`s."approvedAt"`, range)}
       GROUP BY 1 ORDER BY 1`,
    db.seller.count({ where: { deletedAt: null, createdAt: { lt: range.from } } }),
  ]);
  const activatedByKey = new Map(approved.map((row) => [row.key, num(row.n)]));
  return accumulate(range, options.bucket, registered, before).map((bucket) => ({
    ...bucket,
    activated: activatedByKey.get(bucket.key) ?? 0,
  }));
}

function accumulate(
  range: MetricRange,
  bucket: Bucket,
  rows: Array<{ key: string; n: unknown }>,
  before: number,
): GrowthBucket[] {
  const filled = zeroFill(
    range,
    bucket,
    rows.map((row) => ({ key: row.key, label: bucketLabel(row.key, bucket), count: num(row.n), cumulative: 0 })),
    (k) => ({ key: k, label: bucketLabel(k, bucket), count: 0, cumulative: 0 }),
  );
  let running = before;
  for (const item of filled) {
    running += item.count;
    item.cumulative = running;
  }
  return filled;
}
