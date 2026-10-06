import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { istDayKey } from "@/lib/dates";
import { CUSTOMER_SEGMENTS, type CustomerSegment } from "@/lib/enums";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";
import { normalizePhone } from "@/lib/validation";

import { averageOrderValue, segmentFor, segmentsFor, segmentWhere, type SegmentThresholds } from "./domain";
import type { CustomerListFilters, CustomerSort } from "./filters";
import { ADDRESS_SELECT, CUSTOMER_CORE_SELECT, resolveSegmentThresholds, type AddressRecord, type CustomerCore } from "./service";

/**
 * Read side of the customers module for Server Components and the admin REST
 * GETs. Counters (`orderCount`, `totalSpentPaise`, ...) are read from the
 * Customer row (C7) - the ORDERS module keeps them current through
 * recomputeCustomerCounters - so the list never joins the Order table.
 */

export type { SegmentThresholds };
export { resolveSegmentThresholds };

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export type CustomerRow = CustomerCore & { segment: CustomerSegment | null };

export type CustomerListResult = { rows: CustomerRow[]; total: number; meta: PageMeta };

function searchWhere(q: string): Prisma.CustomerWhereInput | undefined {
  const term = q.trim();
  if (!term) return undefined;
  const or: Prisma.CustomerWhereInput[] = [
    { fullName: { contains: term, mode: "insensitive" } },
    { email: { contains: term, mode: "insensitive" } },
  ];
  // "98765 43210" and "+91 98765-43210" should both find the same customer.
  const digits = term.replace(/\D/g, "");
  if (digits.length >= 4) {
    or.push({ phone: { contains: digits.slice(-10) } });
    const normalised = normalizePhone(term);
    if (normalised) or.push({ phone: normalised });
  }
  return { OR: or };
}

export function buildCustomerWhere(filters: CustomerListFilters, thresholds: SegmentThresholds, now = new Date()): Prisma.CustomerWhereInput {
  const and: Prisma.CustomerWhereInput[] = [];
  // Deleted customers are hidden unless explicitly asked for.
  if (filters.status === "DELETED") and.push({ deletedAt: { not: null } });
  else {
    and.push({ deletedAt: null });
    if (filters.status) and.push({ status: filters.status });
  }
  const search = searchWhere(filters.q);
  if (search) and.push(search);
  if (filters.segment) and.push(segmentWhere(filters.segment, thresholds, now));
  if (filters.acceptsMarketing !== undefined) and.push({ acceptsMarketing: filters.acceptsMarketing });
  if (filters.tags.length > 0) and.push({ tags: { hasEvery: filters.tags } });
  if (filters.ids && filters.ids.length > 0) and.push({ id: { in: filters.ids } });
  if (filters.from || filters.to) and.push({ createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } });
  return { AND: and };
}

function orderBy(sort: CustomerSort, order: "asc" | "desc"): Prisma.CustomerOrderByWithRelationInput[] {
  switch (sort) {
    case "name":
      return [{ fullName: { sort: order, nulls: "last" } }, { email: order }];
    case "orderCount":
      return [{ orderCount: order }, { id: "asc" }];
    case "totalSpentPaise":
      return [{ totalSpentPaise: order }, { id: "asc" }];
    case "lastOrderAt":
      return [{ lastOrderAt: { sort: order, nulls: "last" } }, { id: "asc" }];
    default:
      return [{ createdAt: order }, { id: "asc" }];
  }
}

export async function listCustomers(params: ListParams, filters: CustomerListFilters, thresholds?: SegmentThresholds): Promise<CustomerListResult> {
  const resolved = thresholds ?? (await resolveSegmentThresholds());
  const now = new Date();
  const where = buildCustomerWhere(filters, resolved, now);
  const [rows, total] = await Promise.all([
    db.customer.findMany({ where, orderBy: orderBy(params.sort as CustomerSort, params.order), skip: params.skip, take: params.pageSize, select: CUSTOMER_CORE_SELECT }),
    db.customer.count({ where }),
  ]);
  return {
    rows: rows.map((row) => ({ ...row, segment: segmentFor(row, resolved, now) })),
    total,
    meta: buildPageMeta(total, params),
  };
}

export type SegmentCounts = Record<"all" | CustomerSegment, number>;

/** Tab counts for the CURRENT filter minus the segment itself, so switching tabs never shows "0" for a tab that would have rows. */
export async function getSegmentCounts(filters: CustomerListFilters, thresholds?: SegmentThresholds): Promise<SegmentCounts> {
  const resolved = thresholds ?? (await resolveSegmentThresholds());
  const now = new Date();
  const base = { ...filters, segment: undefined };
  const [all, ...perSegment] = await Promise.all([
    db.customer.count({ where: buildCustomerWhere(base, resolved, now) }),
    ...CUSTOMER_SEGMENTS.map((segment) => db.customer.count({ where: buildCustomerWhere({ ...base, segment }, resolved, now) })),
  ]);
  const counts = { all } as SegmentCounts;
  CUSTOMER_SEGMENTS.forEach((segment, index) => {
    counts[segment] = perSegment[index] ?? 0;
  });
  return counts;
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export type CustomerKpis = {
  total: number;
  newThisMonth: number;
  /** Share of customers with at least `returningMinOrders` orders, in percent. */
  repeatRatePct: number;
  averageLifetimeValuePaise: number;
  blocked: number;
};

export async function getCustomerKpis(thresholds?: SegmentThresholds): Promise<CustomerKpis> {
  const resolved = thresholds ?? (await resolveSegmentThresholds());
  const now = new Date();
  // "This month" is the IST calendar month, matching the dashboard presets.
  const monthKey = istDayKey(now).slice(0, 7);
  const monthStart = new Date(`${monthKey}-01T00:00:00+05:30`);
  const live = { deletedAt: null } as const;

  const [total, newThisMonth, returning, blocked, spend] = await Promise.all([
    db.customer.count({ where: live }),
    db.customer.count({ where: { ...live, createdAt: { gte: monthStart } } }),
    db.customer.count({ where: { ...live, orderCount: { gte: resolved.returningMinOrders } } }),
    db.customer.count({ where: { ...live, status: "BLOCKED" } }),
    db.customer.aggregate({ where: { ...live, orderCount: { gt: 0 } }, _avg: { totalSpentPaise: true } }),
  ]);
  const buyers = await db.customer.count({ where: { ...live, orderCount: { gt: 0 } } });
  return {
    total,
    newThisMonth,
    repeatRatePct: buyers > 0 ? Math.round((returning / buyers) * 1000) / 10 : 0,
    averageLifetimeValuePaise: Math.round(spend._avg.totalSpentPaise ?? 0),
    blocked,
  };
}

/** Distinct tags across live customers, most used first - for TagInput suggestions and the tags filter. */
export async function getTagSuggestions(limit = 50): Promise<string[]> {
  const rows = await db.customer.findMany({ where: { deletedAt: null, NOT: { tags: { isEmpty: true } } }, select: { tags: true }, take: 2000, orderBy: { updatedAt: "desc" } });
  const counts = new Map<string, number>();
  for (const row of rows) for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([tag]) => tag);
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type CustomerDetail = CustomerCore & {
  segment: CustomerSegment | null;
  segments: CustomerSegment[];
  averageOrderValuePaise: number;
  counts: { addresses: number; orders: number; wishlist: number; reviews: number; returns: number; refunds: number; payments: number; sessions: number };
  thresholds: SegmentThresholds;
};

export async function getCustomerDetail(id: string): Promise<CustomerDetail | null> {
  const customer = await db.customer.findUnique({ where: { id }, select: CUSTOMER_CORE_SELECT });
  if (!customer) return null;
  const thresholds = await resolveSegmentThresholds();
  const [addresses, orders, wishlist, reviews, returns, refunds, payments, sessions] = await Promise.all([
    db.address.count({ where: { customerId: id } }),
    db.order.count({ where: { customerId: id } }),
    db.wishlistItem.count({ where: { wishlist: { customerId: id } } }),
    db.review.count({ where: { customerId: id } }),
    db.returnRequest.count({ where: { OR: [{ customerId: id }, { order: { customerId: id } }] } }),
    db.refund.count({ where: { order: { customerId: id } } }),
    db.orderPayment.count({ where: { order: { customerId: id } } }),
    db.customerSession.count({ where: { customerId: id } }),
  ]);
  const now = new Date();
  return {
    ...customer,
    segment: segmentFor(customer, thresholds, now),
    segments: segmentsFor(customer, thresholds, now),
    averageOrderValuePaise: averageOrderValue(customer.totalSpentPaise, customer.orderCount),
    counts: { addresses, orders, wishlist, reviews, returns, refunds, payments, sessions },
    thresholds,
  };
}

export const ORDER_ROW_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  paymentStatus: true,
  paymentMethod: true,
  fulfillmentStatus: true,
  totalPaise: true,
  refundedPaise: true,
  placedAt: true,
  _count: { select: { items: true } },
} satisfies Prisma.OrderSelect;
export type CustomerOrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_ROW_SELECT }>;

export type CustomerOverview = {
  recentOrders: CustomerOrderRow[];
  /** Net spend per IST month for the last 12 months, oldest first (Sparkline). */
  monthlySpend: Array<{ month: string; paise: number; orders: number }>;
  defaultAddress: AddressRecord | null;
};

export async function getCustomerOverview(id: string): Promise<CustomerOverview> {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 11, 1);
  since.setUTCHours(0, 0, 0, 0);
  const [recentOrders, orders, defaultAddress] = await Promise.all([
    db.order.findMany({ where: { customerId: id }, orderBy: { placedAt: "desc" }, take: 5, select: ORDER_ROW_SELECT }),
    db.order.findMany({
      where: { customerId: id, placedAt: { gte: since }, status: { notIn: ["CANCELLED", "FAILED"] } },
      select: { placedAt: true, totalPaise: true, refundedPaise: true },
    }),
    db.address.findFirst({ where: { customerId: id }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: ADDRESS_SELECT }),
  ]);

  const buckets = new Map<string, { paise: number; orders: number }>();
  const cursor = new Date(since);
  for (let i = 0; i < 12; i += 1) {
    buckets.set(istDayKey(cursor).slice(0, 7), { paise: 0, orders: 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  for (const order of orders) {
    const key = istDayKey(order.placedAt).slice(0, 7);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.paise += order.totalPaise - order.refundedPaise;
    bucket.orders += 1;
  }
  return {
    recentOrders,
    monthlySpend: [...buckets.entries()].map(([month, value]) => ({ month, ...value })),
    defaultAddress,
  };
}

export async function getCustomerAddresses(id: string): Promise<AddressRecord[]> {
  return db.address.findMany({ where: { customerId: id }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: ADDRESS_SELECT });
}

export async function getCustomerOrders(id: string, params: ListParams): Promise<{ rows: CustomerOrderRow[]; meta: PageMeta }> {
  const where = { customerId: id };
  const [rows, total] = await Promise.all([
    db.order.findMany({ where, orderBy: [{ placedAt: "desc" }, { id: "asc" }], skip: params.skip, take: params.pageSize, select: ORDER_ROW_SELECT }),
    db.order.count({ where }),
  ]);
  return { rows, meta: buildPageMeta(total, params) };
}

export type WishlistRow = {
  id: string;
  createdAt: Date;
  product: { id: string; title: string; slug: string; status: string; pricePaise: number };
  variant: { id: string; name: string; sku: string | null; pricePaise: number | null; isActive: boolean };
};

export async function getCustomerWishlist(id: string): Promise<WishlistRow[]> {
  return db.wishlistItem.findMany({
    where: { wishlist: { customerId: id } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      createdAt: true,
      product: { select: { id: true, title: true, slug: true, status: true, pricePaise: true } },
      variant: { select: { id: true, name: true, sku: true, pricePaise: true, isActive: true } },
    },
  });
}

export const REVIEW_ROW_SELECT = {
  id: true,
  rating: true,
  title: true,
  body: true,
  status: true,
  isVerifiedPurchase: true,
  createdAt: true,
  product: { select: { id: true, title: true } },
} satisfies Prisma.ReviewSelect;
export type CustomerReviewRow = Prisma.ReviewGetPayload<{ select: typeof REVIEW_ROW_SELECT }>;

export async function getCustomerReviews(id: string): Promise<CustomerReviewRow[]> {
  return db.review.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 100, select: REVIEW_ROW_SELECT });
}

export const RETURN_ROW_SELECT = {
  id: true,
  rmaNumber: true,
  status: true,
  reason: true,
  quantity: true,
  requestedResolution: true,
  requestedAt: true,
  resolvedAt: true,
  order: { select: { id: true, orderNumber: true } },
  orderItem: { select: { titleSnapshot: true, variantSnapshot: true } },
} satisfies Prisma.ReturnRequestSelect;
export type CustomerReturnRow = Prisma.ReturnRequestGetPayload<{ select: typeof RETURN_ROW_SELECT }>;

export async function getCustomerReturns(id: string): Promise<CustomerReturnRow[]> {
  return db.returnRequest.findMany({
    where: { OR: [{ customerId: id }, { order: { customerId: id } }] },
    orderBy: { requestedAt: "desc" },
    take: 100,
    select: RETURN_ROW_SELECT,
  });
}

export const REFUND_ROW_SELECT = {
  id: true,
  refundNumber: true,
  status: true,
  method: true,
  amountPaise: true,
  reason: true,
  createdAt: true,
  completedAt: true,
  order: { select: { id: true, orderNumber: true } },
  returnRequest: { select: { id: true, rmaNumber: true } },
} satisfies Prisma.RefundSelect;
export type CustomerRefundRow = Prisma.RefundGetPayload<{ select: typeof REFUND_ROW_SELECT }>;

export async function getCustomerRefunds(id: string): Promise<CustomerRefundRow[]> {
  return db.refund.findMany({ where: { order: { customerId: id } }, orderBy: { createdAt: "desc" }, take: 100, select: REFUND_ROW_SELECT });
}

export const PAYMENT_ROW_SELECT = {
  id: true,
  provider: true,
  method: true,
  type: true,
  status: true,
  amountPaise: true,
  providerPaymentId: true,
  failureMessage: true,
  createdAt: true,
  order: { select: { id: true, orderNumber: true } },
} satisfies Prisma.OrderPaymentSelect;
export type CustomerPaymentRow = Prisma.OrderPaymentGetPayload<{ select: typeof PAYMENT_ROW_SELECT }>;

export async function getCustomerPayments(id: string): Promise<CustomerPaymentRow[]> {
  return db.orderPayment.findMany({ where: { order: { customerId: id } }, orderBy: { createdAt: "desc" }, take: 200, select: PAYMENT_ROW_SELECT });
}

export type CustomerActivity = {
  audit: Array<{ id: string; action: string; summary: string; actorEmail: string; createdAt: Date; ip: string | null }>;
  sessions: Array<{ id: string; ip: string | null; userAgent: string | null; createdAt: Date; expiresAt: Date; revokedAt: Date | null }>;
  notifications: Array<{ id: string; type: string; title: string; body: string | null; createdAt: Date }>;
};

/** Audit rows about this customer, mirrored website sessions and any admin notifications that point at them. */
export async function getCustomerActivity(id: string): Promise<CustomerActivity> {
  const [audit, sessions, notifications] = await Promise.all([
    db.auditLog.findMany({
      where: { entityType: "customer", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, action: true, summary: true, actorEmail: true, createdAt: true, ip: true },
    }),
    db.customerSession.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true, revokedAt: true },
    }),
    db.notification.findMany({
      where: { entityType: "Customer", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      distinct: ["title", "createdAt"],
      select: { id: true, type: true, title: true, body: true, createdAt: true },
    }),
  ]);
  return { audit, sessions, notifications };
}
