import "server-only";

import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";

import type {
  ActivityRow,
  DashboardAlert,
  RecentCustomerRow,
  RecentOrderRow,
  RecentReviewRow,
  RecentSellerRow,
} from "./types";

/**
 * The reads that are the dashboard's own.
 *
 * Anything that is a *metric* (revenue, order counts, growth, leaderboards)
 * belongs to `@/features/reports/metrics` and is loaded in ./data.ts - this
 * file only holds what no report answers: the "most recent N" strips, the
 * live alert list and the demo-data banner. Keeping the split strict is what
 * stops the dashboard and the reports drifting apart (E4).
 *
 * Every function here is a bounded read (`take`), never an unbounded
 * findMany, and every one is safe to call in parallel from its own Suspense
 * boundary.
 */

/** Inquiries still waiting on a human. E4's snapshot counts NEW only. */
export async function supportQueueCount(): Promise<number> {
  return db.contactInquiry.count({ where: { status: { in: ["NEW", "OPEN"] } } });
}

export async function recentOrders(take = 8): Promise<RecentOrderRow[]> {
  const rows = await db.order.findMany({
    orderBy: { placedAt: "desc" },
    take,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      totalPaise: true,
      placedAt: true,
      guestEmail: true,
      customer: { select: { fullName: true, email: true } },
      addresses: { where: { type: "SHIPPING" }, select: { fullName: true }, take: 1 },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.orderNumber,
    // The shipping snapshot is the name the order was placed under; the
    // customer record can have been renamed since, and the operator is
    // looking for the parcel, not the account.
    customerName:
      row.addresses[0]?.fullName ?? row.customer?.fullName ?? row.customer?.email ?? row.guestEmail ?? "Guest",
    placedAt: row.placedAt,
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    totalPaise: row.totalPaise,
  }));
}

export async function recentCustomers(take = 6): Promise<RecentCustomerRow[]> {
  const rows = await db.customer.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      fullName: true,
      email: true,
      createdAt: true,
      orderCount: true,
      totalSpentPaise: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.fullName ?? row.email,
    email: row.email,
    createdAt: row.createdAt,
    orderCount: row.orderCount,
    totalSpentPaise: row.totalSpentPaise,
  }));
}

export async function recentSellers(take = 6): Promise<RecentSellerRow[]> {
  const rows = await db.seller.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      displayName: true,
      email: true,
      status: true,
      createdAt: true,
      productCount: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.displayName,
    email: row.email,
    status: row.status,
    createdAt: row.createdAt,
    productCount: row.productCount,
  }));
}

const REVIEW_SELECT = {
  id: true,
  authorName: true,
  rating: true,
  status: true,
  createdAt: true,
  productId: true,
  product: { select: { title: true } },
} as const;

/**
 * Pending first, then newest: the panel is a moderation queue, not a feed, so
 * the rows that need a decision have to be at the top even when they are old.
 *
 * `Review.status` is a String column, so `orderBy: { status: 'asc' }` would
 * sort it ALPHABETICALLY - APPROVED before PENDING - and quietly bury the
 * queue. Two bounded queries express the intent instead: fill with pending,
 * top up with whatever else is recent.
 */
export async function recentReviews(take = 6): Promise<RecentReviewRow[]> {
  const pending = await db.review.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take,
    select: REVIEW_SELECT,
  });

  const rest =
    pending.length >= take
      ? []
      : await db.review.findMany({
          where: { status: { not: "PENDING" } },
          orderBy: { createdAt: "desc" },
          take: take - pending.length,
          select: REVIEW_SELECT,
        });

  const rows = [...pending, ...rest];

  return rows.map((row) => ({
    id: row.id,
    authorName: row.authorName,
    productId: row.productId,
    productTitle: row.product?.title ?? null,
    rating: row.rating,
    status: row.status,
    createdAt: row.createdAt,
  }));
}

/** Audit entity types whose admin detail route exists and takes the raw id. */
const ENTITY_ROUTES: Record<string, string> = {
  Product: "/admin/products",
  Order: "/admin/orders",
  Customer: "/admin/customers",
  Seller: "/admin/sellers",
  Category: "/admin/categories",
  Coupon: "/admin/coupons",
  CmsPage: "/admin/pages",
  BlogPost: "/admin/blog",
  Banner: "/admin/banners",
  Promotion: "/admin/promotions",
};

export async function recentActivity(take = 15): Promise<ActivityRow[]> {
  const rows = await db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      actorEmail: true,
      action: true,
      summary: true,
      entityType: true,
      entityId: true,
      createdAt: true,
    },
  });

  return rows.map((row) => {
    const base = ENTITY_ROUTES[row.entityType];
    return {
      id: row.id,
      actorEmail: row.actorEmail,
      action: row.action,
      summary: row.summary,
      entityType: row.entityType,
      entityId: row.entityId,
      href: base && row.entityId ? `${base}/${row.entityId}` : null,
      createdAt: row.createdAt,
    };
  });
}

/**
 * Alerts are computed, never stored, so they cannot go stale, and each one
 * names a concrete number with the screen that fixes it. Every alert declares
 * the permission its link needs - an operator who cannot open /admin/payouts
 * is not told that payouts are waiting (D14).
 */
export async function dashboardAlerts(now = new Date()): Promise<DashboardAlert[]> {
  const failedPaymentsSince = addDays(now, -7);

  const [outOfStock, lowStock, pendingSellers, failedPayments, openReturns, pendingRefunds, failedJobs] =
    await Promise.all([
      db.inventoryItem.count({
        where: {
          stockState: "OUT_OF_STOCK",
          variant: { deletedAt: null, product: { deletedAt: null, status: "PUBLISHED" } },
        },
      }),
      db.inventoryItem.count({
        where: {
          stockState: "LOW_STOCK",
          variant: { deletedAt: null, product: { deletedAt: null, status: "PUBLISHED" } },
        },
      }),
      db.seller.count({ where: { deletedAt: null, status: { in: ["PENDING", "UNDER_REVIEW"] } } }),
      db.orderPayment.count({ where: { status: "FAILED", createdAt: { gte: failedPaymentsSince } } }),
      db.returnRequest.count({
        where: { status: { in: ["REQUESTED", "UNDER_REVIEW", "APPROVED", "PICKUP_SCHEDULED", "RECEIVED"] } },
      }),
      db.refund.count({ where: { status: { in: ["PENDING", "APPROVED"] } } }),
      db.job.count({ where: { status: "FAILED" } }),
    ]);

  const alerts: DashboardAlert[] = [
    {
      key: "out-of-stock",
      tone: "danger",
      title: "Live products are out of stock",
      detail: "Published variants with nothing available to sell.",
      count: outOfStock,
      href: "/admin/inventory?stock=OUT_OF_STOCK",
      actionLabel: "Restock",
      permission: "inventory.view",
    },
    {
      key: "low-stock",
      tone: "warning",
      title: "Variants are low on stock",
      detail: "At or under their low-stock threshold.",
      count: lowStock,
      href: "/admin/inventory?stock=LOW_STOCK",
      actionLabel: "Review",
      permission: "inventory.view",
    },
    {
      key: "seller-approvals",
      tone: "warning",
      title: "Sellers are waiting for approval",
      detail: "Registered but not yet reviewed.",
      count: pendingSellers,
      href: "/admin/sellers?status=PENDING",
      actionLabel: "Review",
      permission: "sellers.view",
    },
    {
      key: "failed-payments",
      tone: "danger",
      title: "Payments failed in the last 7 days",
      detail: "The order never got paid; the reservation expires on its own.",
      count: failedPayments,
      href: "/admin/payments?status=FAILED",
      actionLabel: "Inspect",
      permission: "payments.view",
    },
    {
      key: "open-returns",
      tone: "warning",
      title: "Returns are open",
      detail: "RMAs before QC; the customer is waiting on a decision.",
      count: openReturns,
      href: "/admin/returns",
      actionLabel: "Open returns",
      permission: "returns.view",
    },
    {
      key: "pending-refunds",
      tone: "warning",
      title: "Refunds are waiting to be paid",
      detail: "Approved or pending refunds that have not left yet.",
      count: pendingRefunds,
      href: "/admin/refunds?status=PENDING",
      actionLabel: "Process",
      permission: "refunds.view",
    },
    {
      key: "failed-jobs",
      tone: "danger",
      title: "Background jobs failed",
      detail: "Emails, payouts or stock checks that never completed.",
      count: failedJobs,
      href: "/admin/jobs?status=FAILED",
      actionLabel: "Retry",
      permission: "jobs.view",
    },
  ];

  return alerts.filter((alert) => alert.count > 0);
}

/**
 * True while the seeded demo catalogue is still present. Every demo row's id
 * starts with `demo_` (seed contract), so one indexed prefix count answers it
 * without a settings flag that can be edited into a lie.
 */
export async function hasDemoData(): Promise<boolean> {
  const count = await db.product.count({ where: { id: { startsWith: "demo_" } } });
  return count > 0;
}
