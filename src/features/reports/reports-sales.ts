import type { Prisma } from "@prisma/client";
import type { Route } from "next";

import { db } from "@/lib/db";
import { ORDER_STATUS_META, type OrderStatus } from "@/lib/enums";
import {
  countTotal,
  defineReport,
  effectiveBucket,
  moneyTotal,
  pageRows,
  pct,
  percentTotal,
  reportPageMeta,
  slicePage,
  sortRows,
  sumBy,
  toItemFilters,
} from "./define";
import { ordersByStatus, revenueSeries, revenueTotals, type RevenueBucket } from "./metrics-sales";
import { EXCLUDED_ORDER_STATUSES, resolveCategoryPath } from "./sql";
import type { ReportColumn, ReportRow, ReportRunParams, ReportTotal } from "./types";

/**
 * Sales, revenue and orders reports. The first two are the same E4 series
 * through two lenses: "sales" is the operator's daily sheet (orders, units,
 * discounts, tax, shipping), "revenue" is the finance view (gross → refunds →
 * revenue → net). "orders" is the row-level list behind them.
 */

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

const SALES_COLUMNS: readonly ReportColumn[] = [
  { key: "label", label: "Period", type: "string", sortable: true, locked: true },
  { key: "orders", label: "Orders", type: "number", sortable: true, total: true },
  { key: "units", label: "Units", type: "number", sortable: true, total: true },
  { key: "subtotalPaise", label: "Subtotal", type: "money", sortable: true, total: true, hint: "Σ line gross before discounts" },
  { key: "discountsPaise", label: "Discounts", type: "money", sortable: true, total: true, hint: "Promotion + coupon allocations" },
  { key: "shippingPaise", label: "Shipping", type: "money", sortable: true, total: true, defaultHidden: true },
  { key: "codFeePaise", label: "COD fee", type: "money", sortable: true, total: true, defaultHidden: true },
  { key: "taxPaise", label: "Tax", type: "money", sortable: true, total: true },
  { key: "grossPaise", label: "Charged", type: "money", sortable: true, total: true, hint: "Σ order totals" },
  { key: "refundedPaise", label: "Refunded", type: "money", sortable: true, total: true },
  { key: "revenuePaise", label: "Revenue", type: "money", sortable: true, total: true, hint: "Charged − refunded" },
  { key: "netSalesPaise", label: "Net sales", type: "money", sortable: true, total: true, hint: "Revenue − shipping − COD fee" },
  { key: "aovPaise", label: "Avg order", type: "money", sortable: true, defaultHidden: true },
];

function salesRow(bucket: RevenueBucket): ReportRow {
  return {
    key: bucket.key,
    label: bucket.label,
    orders: bucket.orders,
    units: bucket.units,
    subtotalPaise: bucket.subtotalPaise,
    discountsPaise: bucket.discountPaise + bucket.couponDiscountPaise,
    shippingPaise: bucket.shippingPaise,
    codFeePaise: bucket.codFeePaise,
    taxPaise: bucket.taxPaise,
    grossPaise: bucket.grossPaise,
    refundedPaise: bucket.refundedPaise,
    revenuePaise: bucket.revenuePaise,
    netSalesPaise: bucket.netSalesPaise,
    aovPaise: bucket.orders > 0 ? Math.round(bucket.revenuePaise / bucket.orders) : 0,
  };
}

async function salesSeries(params: ReportRunParams) {
  const categoryPath = await resolveCategoryPath(params.filters.categoryId);
  const filters = toItemFilters(params.filters, categoryPath);
  const bucket = effectiveBucket(params);
  const series = await revenueSeries(params.range, { bucket, filters });
  // Period sorts by key (the ISO date), not the display label.
  const sortKey = params.sort === "label" ? "key" : params.sort;
  return { bucket, series, rows: sortRows(series.map(salesRow), sortKey, params.order, "key"), filters };
}

function revenueTotalsStrip(total: RevenueBucket): ReportTotal[] {
  return [
    moneyTotal("revenue", "Revenue", total.revenuePaise, "Charged − refunded"),
    moneyTotal("netSales", "Net sales", total.netSalesPaise, "Revenue − shipping − COD fee"),
    countTotal("orders", "Orders", total.orders),
    countTotal("units", "Units", total.units),
    moneyTotal("aov", "Avg order value", total.orders > 0 ? Math.round(total.revenuePaise / total.orders) : 0),
    moneyTotal("refunded", "Refunded", total.refundedPaise),
    moneyTotal("tax", "Tax", total.taxPaise),
  ];
}

export const salesReport = defineReport({
  key: "sales",
  about:
    "Orders placed per period with what they were worth: units, discounts, tax, shipping and the revenue left after refunds. Revenue counts every order that is not cancelled or failed, dated by when it was placed (IST); refunds are attributed to the order's period.",
  filters: ["bucket", "seller", "category", "product", "paymentMethod", "status"],
  columns: SALES_COLUMNS,
  defaultSort: "label",
  defaultOrder: "desc",
  async run(params) {
    const { bucket, series, rows, filters } = await salesSeries(params);
    const totals = await revenueTotals(params.range, filters);
    return {
      ...pageRows(rows, params),
      totals: revenueTotalsStrip(totals),
      chart: {
        kind: "time-series",
        xKey: "label",
        valueFormat: "money",
        series: [
          { key: "revenuePaise", label: "Revenue" },
          { key: "netSalesPaise", label: "Net sales" },
        ],
        data: series.map((item) => ({ label: item.label, key: item.key, revenuePaise: item.revenuePaise, netSalesPaise: item.netSalesPaise })),
        title: `Revenue by ${bucket}`,
      },
      note: "Revenue = Σ order total − Σ refunded, for orders not CANCELLED or FAILED, by placement date in IST. Net sales additionally exclude shipping and COD fees, which carry no tax and belong to the platform.",
    };
  },
  async exportPage(params, skip, take) {
    const { rows } = await salesSeries(params);
    return slicePage(rows, skip, take);
  },
  async headline(range) {
    const total = await revenueTotals(range);
    return moneyTotal("revenue", "Revenue", total.revenuePaise);
  },
});

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

const REVENUE_COLUMNS: readonly ReportColumn[] = [
  { key: "label", label: "Period", type: "string", sortable: true, locked: true },
  { key: "orders", label: "Orders", type: "number", sortable: true, total: true },
  { key: "grossPaise", label: "Charged", type: "money", sortable: true, total: true },
  { key: "refundedPaise", label: "Refunds", type: "money", sortable: true, total: true },
  { key: "revenuePaise", label: "Revenue", type: "money", sortable: true, total: true },
  { key: "shippingPaise", label: "Shipping", type: "money", sortable: true, total: true },
  { key: "codFeePaise", label: "COD fee", type: "money", sortable: true, total: true },
  { key: "netSalesPaise", label: "Net sales", type: "money", sortable: true, total: true },
  { key: "taxPaise", label: "Tax included", type: "money", sortable: true, total: true, defaultHidden: true },
  { key: "refundRatePct", label: "Refund rate", type: "percent", sortable: true, hint: "Refunded ÷ charged" },
];

export const revenueReport = defineReport({
  key: "revenue",
  about:
    "The finance view of the same orders: what customers were charged, what went back as refunds, the revenue that remains, and net sales once shipping and COD fees are set aside.",
  filters: ["bucket", "seller", "category", "paymentMethod"],
  columns: REVENUE_COLUMNS,
  defaultSort: "label",
  defaultOrder: "desc",
  async run(params) {
    const { bucket, series, rows, filters } = await salesSeries(params);
    const withRate = rows.map((row) => ({ ...row, refundRatePct: pct(row.refundedPaise as number, row.grossPaise as number) }));
    const totals = await revenueTotals(params.range, filters);
    return {
      ...pageRows(withRate, params),
      totals: [
        moneyTotal("gross", "Charged", totals.grossPaise),
        moneyTotal("refunded", "Refunds", totals.refundedPaise),
        moneyTotal("revenue", "Revenue", totals.revenuePaise),
        moneyTotal("shipping", "Shipping + COD", totals.shippingPaise + totals.codFeePaise),
        moneyTotal("netSales", "Net sales", totals.netSalesPaise),
        percentTotal("refundRate", "Refund rate", pct(totals.refundedPaise, totals.grossPaise)),
      ],
      chart: {
        kind: "time-series",
        xKey: "label",
        valueFormat: "money",
        series: [
          { key: "grossPaise", label: "Charged" },
          { key: "refundedPaise", label: "Refunds" },
          { key: "netSalesPaise", label: "Net sales" },
        ],
        data: series.map((item) => ({
          label: item.label,
          key: item.key,
          grossPaise: item.grossPaise,
          refundedPaise: item.refundedPaise,
          netSalesPaise: item.netSalesPaise,
        })),
        title: `Charged, refunds and net sales by ${bucket}`,
      },
      note: "Refunds are attributed to the period the order was placed in, so a period's revenue is what its orders were finally worth. The refunds report dates them by when the money moved.",
    };
  },
  async exportPage(params, skip, take) {
    const { rows } = await salesSeries(params);
    return slicePage(
      rows.map((row) => ({ ...row, refundRatePct: pct(row.refundedPaise as number, row.grossPaise as number) })),
      skip,
      take,
    );
  },
  async headline(range) {
    const total = await revenueTotals(range);
    return moneyTotal("netSales", "Net sales", total.netSalesPaise);
  },
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

const ORDER_COLUMNS: readonly ReportColumn[] = [
  { key: "orderNumber", label: "Order", type: "string", sortable: true, locked: true, hrefKey: "href" },
  { key: "placedAt", label: "Placed", type: "datetime", sortable: true },
  { key: "customer", label: "Customer", type: "string", subtitleKey: "email" },
  { key: "status", label: "Status", type: "status", statusKind: "order", sortable: true },
  { key: "paymentStatus", label: "Payment", type: "status", statusKind: "payment", sortable: true },
  { key: "paymentMethod", label: "Method", type: "status", statusKind: "paymentMethod", defaultHidden: true },
  { key: "source", label: "Source", type: "status", statusKind: "source", defaultHidden: true },
  { key: "couponCode", label: "Coupon", type: "string", defaultHidden: true },
  { key: "items", label: "Lines", type: "number", total: true },
  { key: "subtotalPaise", label: "Subtotal", type: "money", sortable: true, total: true, defaultHidden: true },
  { key: "discountsPaise", label: "Discounts", type: "money", total: true, defaultHidden: true },
  { key: "shippingPaise", label: "Shipping", type: "money", total: true, defaultHidden: true },
  { key: "taxPaise", label: "Tax", type: "money", total: true, defaultHidden: true },
  { key: "totalPaise", label: "Total", type: "money", sortable: true, total: true },
  { key: "refundedPaise", label: "Refunded", type: "money", sortable: true, total: true },
  { key: "revenuePaise", label: "Revenue", type: "money", total: true },
];

const ORDER_SORTS: Record<string, Prisma.OrderOrderByWithRelationInput> = {
  orderNumber: { seq: "asc" },
  placedAt: { placedAt: "asc" },
  status: { status: "asc" },
  paymentStatus: { paymentStatus: "asc" },
  subtotalPaise: { subtotalPaise: "asc" },
  totalPaise: { totalPaise: "asc" },
  refundedPaise: { refundedPaise: "asc" },
};

function orderOrderBy(sort: string, order: "asc" | "desc"): Prisma.OrderOrderByWithRelationInput[] {
  const base = ORDER_SORTS[sort] ?? ORDER_SORTS.placedAt;
  const [[field]] = Object.entries(base);
  return [{ [field]: order } as Prisma.OrderOrderByWithRelationInput, { id: "asc" }];
}

async function orderWhere(params: ReportRunParams): Promise<Prisma.OrderWhereInput> {
  const { filters, range } = params;
  const categoryPath = await resolveCategoryPath(filters.categoryId);
  const where: Prisma.OrderWhereInput = {
    placedAt: { gte: range.from, lte: range.to },
    status: filters.status ? filters.status : { notIn: [...EXCLUDED_ORDER_STATUSES] },
  };
  if (filters.paymentMethod) where.paymentMethod = filters.paymentMethod;
  if (filters.couponId) where.couponId = filters.couponId;
  const line: Prisma.OrderItemWhereInput = {};
  if (filters.sellerId) line.sellerId = filters.sellerId;
  if (filters.productId) line.productId = filters.productId;
  if (categoryPath) line.OR = [{ categoryPathSnapshot: categoryPath }, { categoryPathSnapshot: { startsWith: `${categoryPath}/` } }];
  if (Object.keys(line).length > 0) where.items = { some: line };
  return where;
}

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  placedAt: true,
  status: true,
  paymentStatus: true,
  paymentMethod: true,
  source: true,
  couponCode: true,
  guestEmail: true,
  subtotalPaise: true,
  discountPaise: true,
  couponDiscountPaise: true,
  shippingPaise: true,
  codFeePaise: true,
  taxPaise: true,
  totalPaise: true,
  refundedPaise: true,
  customer: { select: { fullName: true, email: true } },
  _count: { select: { items: true } },
} satisfies Prisma.OrderSelect;

function orderRow(order: Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>): ReportRow {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    href: `/admin/orders/${order.id}` as Route,
    placedAt: order.placedAt,
    customer: order.customer?.fullName ?? order.customer?.email ?? order.guestEmail ?? "Guest",
    email: order.customer?.email ?? order.guestEmail ?? "",
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    source: order.source,
    couponCode: order.couponCode ?? "",
    items: order._count.items,
    subtotalPaise: order.subtotalPaise,
    discountsPaise: order.discountPaise + order.couponDiscountPaise,
    shippingPaise: order.shippingPaise + order.codFeePaise,
    taxPaise: order.taxPaise,
    totalPaise: order.totalPaise,
    refundedPaise: order.refundedPaise,
    revenuePaise: order.totalPaise - order.refundedPaise,
  };
}

async function fetchOrders(params: ReportRunParams, skip: number, take: number) {
  const where = await orderWhere(params);
  const orders = await db.order.findMany({ where, select: ORDER_SELECT, orderBy: orderOrderBy(params.sort, params.order), skip, take });
  return orders.map(orderRow);
}

export const ordersReport = defineReport({
  key: "orders",
  about:
    "Every order placed in the range with its status, payment and money columns. Cancelled and failed orders are hidden unless you filter for that status, matching how revenue is counted.",
  filters: ["status", "paymentMethod", "seller", "category", "product", "coupon"],
  columns: ORDER_COLUMNS,
  defaultSort: "placedAt",
  defaultOrder: "desc",
  async run(params) {
    const where = await orderWhere(params);
    const categoryPath = await resolveCategoryPath(params.filters.categoryId);
    const filters = toItemFilters(params.filters, categoryPath);
    const [rows, total, statusMix, totals] = await Promise.all([
      fetchOrders(params, params.skip, params.pageSize),
      db.order.count({ where }),
      ordersByStatus(params.range, filters),
      revenueTotals(params.range, filters),
    ]);
    const cancelled = statusMix.byStatus.CANCELLED + statusMix.byStatus.FAILED;
    return {
      rows,
      meta: reportPageMeta(total, params),
      totals: [
        countTotal("orders", "Orders", totals.orders, params.filters.status ? `With status ${ORDER_STATUS_META[params.filters.status].label}` : "Excluding cancelled / failed"),
        moneyTotal("revenue", "Revenue", totals.revenuePaise),
        moneyTotal("aov", "Avg order value", totals.orders > 0 ? Math.round(totals.revenuePaise / totals.orders) : 0),
        moneyTotal("refunded", "Refunded", totals.refundedPaise),
        countTotal("cancelled", "Cancelled / failed", cancelled, "Placed in range, not counted in revenue"),
        percentTotal("cancelRate", "Cancellation rate", pct(cancelled, statusMix.total)),
      ],
      chart: {
        kind: "donut",
        valueFormat: "number",
        centerLabel: "orders",
        title: "Orders by status",
        data: (Object.entries(statusMix.byStatus) as Array<[OrderStatus, number]>)
          .filter(([, count]) => count > 0)
          .map(([status, count]) => ({ key: status, label: ORDER_STATUS_META[status].label, value: count })),
      },
      note: "The status chart includes cancelled and failed orders so the funnel is visible; the totals and rows follow the revenue rule unless a status filter is set.",
    };
  },
  exportPage: fetchOrders,
  async headline(range) {
    const total = await revenueTotals(range);
    return countTotal("orders", "Orders", total.orders);
  },
});

/** Exposed for the check script: totals must equal the sum of the paged rows. */
export function sumOrderRows(rows: ReportRow[], key: string): number {
  return sumBy(rows, key);
}
