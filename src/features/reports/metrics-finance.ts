import { Prisma } from "@prisma/client";

import type { PayoutStatus, RefundMethod, RefundStatus, ReturnReason } from "@/lib/enums";
import { client, inRange, itemConditions, num, orderConditions, whereAll, type Db, type ItemFilters, type MetricRange } from "./sql";

/**
 * Finance metrics: what sellers earned, what the platform kept, what went
 * back to customers and how coupons performed.
 *
 * Seller and commission figures are read from the OrderItem SNAPSHOTS
 * (commissionPaise, chargesPaise, sellerPayablePaise written in the order
 * transaction, B3) and dated by placedAt, so they are "booked" figures - what
 * the marketplace will earn from these orders. The ledger (SellerLedgerEntry)
 * only records earnings once a shipment is DELIVERED and is the source for
 * balances and payouts; the two agree once everything is delivered.
 *
 *   sellerGrossPaise    Σ lineTotalPaise            what the customer paid for the seller's lines
 *   commissionPaise     Σ OrderItem.commissionPaise
 *   chargesPaise        Σ OrderItem.chargesPaise
 *   sellerPayablePaise  Σ OrderItem.sellerPayablePaise (sellerGross − commission − charges per B3)
 *   refundedPaise       Σ OrderItem.refundedPaise
 */

export type SellerSales = {
  sellerId: string | null;
  name: string;
  orders: number;
  units: number;
  lines: number;
  sellerGrossPaise: number;
  commissionPaise: number;
  chargesPaise: number;
  sellerPayablePaise: number;
  refundedPaise: number;
  /** Weighted average commission rate on the range's lines, in bps. */
  effectiveRateBps: number;
};

const SELLER_SORTS: Record<string, string> = {
  name: "name",
  orders: "orders",
  units: "units",
  gross: "gross",
  commission: "commission",
  charges: "charges",
  payable: "payable",
  refunded: "refunded",
};

/** Sales, commission and payable per seller; lines sold by the platform itself (sellerId null) are one row named "Platform". */
export async function topSellers(
  range: MetricRange,
  options: {
    limit?: number;
    skip?: number;
    filters?: ItemFilters;
    by?: keyof typeof SELLER_SORTS;
    order?: "asc" | "desc";
  } = {},
  tx?: Db,
): Promise<{ rows: SellerSales[]; total: number }> {
  const sortColumn = SELLER_SORTS[options.by ?? "gross"] ?? "gross";
  const direction = options.order === "asc" ? "ASC" : "DESC";
  const rows = await client(tx).$queryRaw<
    Array<{
      sellerId: string | null;
      name: string | null;
      orders: unknown;
      units: unknown;
      lines: unknown;
      gross: unknown;
      commission: unknown;
      charges: unknown;
      payable: unknown;
      refunded: unknown;
      taxable: unknown;
      total: unknown;
    }>
  >`
    SELECT oi."sellerId",
           COALESCE(s."displayName", (array_agg(oi."sellerNameSnapshot" ORDER BY o."placedAt" DESC))[1]) AS name,
           COUNT(DISTINCT oi."orderId")::int AS orders,
           COALESCE(SUM(oi.quantity), 0)::bigint AS units,
           COUNT(*)::int AS lines,
           COALESCE(SUM(oi."lineTotalPaise"), 0)::bigint AS gross,
           COALESCE(SUM(oi."commissionPaise"), 0)::bigint AS commission,
           COALESCE(SUM(oi."chargesPaise"), 0)::bigint AS charges,
           COALESCE(SUM(oi."sellerPayablePaise"), 0)::bigint AS payable,
           COALESCE(SUM(oi."refundedPaise"), 0)::bigint AS refunded,
           COALESCE(SUM(oi."lineTotalPaise" - oi."taxPaise"), 0)::bigint AS taxable,
           COUNT(*) OVER ()::int AS total
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      LEFT JOIN "Seller" s ON s.id = oi."sellerId"
      ${whereAll(itemConditions(range, options.filters))}
     GROUP BY oi."sellerId", s."displayName"
     ${Prisma.raw(`ORDER BY ${sortColumn} ${direction} NULLS LAST, name ASC, oi."sellerId"`)}
     LIMIT ${options.limit ?? 10} OFFSET ${options.skip ?? 0}`;
  return {
    total: rows.length ? num(rows[0].total) : 0,
    rows: rows.map((row) => {
      const taxable = num(row.taxable);
      const commission = num(row.commission);
      return {
        sellerId: row.sellerId,
        name: row.name ?? (row.sellerId ? "Deleted seller" : "Platform"),
        orders: num(row.orders),
        units: num(row.units),
        lines: num(row.lines),
        sellerGrossPaise: num(row.gross),
        commissionPaise: commission,
        chargesPaise: num(row.charges),
        sellerPayablePaise: num(row.payable),
        refundedPaise: num(row.refunded),
        effectiveRateBps: taxable > 0 ? Math.round((commission * 10000) / taxable) : 0,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

export type CommissionSummaryRow = {
  /** Seller id, or CommissionRule id, depending on `groupBy`. Null = platform lines / no rule. */
  key: string | null;
  label: string;
  /** For rule grouping: GLOBAL | CATEGORY | SELLER | PRODUCT. */
  scope: string | null;
  lines: number;
  orders: number;
  sellerGrossPaise: number;
  taxableValuePaise: number;
  commissionPaise: number;
  chargesPaise: number;
  sellerPayablePaise: number;
  /** Snapshot rate on the lines (weighted by taxable value), bps. */
  effectiveRateBps: number;
  /** Σ commissionFixedPaise × qty, the per-unit part of the rule (B3). */
  fixedPaise: number;
};

/**
 * Commission booked in the range, grouped by seller or by the CommissionRule
 * snapshotted on each line (B3: `OrderItem.commissionRuleId`). Lines whose
 * rule was deleted keep their money under "Rule no longer exists"; platform
 * lines (sellerId null) carry no commission by definition and are shown so
 * the totals reconcile with the sellers report.
 */
export async function commissionSummary(
  range: MetricRange,
  options: { groupBy: "seller" | "rule"; filters?: ItemFilters },
  tx?: Db,
): Promise<CommissionSummaryRow[]> {
  const bySeller = options.groupBy === "seller";
  const keyColumn = bySeller ? Prisma.sql`oi."sellerId"` : Prisma.sql`oi."commissionRuleId"`;
  const labelColumn = bySeller
    ? Prisma.sql`COALESCE(s."displayName", (array_agg(oi."sellerNameSnapshot" ORDER BY o."placedAt" DESC))[1])`
    : Prisma.sql`COALESCE(r.note, r."targetKey")`;
  const scopeColumn = bySeller ? Prisma.sql`NULL::text` : Prisma.sql`r.scope`;
  const join = bySeller
    ? Prisma.sql`LEFT JOIN "Seller" s ON s.id = oi."sellerId"`
    : Prisma.sql`LEFT JOIN "CommissionRule" r ON r.id = oi."commissionRuleId"`;
  const groupBy = bySeller
    ? Prisma.sql`GROUP BY oi."sellerId", s."displayName"`
    : Prisma.sql`GROUP BY oi."commissionRuleId", r.note, r."targetKey", r.scope`;

  const rows = await client(tx).$queryRaw<
    Array<{
      key: string | null;
      label: string | null;
      scope: string | null;
      lines: unknown;
      orders: unknown;
      gross: unknown;
      taxable: unknown;
      commission: unknown;
      charges: unknown;
      payable: unknown;
      fixed: unknown;
    }>
  >`
    SELECT ${keyColumn} AS key, ${labelColumn} AS label, ${scopeColumn} AS scope,
           COUNT(*)::int AS lines,
           COUNT(DISTINCT oi."orderId")::int AS orders,
           COALESCE(SUM(oi."lineTotalPaise"), 0)::bigint AS gross,
           COALESCE(SUM(oi."lineTotalPaise" - oi."taxPaise"), 0)::bigint AS taxable,
           COALESCE(SUM(oi."commissionPaise"), 0)::bigint AS commission,
           COALESCE(SUM(oi."chargesPaise"), 0)::bigint AS charges,
           COALESCE(SUM(oi."sellerPayablePaise"), 0)::bigint AS payable,
           COALESCE(SUM(oi."commissionFixedPaise"::bigint * oi.quantity), 0)::bigint AS fixed
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      ${join}
      ${whereAll(itemConditions(range, options.filters))}
     ${groupBy}
     ORDER BY commission DESC, label ASC`;

  return rows.map((row) => {
    const taxable = num(row.taxable);
    const commission = num(row.commission);
    const fixed = num(row.fixed);
    return {
      key: row.key,
      label: row.label ?? (row.key ? (bySeller ? "Deleted seller" : "Rule no longer exists") : bySeller ? "Platform" : "No rule (0%)"),
      scope: row.scope,
      lines: num(row.lines),
      orders: num(row.orders),
      sellerGrossPaise: num(row.gross),
      taxableValuePaise: taxable,
      commissionPaise: commission,
      chargesPaise: num(row.charges),
      sellerPayablePaise: num(row.payable),
      effectiveRateBps: taxable > 0 ? Math.round(((commission - fixed) * 10000) / taxable) : 0,
      fixedPaise: fixed,
    };
  });
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

export type PayoutStatusSummary = {
  status: PayoutStatus;
  count: number;
  grossSalesPaise: number;
  commissionPaise: number;
  chargesPaise: number;
  refundsPaise: number;
  adjustmentsPaise: number;
  netPaise: number;
};

/** Payout statements created in the range (SellerPayout.createdAt), totalled per status. */
export async function payoutSummary(
  range: MetricRange,
  filters: { sellerId?: string; status?: PayoutStatus } = {},
  tx?: Db,
): Promise<PayoutStatusSummary[]> {
  const conditions: Prisma.Sql[] = [inRange(Prisma.sql`p."createdAt"`, range)];
  if (filters.sellerId) conditions.push(Prisma.sql`p."sellerId" = ${filters.sellerId}`);
  if (filters.status) conditions.push(Prisma.sql`p.status = ${filters.status}`);
  const rows = await client(tx).$queryRaw<
    Array<{ status: PayoutStatus; n: unknown; gross: unknown; commission: unknown; charges: unknown; refunds: unknown; adjustments: unknown; net: unknown }>
  >`
    SELECT p.status, COUNT(*)::int AS n,
           COALESCE(SUM(p."grossSalesPaise"), 0)::bigint AS gross,
           COALESCE(SUM(p."commissionPaise"), 0)::bigint AS commission,
           COALESCE(SUM(p."chargesPaise"), 0)::bigint AS charges,
           COALESCE(SUM(p."refundsPaise"), 0)::bigint AS refunds,
           COALESCE(SUM(p."adjustmentsPaise"), 0)::bigint AS adjustments,
           COALESCE(SUM(p."netPaise"), 0)::bigint AS net
      FROM "SellerPayout" p
      ${whereAll(conditions)}
     GROUP BY 1
     ORDER BY net DESC`;
  return rows.map((row) => ({
    status: row.status,
    count: num(row.n),
    grossSalesPaise: num(row.gross),
    commissionPaise: num(row.commission),
    chargesPaise: num(row.charges),
    refundsPaise: num(row.refunds),
    adjustmentsPaise: num(row.adjustments),
    netPaise: num(row.net),
  }));
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export type RefundGroup = { key: string; count: number; amountPaise: number; completedPaise: number };

export type RefundGroupBy = "reason" | "method" | "status";

/**
 * Refunds created in the range (Refund.createdAt - the money moves on the
 * refund's date, not the order's), grouped by reason, method or status.
 * `reason` is the linked ReturnRequest.reason code when the refund came
 * from an RMA; refunds without one (cancellations after payment) group as
 * CANCELLATION. `amountPaise` sums every non-cancelled refund;
 * `completedPaise` only those COMPLETED - the figure that has actually left.
 */
export async function refundSummary(
  range: MetricRange,
  options: { groupBy: RefundGroupBy; filters?: { status?: RefundStatus; method?: RefundMethod; reason?: ReturnReason | "CANCELLATION"; sellerId?: string } },
  tx?: Db,
): Promise<RefundGroup[]> {
  const filters = options.filters ?? {};
  const reasonExpr = Prisma.sql`COALESCE(rr.reason, 'CANCELLATION')`;
  const keyColumn =
    options.groupBy === "reason" ? reasonExpr : options.groupBy === "method" ? Prisma.sql`r.method` : Prisma.sql`r.status`;
  const conditions: Prisma.Sql[] = [inRange(Prisma.sql`r."createdAt"`, range)];
  if (filters.status) conditions.push(Prisma.sql`r.status = ${filters.status}`);
  else conditions.push(Prisma.sql`r.status <> 'CANCELLED'`);
  if (filters.method) conditions.push(Prisma.sql`r.method = ${filters.method}`);
  if (filters.reason) conditions.push(Prisma.sql`${reasonExpr} = ${filters.reason}`);
  if (filters.sellerId) {
    conditions.push(
      Prisma.sql`(rr."sellerId" = ${filters.sellerId} OR (rr.id IS NULL AND EXISTS (SELECT 1 FROM "OrderItem" x WHERE x."orderId" = r."orderId" AND x."sellerId" = ${filters.sellerId})))`,
    );
  }
  const rows = await client(tx).$queryRaw<Array<{ key: string; n: unknown; amount: unknown; completed: unknown }>>`
    SELECT ${keyColumn} AS key, COUNT(*)::int AS n,
           COALESCE(SUM(r."amountPaise"), 0)::bigint AS amount,
           COALESCE(SUM(r."amountPaise") FILTER (WHERE r.status = 'COMPLETED'), 0)::bigint AS completed
      FROM "Refund" r
      LEFT JOIN "ReturnRequest" rr ON rr.id = r."returnRequestId"
      ${whereAll(conditions)}
     GROUP BY 1
     ORDER BY amount DESC`;
  return rows.map((row) => ({ key: row.key, count: num(row.n), amountPaise: num(row.amount), completedPaise: num(row.completed) }));
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

export type CouponPerformance = {
  couponId: string;
  code: string;
  name: string;
  type: string;
  fundedBy: string;
  isActive: boolean;
  usages: number;
  orders: number;
  discountPaise: number;
  /** E4 revenue of the orders that used the coupon. */
  revenuePaise: number;
  avgOrderPaise: number;
  /** Lifetime usageCount from the coupon row, for context beside the range figures. */
  lifetimeUsages: number;
};

/**
 * Coupon performance in the range, from CouponUsage joined to counted orders
 * (cancelled/failed orders are excluded from both usages and revenue, so a
 * coupon whose orders all failed shows zero rather than looking popular).
 */
export async function couponPerformance(
  range: MetricRange,
  filters: { couponId?: string; paymentMethod?: ItemFilters["paymentMethod"]; sellerId?: string } = {},
  tx?: Db,
): Promise<CouponPerformance[]> {
  const conditions = orderConditions(range, { paymentMethod: filters.paymentMethod, sellerId: filters.sellerId }, "o");
  if (filters.couponId) conditions.push(Prisma.sql`u."couponId" = ${filters.couponId}`);
  const rows = await client(tx).$queryRaw<
    Array<{
      couponId: string;
      code: string;
      name: string;
      type: string;
      fundedBy: string;
      isActive: boolean;
      usageCount: unknown;
      usages: unknown;
      orders: unknown;
      discount: unknown;
      revenue: unknown;
    }>
  >`
    SELECT c.id AS "couponId", c.code, c.name, c.type, c."fundedBy", c."isActive", c."usageCount",
           COUNT(*)::int AS usages,
           COUNT(DISTINCT u."orderId")::int AS orders,
           COALESCE(SUM(u."discountPaise"), 0)::bigint AS discount,
           COALESCE(SUM(o."totalPaise" - o."refundedPaise"), 0)::bigint AS revenue
      FROM "CouponUsage" u
      JOIN "Order" o ON o.id = u."orderId"
      JOIN "Coupon" c ON c.id = u."couponId"
      ${whereAll(conditions)}
     GROUP BY c.id
     ORDER BY discount DESC, c.code ASC`;
  return rows.map((row) => {
    const orders = num(row.orders);
    const revenue = num(row.revenue);
    return {
      couponId: row.couponId,
      code: row.code,
      name: row.name,
      type: row.type,
      fundedBy: row.fundedBy,
      isActive: row.isActive,
      usages: num(row.usages),
      orders,
      discountPaise: num(row.discount),
      revenuePaise: revenue,
      avgOrderPaise: orders > 0 ? Math.round(revenue / orders) : 0,
      lifetimeUsages: num(row.usageCount),
    };
  });
}

// ---------------------------------------------------------------------------
// Tax
// ---------------------------------------------------------------------------

export type TaxSummaryRow = {
  hsnCode: string | null;
  taxRateBps: number;
  lines: number;
  units: number;
  /** Σ lineTotalPaise − taxPaise: the value tax was computed on, for inclusive and exclusive pricing alike (B1). */
  taxableValuePaise: number;
  taxPaise: number;
  /** Σ lineTotalPaise. */
  grossPaise: number;
};

/**
 * Tax grouped by (hsnCodeSnapshot, taxRateBps) as E4 requires. Under
 * inclusive pricing lineTotal = lineNet and tax is carved out of it; under
 * exclusive pricing lineTotal = lineNet + tax. In both cases the taxable
 * value is lineTotal − tax, which is what the formula here uses.
 */
export async function taxSummary(range: MetricRange, filters?: ItemFilters, tx?: Db): Promise<TaxSummaryRow[]> {
  const rows = await client(tx).$queryRaw<
    Array<{ hsnCode: string | null; taxRateBps: number; lines: unknown; units: unknown; taxable: unknown; tax: unknown; gross: unknown }>
  >`
    SELECT oi."hsnCodeSnapshot" AS "hsnCode", oi."taxRateBps",
           COUNT(*)::int AS lines,
           COALESCE(SUM(oi.quantity), 0)::bigint AS units,
           COALESCE(SUM(oi."lineTotalPaise" - oi."taxPaise"), 0)::bigint AS taxable,
           COALESCE(SUM(oi."taxPaise"), 0)::bigint AS tax,
           COALESCE(SUM(oi."lineTotalPaise"), 0)::bigint AS gross
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      ${whereAll(itemConditions(range, filters))}
     GROUP BY 1, 2
     ORDER BY tax DESC, 1 NULLS LAST, 2`;
  return rows.map((row) => ({
    hsnCode: row.hsnCode,
    taxRateBps: num(row.taxRateBps),
    lines: num(row.lines),
    units: num(row.units),
    taxableValuePaise: num(row.taxable),
    taxPaise: num(row.tax),
    grossPaise: num(row.gross),
  }));
}
