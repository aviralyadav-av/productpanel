import "server-only";

import { cache } from "react";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { resolveRange, type RangePreset } from "@/lib/dates";
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/enums";
import {
  buildPageMeta,
  one,
  parseListParams,
  type SearchParams,
} from "@/lib/list-params";

/**
 * Every number on the orders screens comes from these functions, and every one
 * of them is a real aggregate over the order tables. Nothing is estimated.
 *
 * Cancelled and returned orders are excluded from revenue, and recorded refunds
 * are subtracted, so "revenue" here means the same thing it means on the
 * dashboard. Two screens disagreeing about revenue is how an operator stops
 * trusting the panel.
 */
const REVENUE_STATUSES = [
  "PLACED",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
] as const;

/**
 * "All time" is the default rather than a rolling window: this store has a few
 * hundred orders, and a list that silently hides last month's order because of
 * a default filter is a support call waiting to happen.
 */
export const ORDER_RANGE_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
] as const;

export type OrderRangeKey = (typeof ORDER_RANGE_OPTIONS)[number]["value"];

/** Only these two columns can be sorted on; anything else falls back to date. */
export const ORDER_SORT_FIELDS = ["placedAt", "totalPaise"] as const;
export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

function resolveOrderRange(key: OrderRangeKey) {
  return key === "all" ? null : resolveRange(key as RangePreset);
}

export function rangeLabel(key: OrderRangeKey): string {
  return (
    ORDER_RANGE_OPTIONS.find((option) => option.value === key)?.label ??
    "All time"
  );
}

export function parseOrderFilters(params: SearchParams) {
  const list = parseListParams(params, {
    defaultSort: "placedAt",
    defaultOrder: "desc",
    pageSize: 25,
  });

  const status = one(params, "status");
  const payment = one(params, "payment");
  const method = one(params, "method");
  const range = one(params, "range");

  return {
    ...list,
    sort: (ORDER_SORT_FIELDS as readonly string[]).includes(list.sort)
      ? (list.sort as OrderSortField)
      : ("placedAt" as OrderSortField),
    status: ORDER_STATUSES.includes(status as OrderStatus)
      ? (status as OrderStatus)
      : undefined,
    payment: PAYMENT_STATUSES.includes(payment as PaymentStatus)
      ? (payment as PaymentStatus)
      : undefined,
    method: PAYMENT_METHODS.includes(method as PaymentMethod)
      ? (method as PaymentMethod)
      : undefined,
    range: ORDER_RANGE_OPTIONS.some((option) => option.value === range)
      ? (range as OrderRangeKey)
      : ("all" as OrderRangeKey),
  };
}

export type OrderFilters = ReturnType<typeof parseOrderFilters>;

/**
 * `ignore` drops one facet from the where clause so that facet's own counts
 * stay visible after it is selected - otherwise picking "Shipped" would show
 * every other status as zero and there would be no way to see what you are
 * switching to.
 */
function whereFrom(
  filters: OrderFilters,
  ignore?: "status" | "payment" | "method",
): Prisma.OrderWhereInput {
  const range = resolveOrderRange(filters.range);
  const where: Prisma.OrderWhereInput = {};

  if (range) where.placedAt = { gte: range.from, lte: range.to };
  if (filters.status && ignore !== "status") where.status = filters.status;
  if (filters.payment && ignore !== "payment") {
    where.paymentStatus = filters.payment;
  }
  if (filters.method && ignore !== "method") {
    where.paymentMethod = filters.method;
  }

  if (filters.q) {
    where.OR = [
      { orderNumber: { contains: filters.q, mode: "insensitive" } },
      { shipFullName: { contains: filters.q, mode: "insensitive" } },
      { shipEmail: { contains: filters.q, mode: "insensitive" } },
      { shipPhone: { contains: filters.q, mode: "insensitive" } },
    ];
  }

  return where;
}

function countsByKey<K extends string>(
  rows: Array<{ key: string; count: number }>,
  keys: readonly K[],
): Record<K, number> {
  const output = Object.fromEntries(keys.map((key) => [key, 0])) as Record<
    K,
    number
  >;
  for (const row of rows) {
    if ((keys as readonly string[]).includes(row.key)) {
      output[row.key as K] = row.count;
    }
  }
  return output;
}

export async function listOrders(params: SearchParams) {
  const filters = parseOrderFilters(params);

  const where = whereFrom(filters);
  // KPIs and the status tabs share one base: everything the operator filtered
  // on except status itself. So the tiles always describe the list on screen.
  const statusBase = whereFrom(filters, "status");

  const orderBy: Prisma.OrderOrderByWithRelationInput =
    filters.sort === "totalPaise"
      ? { totalPaise: filters.order }
      : { placedAt: filters.order };

  const [
    rows,
    total,
    statusGroups,
    paymentGroups,
    methodGroups,
    scopedTotal,
    revenue,
    awaitingConfirmation,
  ] = await Promise.all([
    db.order.findMany({
      where,
      orderBy,
      skip: filters.skip,
      take: filters.pageSize,
      select: {
        id: true,
        orderNumber: true,
        placedAt: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        totalPaise: true,
        refundedPaise: true,
        shipFullName: true,
        shipCity: true,
        shipState: true,
        items: { select: { quantity: true } },
      },
    }),
    db.order.count({ where }),
    db.order.groupBy({
      by: ["status"],
      where: statusBase,
      _count: { _all: true },
    }),
    db.order.groupBy({
      by: ["paymentStatus"],
      where: whereFrom(filters, "payment"),
      _count: { _all: true },
    }),
    db.order.groupBy({
      by: ["paymentMethod"],
      where: whereFrom(filters, "method"),
      _count: { _all: true },
    }),
    db.order.count({ where: statusBase }),
    db.order.aggregate({
      where: { ...statusBase, status: { in: [...REVENUE_STATUSES] } },
      _sum: { totalPaise: true, refundedPaise: true },
      _count: true,
    }),
    db.order.count({ where: { ...statusBase, status: "PLACED" } }),
  ]);

  const revenuePaise =
    (revenue._sum.totalPaise ?? 0) - (revenue._sum.refundedPaise ?? 0);
  const revenueOrders = revenue._count;

  return {
    filters,
    meta: buildPageMeta(total, filters),
    rows: rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      placedAt: row.placedAt,
      status: row.status,
      paymentStatus: row.paymentStatus,
      paymentMethod: row.paymentMethod,
      totalPaise: row.totalPaise,
      refundedPaise: row.refundedPaise,
      customerName: row.shipFullName,
      city: row.shipCity,
      state: row.shipState,
      lines: row.items.length,
      units: row.items.reduce((sum, item) => sum + item.quantity, 0),
    })),
    statusCounts: countsByKey(
      statusGroups.map((group) => ({
        key: group.status,
        count: group._count._all,
      })),
      ORDER_STATUSES,
    ),
    paymentCounts: countsByKey(
      paymentGroups.map((group) => ({
        key: group.paymentStatus,
        count: group._count._all,
      })),
      PAYMENT_STATUSES,
    ),
    methodCounts: countsByKey(
      methodGroups.map((group) => ({
        key: group.paymentMethod,
        count: group._count._all,
      })),
      PAYMENT_METHODS,
    ),
    kpis: {
      orders: scopedTotal,
      revenuePaise,
      revenueOrders,
      aovPaise: revenueOrders > 0 ? Math.round(revenuePaise / revenueOrders) : 0,
      awaitingConfirmation,
      rangeLabel: rangeLabel(filters.range),
    },
  };
}

export type OrderListResult = Awaited<ReturnType<typeof listOrders>>;
export type OrderListRow = OrderListResult["rows"][number];

/**
 * Accepts either the cuid or the human order number, so pasting "NIYA-17..."
 * into the address bar lands on the right order.
 *
 * Wrapped in cache() so generateMetadata and the page body share one query
 * instead of hitting the database twice per view.
 */
export const getOrderDetail = cache(async function getOrderDetail(
  idOrNumber: string,
) {
  const order = await db.order.findFirst({
    where: { OR: [{ id: idOrNumber }, { orderNumber: idOrNumber }] },
    include: {
      items: {
        orderBy: { id: "asc" },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              images: {
                take: 1,
                orderBy: { position: "asc" },
                select: { media: { select: { url: true } } },
              },
            },
          },
          variant: { select: { id: true, name: true, sku: true } },
        },
      },
      events: {
        orderBy: { createdAt: "asc" },
        include: { actor: { select: { name: true, email: true } } },
      },
      customer: {
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });

  if (!order) return null;

  // Checkout on the storefront is anonymous, so plenty of orders have no
  // Customer row. Falling back to the shipping email still gives an honest
  // lifetime figure for the person who placed this order.
  const lifetime = await db.order.aggregate({
    where: {
      status: { in: [...REVENUE_STATUSES] },
      ...(order.customerId
        ? { customerId: order.customerId }
        : { shipEmail: order.shipEmail }),
    },
    _sum: { totalPaise: true, refundedPaise: true },
    _count: true,
  });

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    source: order.source,

    subtotalPaise: order.subtotalPaise,
    shippingPaise: order.shippingPaise,
    discountPaise: order.discountPaise,
    taxPaise: order.taxPaise,
    totalPaise: order.totalPaise,
    refundedPaise: order.refundedPaise,
    discountCode: order.discountCode,

    shipFullName: order.shipFullName,
    shipEmail: order.shipEmail,
    shipPhone: order.shipPhone,
    shipAddress: order.shipAddress,
    shipCity: order.shipCity,
    shipState: order.shipState,
    shipPinCode: order.shipPinCode,

    placedAt: order.placedAt,
    confirmedAt: order.confirmedAt,
    shippedAt: order.shippedAt,
    deliveredAt: order.deliveredAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    legacyDateString: order.legacyDateString,

    customer: order.customer,
    lifetime: {
      orders: lifetime._count,
      valuePaise:
        (lifetime._sum.totalPaise ?? 0) - (lifetime._sum.refundedPaise ?? 0),
      matchedBy: order.customerId ? ("customer" as const) : ("email" as const),
    },

    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      title: item.titleSnapshot,
      variantName: item.variantSnapshot,
      sku: item.skuSnapshot,
      // The snapshot wins: the order must render as it was placed even if the
      // product has since been re-photographed or deleted.
      imageUrl: item.imageUrl ?? item.product?.images[0]?.media.url ?? null,
      listPricePaise: item.listPricePaise,
      unitPricePaise: item.unitPricePaise,
      quantity: item.quantity,
      lineTotalPaise: item.lineTotalPaise,
      productStillExists: Boolean(item.product),
    })),

    events: order.events.map((event) => ({
      id: event.id,
      type: event.type,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      message: event.message,
      isInternal: event.isInternal,
      createdAt: event.createdAt,
      actorName: event.actor?.name ?? event.actor?.email ?? null,
    })),
  };
});

export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;
export type OrderLineItem = OrderDetail["items"][number];
export type OrderTimelineEvent = OrderDetail["events"][number];
