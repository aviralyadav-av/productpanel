import { delta, formatNumber, formatPaise } from "@/lib/money";
import type { OrderStatus } from "@/lib/enums";
import type { KpiSnapshot, RevenueBucket } from "@/features/reports/metrics";

import type { KpiTile } from "./types";

/**
 * The KPI strip, built as pure data.
 *
 * Every figure comes from the shared metric layer (E4: "Dashboard and reports
 * share src/features/reports/metrics.ts") - this file only decides which
 * numbers become tiles, what they link to, and which module permission gates
 * each one. Keeping it free of Prisma means the check script can assert that
 * the tiles equal the metrics without going near a Server Component.
 *
 * Two groups, because they answer different questions and mixing them lies:
 *   - `range` tiles describe the selected date range and carry a delta
 *     against the immediately preceding window of the same length;
 *   - `now` tiles are point-in-time work queues and counters ("42 orders are
 *     pending"). They deliberately ignore the range, because their deep link
 *     is an unfiltered list and a tile must never disagree with the screen it
 *     opens.
 */

export type KpiInput = {
  snapshot: KpiSnapshot;
  /** Revenue totals for the selected range and the window before it. */
  current: RevenueBucket;
  previous: RevenueBucket;
  /** Customers registered in each window. */
  newCustomers: number;
  previousNewCustomers: number;
  /** Refunds created in each window (any status except CANCELLED). */
  refunds: { count: number; amountPaise: number };
  previousRefunds: { count: number; amountPaise: number };
  /** Inquiries still waiting on a human (NEW + OPEN), point in time. */
  supportOpen: number;
  /** `?from=...&to=...` for range-scoped deep links. */
  rangeQuery: string;
  rangeLabel: string;
};

function averagePaise(totalPaise: number, orders: number): number {
  return orders > 0 ? Math.round(totalPaise / orders) : 0;
}

/** A pipeline tile: current backlog in one status, linking to that filter. */
function statusTile(
  status: OrderStatus,
  label: string,
  byStatus: Record<OrderStatus, number>,
  higherIsBetter = true,
): KpiTile {
  return {
    key: `orders.${status.toLowerCase()}`,
    label,
    group: "now",
    raw: byStatus[status],
    format: "number",
    value: formatNumber(byStatus[status]),
    hint: "all time",
    href: `/admin/orders?status=${status}`,
    permission: "orders.view",
    higherIsBetter,
  };
}

export function buildKpiTiles(input: KpiInput): KpiTile[] {
  const { snapshot, current, previous, rangeQuery, rangeLabel } = input;
  const orderQuery = rangeQuery ? `/admin/orders?${rangeQuery}` : "/admin/orders";
  const customerQuery = rangeQuery ? `/admin/customers?${rangeQuery}` : "/admin/customers";
  const currentAov = averagePaise(current.revenuePaise, current.orders);
  const previousAov = averagePaise(previous.revenuePaise, previous.orders);
  const currentDiscount = current.discountPaise + current.couponDiscountPaise;
  const previousDiscount = previous.discountPaise + previous.couponDiscountPaise;

  const range: KpiTile[] = [
    {
      key: "range.revenue",
      label: "Revenue",
      group: "range",
      raw: current.revenuePaise,
      format: "money",
      value: formatPaise(current.revenuePaise),
      delta: delta(current.revenuePaise, previous.revenuePaise),
      href: orderQuery,
      permission: "orders.view",
    },
    {
      key: "range.netSales",
      label: "Net sales",
      group: "range",
      raw: current.netSalesPaise,
      format: "money",
      value: formatPaise(current.netSalesPaise),
      delta: delta(current.netSalesPaise, previous.netSalesPaise),
      permission: "orders.view",
    },
    {
      key: "range.orders",
      label: "Orders",
      group: "range",
      raw: current.orders,
      format: "number",
      value: formatNumber(current.orders),
      delta: delta(current.orders, previous.orders),
      href: orderQuery,
      permission: "orders.view",
    },
    {
      key: "range.aov",
      label: "Average order",
      group: "range",
      raw: currentAov,
      format: "money",
      value: formatPaise(currentAov),
      delta: delta(currentAov, previousAov),
      permission: "orders.view",
    },
    {
      key: "range.units",
      label: "Units sold",
      group: "range",
      raw: current.units,
      format: "number",
      value: formatNumber(current.units),
      delta: delta(current.units, previous.units),
      permission: "orders.view",
    },
    {
      key: "range.newCustomers",
      label: "New customers",
      group: "range",
      raw: input.newCustomers,
      format: "number",
      value: formatNumber(input.newCustomers),
      delta: delta(input.newCustomers, input.previousNewCustomers),
      href: customerQuery,
      permission: "customers.view",
    },
    {
      key: "range.refunds",
      label: "Refunds raised",
      group: "range",
      raw: input.refunds.amountPaise,
      format: "money",
      value: formatPaise(input.refunds.amountPaise),
      delta: delta(input.refunds.amountPaise, input.previousRefunds.amountPaise),
      hint: `${formatNumber(input.refunds.count)} in ${rangeLabel.toLowerCase()}`,
      href: "/admin/refunds",
      permission: "refunds.view",
      higherIsBetter: false,
    },
    {
      key: "range.discounts",
      label: "Discounts given",
      group: "range",
      raw: currentDiscount,
      format: "money",
      value: formatPaise(currentDiscount),
      delta: delta(currentDiscount, previousDiscount),
      permission: "orders.view",
      higherIsBetter: false,
    },
  ];

  const byStatus = snapshot.orders.byStatus;
  const now: KpiTile[] = [
    {
      key: "now.revenueToday",
      label: "Revenue today",
      group: "now",
      raw: snapshot.revenue.todayPaise,
      format: "money",
      value: formatPaise(snapshot.revenue.todayPaise),
      hint: `${formatNumber(snapshot.revenue.todayOrders)} orders today`,
      permission: "orders.view",
    },
    {
      key: "now.revenueWeek",
      label: "Revenue, 7 days",
      group: "now",
      raw: snapshot.revenue.weekPaise,
      format: "money",
      value: formatPaise(snapshot.revenue.weekPaise),
      hint: `${formatNumber(snapshot.revenue.weekOrders)} orders`,
      permission: "orders.view",
    },
    {
      key: "now.revenueMonth",
      label: "Revenue this month",
      group: "now",
      raw: snapshot.revenue.monthPaise,
      format: "money",
      value: formatPaise(snapshot.revenue.monthPaise),
      hint: `${formatNumber(snapshot.revenue.monthOrders)} orders`,
      permission: "orders.view",
    },
    {
      key: "now.revenueTotal",
      label: "Revenue all time",
      group: "now",
      raw: snapshot.revenue.totalPaise,
      format: "money",
      value: formatPaise(snapshot.revenue.totalPaise),
      hint: `${formatNumber(snapshot.revenue.totalOrders)} counted orders`,
      permission: "orders.view",
    },
    {
      key: "now.orders",
      label: "Total orders",
      group: "now",
      raw: snapshot.orders.total,
      format: "number",
      value: formatNumber(snapshot.orders.total),
      hint: `${formatNumber(snapshot.orders.actionable)} need action`,
      href: "/admin/orders",
      permission: "orders.view",
    },
    statusTile("PENDING", "Pending", byStatus, false),
    statusTile("PROCESSING", "Processing", byStatus),
    statusTile("SHIPPED", "Shipped", byStatus),
    statusTile("DELIVERED", "Delivered", byStatus),
    statusTile("CANCELLED", "Cancelled", byStatus, false),
    {
      key: "now.returns",
      label: "Open returns",
      group: "now",
      raw: snapshot.returns.open,
      format: "number",
      value: formatNumber(snapshot.returns.open),
      hint: `${formatNumber(snapshot.returns.total)} raised in total`,
      href: "/admin/returns",
      permission: "returns.view",
      higherIsBetter: false,
    },
    {
      key: "now.refundsPending",
      label: "Refunds to process",
      group: "now",
      raw: snapshot.refunds.pendingCount,
      format: "number",
      value: formatNumber(snapshot.refunds.pendingCount),
      hint: `${formatPaise(snapshot.refunds.pendingPaise)} owed`,
      href: "/admin/refunds?status=PENDING",
      permission: "refunds.view",
      higherIsBetter: false,
    },
    {
      key: "now.customers",
      label: "Customers",
      group: "now",
      raw: snapshot.customers.total,
      format: "number",
      value: formatNumber(snapshot.customers.total),
      hint: `${formatNumber(snapshot.customers.newThisMonth)} joined this month`,
      href: "/admin/customers",
      permission: "customers.view",
    },
    {
      key: "now.sellersActive",
      label: "Active sellers",
      group: "now",
      raw: snapshot.sellers.active,
      format: "number",
      value: formatNumber(snapshot.sellers.active),
      hint: `${formatNumber(snapshot.sellers.total)} registered`,
      href: "/admin/sellers?status=ACTIVE",
      permission: "sellers.view",
    },
    {
      key: "now.sellersPending",
      label: "Seller approvals",
      group: "now",
      raw: snapshot.sellers.pending,
      format: "number",
      value: formatNumber(snapshot.sellers.pending),
      hint: "awaiting review",
      href: "/admin/sellers?status=PENDING",
      permission: "sellers.view",
      higherIsBetter: false,
    },
    {
      key: "now.products",
      label: "Products",
      group: "now",
      raw: snapshot.products.total,
      format: "number",
      value: formatNumber(snapshot.products.total),
      hint: `${formatNumber(snapshot.products.draft)} still drafts`,
      href: "/admin/products",
      permission: "products.view",
    },
    {
      key: "now.productsPublished",
      label: "Live products",
      group: "now",
      raw: snapshot.products.published,
      format: "number",
      value: formatNumber(snapshot.products.published),
      hint: "visible on the storefront",
      href: "/admin/products?status=PUBLISHED",
      permission: "products.view",
    },
    {
      key: "now.outOfStock",
      label: "Out of stock",
      group: "now",
      raw: snapshot.products.outOfStockVariants,
      format: "number",
      value: formatNumber(snapshot.products.outOfStockVariants),
      hint: "live product variants",
      href: "/admin/inventory?stock=OUT_OF_STOCK",
      permission: "inventory.view",
      higherIsBetter: false,
    },
    {
      key: "now.lowStock",
      label: "Low stock",
      group: "now",
      raw: snapshot.products.lowStockVariants,
      format: "number",
      value: formatNumber(snapshot.products.lowStockVariants),
      hint: "at or under the threshold",
      href: "/admin/inventory?stock=LOW_STOCK",
      permission: "inventory.view",
      higherIsBetter: false,
    },
    {
      key: "now.reviews",
      label: "Reviews to moderate",
      group: "now",
      raw: snapshot.reviews.pending,
      format: "number",
      value: formatNumber(snapshot.reviews.pending),
      hint: "hidden until approved",
      href: "/admin/reviews?status=PENDING",
      permission: "reviews.view",
      higherIsBetter: false,
    },
    {
      key: "now.support",
      label: "Support requests",
      group: "now",
      raw: input.supportOpen,
      format: "number",
      value: formatNumber(input.supportOpen),
      hint: "new and open inquiries",
      href: "/admin/inquiries?status=NEW",
      permission: "inquiries.view",
      higherIsBetter: false,
    },
  ];

  return [...range, ...now];
}
