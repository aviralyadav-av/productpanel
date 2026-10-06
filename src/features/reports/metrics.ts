import { Prisma } from "@prisma/client";

import { endOfIstDay, startOfIstDay, addDays } from "@/lib/dates";
import type { OrderStatus } from "@/lib/enums";
import { bucketStart } from "./bucketing";
import { revenueTotals, emptyStatusCounts } from "./metrics-sales";
import { client, num, type Db } from "./sql";

/**
 * The shared metric layer (blueprint E4: "Dashboard and reports share
 * src/features/reports/metrics.ts"). Pure Prisma + SQL: no `server-only`, no
 * `next/*`, so the worker, the check scripts and Server Components can all
 * import it. Every function takes `(range, options, tx?)`.
 *
 * Definitions live beside each metric; the headline rule from E4 is repeated
 * here because everything else derives from it:
 *
 *   revenue  = Σ Order.totalPaise − Σ Order.refundedPaise
 *              for orders NOT IN (CANCELLED, FAILED), bucketed by placedAt in IST
 *   netSales = revenue − shipping − COD fee
 */

export type { Bucket, CategoryLevel } from "./bucketing";
export { BUCKETS, BUCKET_LABELS, bucketKeyFor, bucketKeysInRange, bucketLabel, defaultBucketFor, isBucket, rollupCategoryPath, zeroFill } from "./bucketing";
export type { Db, ItemFilters, MetricRange, OrderFilters } from "./sql";
export { EXCLUDED_ORDER_STATUSES, resolveCategoryPath } from "./sql";

export {
  customerGrowthSeries,
  emptyRevenueBucket,
  emptyStatusCounts,
  orderCountSeries,
  ordersByStatus,
  productSalesSeries,
  revenueSeries,
  revenueTotals,
  sellerGrowthSeries,
  type GrowthBucket,
  type OrderCountBucket,
  type RevenueBucket,
  type UnitsBucket,
} from "./metrics-sales";

export {
  inventoryValuation,
  inventoryValuationRows,
  salesByCategory,
  topProducts,
  type CategorySales,
  type InventoryScope,
  type InventoryValuation,
  type InventoryValuationRow,
  type ProductSales,
} from "./metrics-catalog";

export {
  commissionSummary,
  couponPerformance,
  payoutSummary,
  refundSummary,
  taxSummary,
  topSellers,
  type CommissionSummaryRow,
  type CouponPerformance,
  type PayoutStatusSummary,
  type RefundGroup,
  type RefundGroupBy,
  type SellerSales,
  type TaxSummaryRow,
} from "./metrics-finance";

export {
  buyerCounts,
  customerSales,
  customerSegmentsBreakdown,
  newCustomerCount,
  segmentThresholds,
  type CustomerSalesRow,
  type CustomerSegmentsBreakdown,
  type SegmentThresholds,
} from "./metrics-customers";

// ---------------------------------------------------------------------------
// Dashboard snapshot
// ---------------------------------------------------------------------------

export type KpiSnapshot = {
  asOf: Date;
  revenue: {
    /** IST today so far. */
    todayPaise: number;
    /** Rolling last 7 IST days including today. */
    weekPaise: number;
    /** IST calendar month to date. */
    monthPaise: number;
    /** All time. */
    totalPaise: number;
    /** Orders counted in each window. */
    todayOrders: number;
    weekOrders: number;
    monthOrders: number;
    totalOrders: number;
  };
  orders: {
    total: number;
    today: number;
    byStatus: Record<OrderStatus, number>;
    /** PENDING + CONFIRMED + PROCESSING + PACKED: needs someone to act. */
    actionable: number;
  };
  returns: { open: number; total: number };
  refunds: { pendingCount: number; pendingPaise: number; completedCount: number; completedPaise: number };
  customers: { total: number; new30d: number; newThisMonth: number };
  sellers: { total: number; active: number; pending: number; suspended: number };
  products: { total: number; published: number; draft: number; outOfStockVariants: number; lowStockVariants: number };
  reviews: { pending: number };
  inquiries: { new: number };
};

const ACTIONABLE_ORDER_STATUSES: readonly OrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED"];
const OPEN_RETURN_STATUSES = ["REQUESTED", "UNDER_REVIEW", "APPROVED", "PICKUP_SCHEDULED", "RECEIVED", "QC_PASSED", "QC_FAILED", "REFUND_INITIATED"];
const OPEN_REFUND_STATUSES = ["PENDING", "APPROVED", "PROCESSING"];

/**
 * Everything the dashboard's tiles need in one call. Windows are IST: "today"
 * is the current IST day, "week" the last seven IST days, "month" the IST
 * calendar month to date. Revenue follows E4 exactly (see revenueTotals);
 * counts of pending work (returns, refunds, reviews, inquiries, sellers
 * awaiting approval) are point-in-time and ignore the range.
 */
export async function kpiSnapshot(now = new Date(), tx?: Db): Promise<KpiSnapshot> {
  const db = client(tx);
  const today = { from: startOfIstDay(now), to: endOfIstDay(now) };
  const week = { from: startOfIstDay(addDays(now, -6)), to: today.to };
  const month = { from: bucketStart(now, "month"), to: today.to };
  const allTime = { from: new Date(0), to: today.to };
  const last30 = { from: startOfIstDay(addDays(now, -29)), to: today.to };

  const [
    todayRevenue,
    weekRevenue,
    monthRevenue,
    totalRevenue,
    orderStatuses,
    ordersToday,
    returnsOpen,
    returnsTotal,
    refundRows,
    customersTotal,
    customersNew30,
    customersNewMonth,
    sellerStatuses,
    productStatuses,
    stockRows,
    pendingReviews,
    newInquiries,
  ] = await Promise.all([
    revenueTotals(today, undefined, db),
    revenueTotals(week, undefined, db),
    revenueTotals(month, undefined, db),
    revenueTotals(allTime, undefined, db),
    db.order.groupBy({ by: ["status"], _count: { _all: true } }),
    db.order.count({ where: { placedAt: { gte: today.from, lte: today.to } } }),
    db.returnRequest.count({ where: { status: { in: OPEN_RETURN_STATUSES } } }),
    db.returnRequest.count(),
    db.$queryRaw<Array<{ pendingCount: unknown; pendingPaise: unknown; completedCount: unknown; completedPaise: unknown }>>`
      SELECT COUNT(*) FILTER (WHERE status IN (${Prisma.join(OPEN_REFUND_STATUSES)}))::int AS "pendingCount",
             COALESCE(SUM("amountPaise") FILTER (WHERE status IN (${Prisma.join(OPEN_REFUND_STATUSES)})), 0)::bigint AS "pendingPaise",
             COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS "completedCount",
             COALESCE(SUM("amountPaise") FILTER (WHERE status = 'COMPLETED'), 0)::bigint AS "completedPaise"
        FROM "Refund"`,
    db.customer.count({ where: { deletedAt: null } }),
    db.customer.count({ where: { deletedAt: null, createdAt: { gte: last30.from } } }),
    db.customer.count({ where: { deletedAt: null, createdAt: { gte: month.from } } }),
    db.seller.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
    db.product.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
    db.$queryRaw<Array<{ out: unknown; low: unknown }>>`
      SELECT COUNT(*) FILTER (WHERE i."stockState" = 'OUT_OF_STOCK')::int AS out,
             COUNT(*) FILTER (WHERE i."stockState" = 'LOW_STOCK')::int AS low
        FROM "InventoryItem" i
        JOIN "ProductVariant" v ON v.id = i."variantId"
        JOIN "Product" p ON p.id = v."productId"
       WHERE v."deletedAt" IS NULL AND p."deletedAt" IS NULL AND p.status = 'PUBLISHED'`,
    db.review.count({ where: { status: "PENDING" } }),
    db.contactInquiry.count({ where: { status: "NEW" } }),
  ]);

  const byStatus = emptyStatusCounts();
  let totalOrders = 0;
  for (const row of orderStatuses) {
    const count = row._count._all;
    totalOrders += count;
    if (row.status in byStatus) byStatus[row.status as OrderStatus] = count;
  }
  const sellerCount = (statuses: readonly string[]) =>
    sellerStatuses.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
  const productCount = (status?: string) =>
    productStatuses.filter((row) => !status || row.status === status).reduce((sum, row) => sum + row._count._all, 0);
  const refunds = refundRows[0];
  const stock = stockRows[0];

  return {
    asOf: now,
    revenue: {
      todayPaise: todayRevenue.revenuePaise,
      weekPaise: weekRevenue.revenuePaise,
      monthPaise: monthRevenue.revenuePaise,
      totalPaise: totalRevenue.revenuePaise,
      todayOrders: todayRevenue.orders,
      weekOrders: weekRevenue.orders,
      monthOrders: monthRevenue.orders,
      totalOrders: totalRevenue.orders,
    },
    orders: {
      total: totalOrders,
      today: ordersToday,
      byStatus,
      actionable: ACTIONABLE_ORDER_STATUSES.reduce((sum, status) => sum + byStatus[status], 0),
    },
    returns: { open: returnsOpen, total: returnsTotal },
    refunds: {
      pendingCount: num(refunds?.pendingCount),
      pendingPaise: num(refunds?.pendingPaise),
      completedCount: num(refunds?.completedCount),
      completedPaise: num(refunds?.completedPaise),
    },
    customers: { total: customersTotal, new30d: customersNew30, newThisMonth: customersNewMonth },
    sellers: {
      total: sellerCount(["PENDING", "UNDER_REVIEW", "APPROVED", "ACTIVE", "SUSPENDED", "REJECTED"]),
      active: sellerCount(["ACTIVE"]),
      pending: sellerCount(["PENDING", "UNDER_REVIEW", "APPROVED"]),
      suspended: sellerCount(["SUSPENDED"]),
    },
    products: {
      total: productCount(),
      published: productCount("PUBLISHED"),
      draft: productCount("DRAFT"),
      outOfStockVariants: num(stock?.out),
      lowStockVariants: num(stock?.low),
    },
    reviews: { pending: pendingReviews },
    inquiries: { new: newInquiries },
  };
}
