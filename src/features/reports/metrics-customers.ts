import { Prisma } from "@prisma/client";

import type { CustomerSegment } from "@/lib/enums";
import { readSettingNumber } from "@/features/finance/settings-reader";
import { client, inRange, num, orderConditions, utcTs, whereAll, type Db, type ItemFilters, type MetricRange } from "./sql";

/**
 * Customer metrics. Segments follow the `customers.*` settings so the numbers
 * here match the customers module's filters:
 *
 *   NEW         createdAt within customers.new_days
 *   RETURNING   orderCount ≥ customers.returning_min_orders
 *   VIP         orderCount ≥ customers.vip_min_orders
 *   HIGH_VALUE  totalSpentPaise ≥ customers.high_value_min_spend_paise
 *   INACTIVE    no order within customers.inactive_days (never ordered and
 *               older than the window counts too)
 *
 * Segments overlap on purpose (a VIP is also RETURNING); the breakdown is a
 * set of counts, not a partition. Counters (orderCount, totalSpentPaise,
 * lastOrderAt) are the C7 columns maintained on DELIVERED / REFUNDED.
 */

export type SegmentThresholds = {
  newDays: number;
  returningMinOrders: number;
  vipMinOrders: number;
  highValueMinSpendPaise: number;
  inactiveDays: number;
};

export async function segmentThresholds(tx?: Db): Promise<SegmentThresholds> {
  const [newDays, returningMinOrders, vipMinOrders, highValueMinSpendPaise, inactiveDays] = await Promise.all([
    readSettingNumber(tx, "customers.new_days"),
    readSettingNumber(tx, "customers.returning_min_orders"),
    readSettingNumber(tx, "customers.vip_min_orders"),
    readSettingNumber(tx, "customers.high_value_min_spend_paise"),
    readSettingNumber(tx, "customers.inactive_days"),
  ]);
  return { newDays, returningMinOrders, vipMinOrders, highValueMinSpendPaise, inactiveDays };
}

export type CustomerSegmentsBreakdown = {
  total: number;
  active: number;
  blocked: number;
  withAccount: number;
  segments: Record<CustomerSegment, number>;
  thresholds: SegmentThresholds;
};

export async function customerSegmentsBreakdown(now = new Date(), tx?: Db): Promise<CustomerSegmentsBreakdown> {
  const thresholds = await segmentThresholds(tx);
  const newSince = new Date(now.getTime() - thresholds.newDays * 86_400_000);
  const inactiveSince = new Date(now.getTime() - thresholds.inactiveDays * 86_400_000);
  const rows = await client(tx).$queryRaw<
    Array<{ total: unknown; active: unknown; blocked: unknown; withAccount: unknown; new: unknown; returning: unknown; vip: unknown; highValue: unknown; inactive: unknown }>
  >`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE c.status = 'ACTIVE')::int AS active,
           COUNT(*) FILTER (WHERE c.status = 'BLOCKED')::int AS blocked,
           COUNT(*) FILTER (WHERE c."passwordHash" IS NOT NULL)::int AS "withAccount",
           COUNT(*) FILTER (WHERE c."createdAt" >= ${utcTs(newSince)})::int AS new,
           COUNT(*) FILTER (WHERE c."orderCount" >= ${thresholds.returningMinOrders})::int AS returning,
           COUNT(*) FILTER (WHERE c."orderCount" >= ${thresholds.vipMinOrders})::int AS vip,
           COUNT(*) FILTER (WHERE c."totalSpentPaise" >= ${thresholds.highValueMinSpendPaise})::int AS "highValue",
           COUNT(*) FILTER (WHERE COALESCE(c."lastOrderAt", c."createdAt") < ${utcTs(inactiveSince)})::int AS inactive
      FROM "Customer" c
     WHERE c."deletedAt" IS NULL`;
  const row = rows[0];
  return {
    total: num(row?.total),
    active: num(row?.active),
    blocked: num(row?.blocked),
    withAccount: num(row?.withAccount),
    segments: {
      NEW: num(row?.new),
      RETURNING: num(row?.returning),
      VIP: num(row?.vip),
      HIGH_VALUE: num(row?.highValue),
      INACTIVE: num(row?.inactive),
    },
    thresholds,
  };
}

// ---------------------------------------------------------------------------
// Per-customer sales in a range (the customers report)
// ---------------------------------------------------------------------------

export type CustomerSalesRow = {
  customerId: string | null;
  /** Customer.email, or the guest email for orders without an account. */
  email: string;
  name: string | null;
  isGuest: boolean;
  /** First counted order ever placed by this buyer falls inside the range. */
  isNew: boolean;
  orders: number;
  units: number;
  grossPaise: number;
  refundedPaise: number;
  revenuePaise: number;
  avgOrderPaise: number;
  firstOrderAt: Date;
  lastOrderAt: Date;
};

const CUSTOMER_SORTS: Record<string, string> = {
  revenue: "revenue",
  orders: "orders",
  units: "units",
  gross: "gross",
  refunded: "refunded",
  email: "email",
  lastOrderAt: '"lastOrderAt"',
  firstOrderAt: '"firstOrderAt"',
};

/**
 * Buyers in the range keyed by customer account, or by guest email for
 * account-less orders, with what they spent and whether this range holds
 * their first ever order. "New vs returning" is decided against ALL counted
 * orders, not just the range, so a customer who bought last year and again
 * this month is returning.
 */
export async function customerSales(
  range: MetricRange,
  options: { filters?: ItemFilters; skip: number; take: number; sort: string; order: "asc" | "desc"; onlyNew?: boolean; onlyReturning?: boolean },
  tx?: Db,
): Promise<{ rows: CustomerSalesRow[]; total: number; newBuyers: number; returningBuyers: number }> {
  const sortColumn = CUSTOMER_SORTS[options.sort] ?? CUSTOMER_SORTS.revenue;
  const direction = options.order === "asc" ? "ASC" : "DESC";
  // "New" = the buyer's earliest counted order ever is inside the range. The
  // flag is computed in the `grouped` CTE and filtered in the outer query, not
  // in a HAVING: the page totals are window functions over the same rows, and
  // Postgres forbids an aggregate inside a window FILTER.
  const buyerFilter = options.onlyNew
    ? Prisma.sql`WHERE g."isNew"`
    : options.onlyReturning
      ? Prisma.sql`WHERE NOT g."isNew"`
      : Prisma.empty;
  const orderWhere = whereAll(orderConditions(range, options.filters));

  const rows = await client(tx).$queryRaw<
    Array<{
      customerId: string | null;
      email: string;
      name: string | null;
      isGuest: boolean;
      isNew: boolean;
      orders: unknown;
      units: unknown;
      gross: unknown;
      refunded: unknown;
      firstOrderAt: Date;
      lastOrderAt: Date;
      total: unknown;
      newBuyers: unknown;
    }>
  >`
    WITH scoped AS (
      SELECT o.*, COALESCE(o."customerId", 'guest:' || lower(o."guestEmail"), 'guest:unknown') AS buyer_key
        FROM "Order" o
        ${orderWhere}
    ),
    first_orders AS (
      SELECT COALESCE(o."customerId", 'guest:' || lower(o."guestEmail"), 'guest:unknown') AS buyer_key, MIN(o."placedAt") AS first_at
        FROM "Order" o
       WHERE o.status NOT IN ('CANCELLED', 'FAILED')
         AND COALESCE(o."customerId", 'guest:' || lower(o."guestEmail"), 'guest:unknown') IN (SELECT buyer_key FROM scoped)
       GROUP BY 1
    ),
    grouped AS (
      -- Grouped on buyer_key alone: every order in a group shares one
      -- customerId (or none), so MIN() picks that single value, and a
      -- logged-in order that also carries a guestEmail cannot split one
      -- customer into two rows.
      SELECT MIN(o."customerId") AS "customerId",
             COALESCE(MIN(c.email), MIN(o."guestEmail"), '') AS email,
             MIN(c."fullName") AS name,
             bool_and(o."customerId" IS NULL) AS "isGuest",
             (MIN(o."placedAt") <= fo.first_at) AS "isNew",
             COUNT(*)::int AS orders,
             COALESCE(SUM((SELECT SUM(oi.quantity) FROM "OrderItem" oi WHERE oi."orderId" = o.id AND oi.status <> 'CANCELLED')), 0)::bigint AS units,
             COALESCE(SUM(o."totalPaise"), 0)::bigint AS gross,
             COALESCE(SUM(o."refundedPaise"), 0)::bigint AS refunded,
             COALESCE(SUM(o."totalPaise" - o."refundedPaise"), 0)::bigint AS revenue,
             MIN(o."placedAt") AS "firstOrderAt",
             MAX(o."placedAt") AS "lastOrderAt"
        FROM scoped o
        LEFT JOIN "Customer" c ON c.id = o."customerId"
        JOIN first_orders fo ON fo.buyer_key = o.buyer_key
       GROUP BY o.buyer_key, fo.first_at
    )
    SELECT g."customerId", g.email, g.name, g."isGuest", g."isNew",
           g.orders, g.units, g.gross, g.refunded, g.revenue,
           g."firstOrderAt", g."lastOrderAt",
           COUNT(*) OVER ()::int AS total,
           (COUNT(*) FILTER (WHERE g."isNew") OVER ())::int AS "newBuyers"
      FROM grouped g
     ${buyerFilter}
     ${Prisma.raw(`ORDER BY g.${sortColumn} ${direction} NULLS LAST, g.email ASC`)}
     LIMIT ${options.take} OFFSET ${options.skip}`;

  const total = rows.length ? num(rows[0].total) : 0;
  const newBuyers = rows.length ? num(rows[0].newBuyers) : 0;
  return {
    total,
    newBuyers,
    returningBuyers: total - newBuyers,
    rows: rows.map((row) => {
      const orders = num(row.orders);
      const gross = num(row.gross);
      const refunded = num(row.refunded);
      return {
        customerId: row.customerId,
        email: row.email,
        name: row.name,
        isGuest: row.isGuest,
        isNew: row.isNew,
        orders,
        units: num(row.units),
        grossPaise: gross,
        refundedPaise: refunded,
        revenuePaise: gross - refunded,
        avgOrderPaise: orders > 0 ? Math.round((gross - refunded) / orders) : 0,
        firstOrderAt: row.firstOrderAt,
        lastOrderAt: row.lastOrderAt,
      };
    }),
  };
}

/** Distinct buyers in the range split new / returning, for the customers report chart and totals. */
export async function buyerCounts(
  range: MetricRange,
  filters?: ItemFilters,
  tx?: Db,
): Promise<{ buyers: number; newBuyers: number; returningBuyers: number; guestOrders: number }> {
  const rows = await client(tx).$queryRaw<Array<{ buyers: unknown; newBuyers: unknown; guestOrders: unknown }>>`
    WITH scoped AS (
      SELECT o.id, o."placedAt", o."customerId", COALESCE(o."customerId", 'guest:' || lower(o."guestEmail"), 'guest:unknown') AS buyer_key
        FROM "Order" o
        ${whereAll(orderConditions(range, filters))}
    ),
    per_buyer AS (
      SELECT s.buyer_key, MIN(s."placedAt") AS first_in_range,
             (SELECT MIN(o2."placedAt") FROM "Order" o2
               WHERE o2.status NOT IN ('CANCELLED', 'FAILED')
                 AND COALESCE(o2."customerId", 'guest:' || lower(o2."guestEmail"), 'guest:unknown') = s.buyer_key) AS first_ever
        FROM scoped s
       GROUP BY s.buyer_key
    )
    SELECT (SELECT COUNT(*) FROM per_buyer)::int AS buyers,
           (SELECT COUNT(*) FROM per_buyer WHERE first_in_range <= first_ever)::int AS "newBuyers",
           (SELECT COUNT(*) FROM scoped WHERE "customerId" IS NULL)::int AS "guestOrders"`;
  const row = rows[0];
  const buyers = num(row?.buyers);
  const newBuyers = num(row?.newBuyers);
  return { buyers, newBuyers, returningBuyers: buyers - newBuyers, guestOrders: num(row?.guestOrders) };
}

/** Customers whose account was created in the range (Customer.createdAt). */
export async function newCustomerCount(range: MetricRange, tx?: Db): Promise<number> {
  const rows = await client(tx).$queryRaw<Array<{ n: unknown }>>`
    SELECT COUNT(*)::int AS n FROM "Customer" c WHERE c."deletedAt" IS NULL AND ${inRange(Prisma.sql`c."createdAt"`, range)}`;
  return num(rows[0]?.n);
}
