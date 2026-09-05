import "server-only";

import { db } from "@/lib/db";
import {
  dayKeysInRange,
  istDayKey,
  previousRange,
  resolveRange,
  type RangePreset,
} from "@/lib/dates";
import { delta } from "@/lib/money";
import { stockState } from "@/lib/enums";

/**
 * Every figure on the dashboard is computed from the orders and inventory
 * tables. Nothing here is invented.
 *
 * Deliberately ABSENT, because the data to compute them does not exist:
 *   - conversion rate, cart abandonment, product views, add-to-cart rate.
 *     All need client-side event tracking. The storefront emits no events,
 *     and its cart lives in the shopper's own localStorage where no server can
 *     see it. These cannot be faked into existence by the admin panel.
 *
 * Aggregation over days is done in JavaScript rather than SQL date functions.
 * At this volume (tens to low thousands of orders) the difference is
 * immeasurable, and it keeps the queries identical on SQLite and Postgres.
 * The moment order rows pass ~100k, replace this with a daily rollup table.
 */

/** Cancelled orders are excluded from revenue; returned ones are not sales. */
const REVENUE_STATUSES = [
  "PLACED",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
] as const;

export type DashboardKpis = Awaited<ReturnType<typeof getKpis>>;
export type RevenueSeries = Awaited<ReturnType<typeof getRevenueSeries>>;
export type DashboardAlert = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
};

export async function getKpis(preset: RangePreset = "30d") {
  const range = resolveRange(preset);
  const previous = previousRange(range);

  async function windowStats(from: Date, to: Date) {
    const [aggregate, units, newCustomers, cancelled] = await Promise.all([
      db.order.aggregate({
        where: {
          placedAt: { gte: from, lte: to },
          status: { in: [...REVENUE_STATUSES] },
        },
        _sum: { totalPaise: true, refundedPaise: true },
        _count: true,
      }),
      db.orderItem.aggregate({
        where: {
          order: {
            placedAt: { gte: from, lte: to },
            status: { in: [...REVENUE_STATUSES] },
          },
        },
        _sum: { quantity: true },
      }),
      db.customer.count({ where: { createdAt: { gte: from, lte: to } } }),
      db.order.count({
        where: { placedAt: { gte: from, lte: to }, status: "CANCELLED" },
      }),
    ]);

    const gross = aggregate._sum.totalPaise ?? 0;
    const refunded = aggregate._sum.refundedPaise ?? 0;
    const orders = aggregate._count;
    const totalOrders = orders + cancelled;

    return {
      revenuePaise: gross - refunded,
      orders,
      unitsSold: units._sum.quantity ?? 0,
      newCustomers,
      cancelled,
      aovPaise: orders > 0 ? Math.round((gross - refunded) / orders) : 0,
      cancellationRate: totalOrders > 0 ? (cancelled / totalOrders) * 100 : 0,
    };
  }

  const [current, prior] = await Promise.all([
    windowStats(range.from, range.to),
    windowStats(previous.from, previous.to),
  ]);

  return {
    range,
    current,
    previous: prior,
    deltas: {
      revenue: delta(current.revenuePaise, prior.revenuePaise),
      orders: delta(current.orders, prior.orders),
      aov: delta(current.aovPaise, prior.aovPaise),
      units: delta(current.unitsSold, prior.unitsSold),
      newCustomers: delta(current.newCustomers, prior.newCustomers),
      cancellationRate: delta(current.cancellationRate, prior.cancellationRate),
    },
  };
}

export async function getRevenueSeries(preset: RangePreset = "30d") {
  const range = resolveRange(preset);

  const orders = await db.order.findMany({
    where: {
      placedAt: { gte: range.from, lte: range.to },
      status: { in: [...REVENUE_STATUSES] },
    },
    select: { placedAt: true, totalPaise: true, refundedPaise: true },
  });

  const buckets = new Map<string, { revenuePaise: number; orders: number }>();
  for (const key of dayKeysInRange(range)) {
    buckets.set(key, { revenuePaise: 0, orders: 0 });
  }

  for (const order of orders) {
    const bucket = buckets.get(istDayKey(order.placedAt));
    if (!bucket) continue;
    bucket.revenuePaise += order.totalPaise - order.refundedPaise;
    bucket.orders += 1;
  }

  return [...buckets.entries()].map(([day, value]) => ({ day, ...value }));
}

export async function getOrderStatusBreakdown() {
  const grouped = await db.order.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  return grouped
    .map((row) => ({ status: row.status, count: row._count._all }))
    .sort((a, b) => b.count - a.count);
}

export async function getRecentOrders(take = 8) {
  return db.order.findMany({
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
      shipFullName: true,
      shipCity: true,
      _count: { select: { items: true } },
    },
  });
}

export async function getTopProducts(preset: RangePreset = "30d", take = 5) {
  const range = resolveRange(preset);

  const grouped = await db.orderItem.groupBy({
    by: ["productId"],
    where: {
      order: {
        placedAt: { gte: range.from, lte: range.to },
        status: { in: [...REVENUE_STATUSES] },
      },
      productId: { not: null },
    },
    _sum: { lineTotalPaise: true, quantity: true },
    orderBy: { _sum: { lineTotalPaise: "desc" } },
    take,
  });

  const ids = grouped.map((row) => row.productId!).filter(Boolean);
  if (ids.length === 0) return [];

  const products = await db.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      pricePaise: true,
      salePricePaise: true,
      category: { select: { name: true } },
      images: {
        take: 1,
        orderBy: { position: "asc" },
        select: { media: { select: { url: true } } },
      },
    },
  });

  const byId = new Map(products.map((product) => [product.id, product]));

  return grouped.flatMap((row) => {
    const product = byId.get(row.productId!);
    if (!product) return [];
    return [
      {
        id: product.id,
        title: product.title,
        category: product.category?.name ?? "Uncategorised",
        imageUrl: product.images[0]?.media.url ?? null,
        revenuePaise: row._sum.lineTotalPaise ?? 0,
        units: row._sum.quantity ?? 0,
      },
    ];
  });
}

export async function getStockSnapshot() {
  const items = await db.inventoryItem.findMany({
    include: {
      variant: {
        select: {
          id: true,
          name: true,
          sku: true,
          product: { select: { id: true, title: true } },
        },
      },
    },
  });

  const rows = items.map((item) => {
    const available = item.onHand - item.reserved;
    return {
      variantId: item.variantId,
      productId: item.variant.product.id,
      title: item.variant.product.title,
      variantName: item.variant.name,
      sku: item.variant.sku,
      onHand: item.onHand,
      available,
      threshold: item.lowStockThreshold,
      state: stockState(available, item.lowStockThreshold),
    };
  });

  return {
    total: rows.length,
    inStock: rows.filter((row) => row.state === "IN_STOCK").length,
    lowStock: rows.filter((row) => row.state === "LOW_STOCK"),
    outOfStock: rows.filter((row) => row.state === "OUT_OF_STOCK"),
  };
}

export async function getRecentCustomers(take = 5) {
  const customers = await db.customer.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      fullName: true,
      email: true,
      createdAt: true,
      orders: {
        where: { status: { in: [...REVENUE_STATUSES] } },
        select: { totalPaise: true, refundedPaise: true },
      },
    },
  });

  return customers.map((customer) => ({
    id: customer.id,
    name: customer.fullName ?? customer.email,
    email: customer.email,
    createdAt: customer.createdAt,
    orderCount: customer.orders.length,
    lifetimeValuePaise: customer.orders.reduce(
      (sum, order) => sum + order.totalPaise - order.refundedPaise,
      0,
    ),
  }));
}

export async function getRecentActivity(take = 6) {
  return db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      actorEmail: true,
      action: true,
      entityType: true,
      summary: true,
      createdAt: true,
    },
  });
}

/**
 * "Sale price at or above list price" compares two columns of the same row,
 * which Prisma's portable filter language cannot express. Only the handful of
 * products that carry a sale price are read, and the comparison is done in
 * JavaScript - the same approach as getSaleFlagIds() in features/products, so
 * the dashboard count and the /products?flag=bad-sale-price list can never
 * disagree.
 */
async function countBadSalePrices(): Promise<number> {
  const rows = await db.product.findMany({
    where: { salePricePaise: { not: null } },
    select: { pricePaise: true, salePricePaise: true },
  });

  return rows.filter((row) => (row.salePricePaise ?? 0) >= row.pricePaise)
    .length;
}

/**
 * Alerts are computed, not stored, so they can never go stale. Each one names
 * a concrete thing that is wrong and links to where it is fixed.
 */
export async function getAlerts(): Promise<DashboardAlert[]> {
  const pendingHoursSetting = await db.setting.findUnique({
    where: { key: "alerts.pendingOrderHours" },
  });
  const pendingHours = Number(pendingHoursSetting?.value ?? 24);
  const staleBefore = new Date(Date.now() - pendingHours * 3600_000);

  const [
    stock,
    stalePending,
    pendingReviews,
    productsWithoutImages,
    emptyCategories,
    badSaleCount,
    draftProducts,
  ] = await Promise.all([
    getStockSnapshot(),
    db.order.count({
      where: { status: "PLACED", placedAt: { lt: staleBefore } },
    }),
    db.review.count({ where: { status: "PENDING" } }),
    db.product.count({
      where: { status: "PUBLISHED", images: { none: {} } },
    }),
    db.category.count({
      where: { parentId: { not: null }, products: { none: {} } },
    }),
    countBadSalePrices(),
    db.product.count({ where: { status: "DRAFT" } }),
  ]);

  const alerts: DashboardAlert[] = [];

  if (stock.outOfStock.length > 0) {
    alerts.push({
      id: "out-of-stock",
      severity: "critical",
      title: `${stock.outOfStock.length} variants are out of stock`,
      detail: stock.outOfStock
        .slice(0, 3)
        .map((row) => `${row.title} (${row.variantName})`)
        .join(", "),
      href: "/inventory?stock=OUT_OF_STOCK",
      actionLabel: "Restock",
    });
  }

  if (stalePending > 0) {
    alerts.push({
      id: "stale-orders",
      severity: "critical",
      title: `${stalePending} orders have been waiting over ${pendingHours}h`,
      detail: "Placed but never confirmed. COD orders age badly.",
      href: "/orders?status=PLACED",
      actionLabel: "Open orders",
    });
  }

  if (stock.lowStock.length > 0) {
    alerts.push({
      id: "low-stock",
      severity: "warning",
      title: `${stock.lowStock.length} variants are low on stock`,
      detail: stock.lowStock
        .slice(0, 3)
        .map((row) => `${row.title} (${row.variantName}) · ${row.available} left`)
        .join(", "),
      href: "/inventory?stock=LOW_STOCK",
      actionLabel: "Review",
    });
  }

  if (badSaleCount > 0) {
    alerts.push({
      id: "bad-sale-price",
      severity: "warning",
      title: `${badSaleCount} products have a sale price at or above list price`,
      detail: "These would show a discount badge with no actual discount.",
      href: "/products?flag=bad-sale-price",
      actionLabel: "Fix pricing",
    });
  }

  if (productsWithoutImages > 0) {
    alerts.push({
      id: "no-images",
      severity: "warning",
      title: `${productsWithoutImages} published products have no image`,
      detail: "They render as blank cards on the storefront.",
      href: "/products?flag=no-image",
      actionLabel: "Add images",
    });
  }

  if (pendingReviews > 0) {
    alerts.push({
      id: "pending-reviews",
      severity: "info",
      title: `${pendingReviews} reviews are awaiting moderation`,
      detail: "Nothing is shown on the storefront until it is approved.",
      href: "/content?tab=reviews",
      actionLabel: "Moderate",
    });
  }

  if (emptyCategories > 0) {
    alerts.push({
      id: "empty-categories",
      severity: "info",
      title: `${emptyCategories} categories contain no products`,
      detail: "They appear in navigation and lead to an empty page.",
      href: "/products?tab=categories",
      actionLabel: "Review",
    });
  }

  if (draftProducts > 0) {
    alerts.push({
      id: "drafts",
      severity: "info",
      title: `${draftProducts} products are still drafts`,
      detail: "Not visible to shoppers.",
      href: "/products?status=DRAFT",
      actionLabel: "Open drafts",
    });
  }

  return alerts;
}

export async function getCatalogSummary() {
  const [products, published, variants, categories, media, contentSections] =
    await Promise.all([
      db.product.count(),
      db.product.count({ where: { status: "PUBLISHED" } }),
      db.productVariant.count(),
      db.category.count({ where: { parentId: { not: null } } }),
      db.mediaAsset.count(),
      db.contentSection.count(),
    ]);

  return { products, published, variants, categories, media, contentSections };
}

/** True while the seeder's sample orders are still in the database. */
export async function hasDemoData(): Promise<boolean> {
  const flag = await db.setting.findUnique({
    where: { key: "demo.ordersSeeded" },
  });
  return flag?.value === "true";
}
