import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { istDayKey, startOfIstDay } from "@/lib/dates";
import { OPEN_PAYOUT_STATUSES, type LedgerEntryStatus, type LedgerEntryType, type SellerStatus } from "@/lib/enums";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";

import { activationReady, getSellerCommission, sellerPublicUrl } from "@/features/sellers/service";
import type {
  SellerActivityRow,
  SellerBankAccountRow,
  SellerCommissionInfo,
  SellerDetail,
  SellerDocumentRow,
  SellerEventRow,
  SellerLedgerRow,
  SellerOrderGroup,
  SellerOverview,
  SellerPayoutRow,
  SellerPerformance,
  SellerProductRow,
  SellerReviewRow,
} from "@/features/sellers/types";

/**
 * Read side of the seller DETAIL page. Each tab has its own loader so the
 * page fetches only what the open tab renders; every list is server-paginated
 * through ListParams from the URL.
 */

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

// ---------------------------------------------------------------------------
// Header + overview
// ---------------------------------------------------------------------------

export async function getSellerDetail(id: string): Promise<SellerDetail | null> {
  const seller = await db.seller.findUnique({
    where: { id },
    include: {
      logo: { select: { id: true, url: true, thumbnailUrl: true, alt: true, filename: true } },
      banner: { select: { id: true, url: true, thumbnailUrl: true, alt: true, filename: true } },
      approvedBy: { select: { name: true, email: true } },
      balance: true,
    },
  });
  if (!seller || seller.deletedAt) return null;

  const [verifiedDocuments, primaryBank, openPayout, publicUrl] = await Promise.all([
    db.sellerDocument.count({ where: { sellerId: id, status: "VERIFIED" } }),
    db.sellerBankAccount.count({ where: { sellerId: id, isPrimary: true } }),
    db.sellerPayout.findFirst({
      where: { sellerId: id, status: { in: [...OPEN_PAYOUT_STATUSES] } },
      select: { id: true, payoutNumber: true, status: true, netPaise: true },
    }),
    sellerPublicUrl(undefined, seller.slug),
  ]);

  return {
    id: seller.id,
    slug: seller.slug,
    displayName: seller.displayName,
    legalName: seller.legalName,
    ownerName: seller.ownerName,
    email: seller.email,
    phone: seller.phone,
    status: seller.status as SellerStatus,
    description: seller.description,
    addressLine1: seller.addressLine1,
    addressLine2: seller.addressLine2,
    city: seller.city,
    state: seller.state,
    pinCode: seller.pinCode,
    country: seller.country,
    gstin: seller.gstin,
    pan: seller.pan,
    logo: seller.logo,
    banner: seller.banner,
    ratingAvg: seller.ratingAvg,
    reviewCount: seller.reviewCount,
    productCount: seller.productCount,
    publishedProductCount: seller.publishedProductCount,
    orderItemCount: seller.orderItemCount,
    grossSalesPaise: seller.grossSalesPaise,
    approvedAt: iso(seller.approvedAt),
    approvedBy: seller.approvedBy?.name ?? seller.approvedBy?.email ?? null,
    suspendedAt: iso(seller.suspendedAt),
    suspensionReason: seller.suspensionReason,
    rejectedAt: iso(seller.rejectedAt),
    rejectionReason: seller.rejectionReason,
    lastActiveAt: iso(seller.lastActiveAt),
    hasPassword: Boolean(seller.passwordHash),
    createdAt: seller.createdAt.toISOString(),
    updatedAt: seller.updatedAt.toISOString(),
    publicUrl,
    activation: { verifiedDocuments, hasPrimaryBank: primaryBank > 0, ready: verifiedDocuments > 0 && primaryBank > 0 },
    balance: {
      pendingPaise: seller.balance?.pendingPaise ?? 0,
      availablePaise: seller.balance?.availablePaise ?? 0,
      scheduledPaise: seller.balance?.scheduledPaise ?? 0,
      paidPaise: seller.balance?.paidPaise ?? 0,
    },
    openPayout: openPayout
      ? { id: openPayout.id, number: openPayout.payoutNumber, status: openPayout.status, netPaise: openPayout.netPaise }
      : null,
  };
}

function eventRow(event: { id: string; fromStatus: string | null; toStatus: string | null; message: string; createdAt: Date; actor: { name: string | null; email: string } | null }): SellerEventRow {
  return {
    id: event.id,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    message: event.message,
    actor: event.actor?.name ?? event.actor?.email ?? null,
    createdAt: event.createdAt.toISOString(),
  };
}

export async function getSellerOverview(id: string): Promise<SellerOverview> {
  const [items, events, reviewGroups, returns] = await Promise.all([
    db.orderItem.findMany({
      where: { sellerId: id },
      orderBy: [{ order: { placedAt: "desc" } }, { id: "desc" }],
      take: 8,
      select: {
        id: true,
        orderId: true,
        titleSnapshot: true,
        variantSnapshot: true,
        quantity: true,
        lineTotalPaise: true,
        status: true,
        order: { select: { orderNumber: true, placedAt: true, status: true } },
      },
    }),
    db.sellerEvent.findMany({
      where: { sellerId: id },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { actor: { select: { name: true, email: true } } },
    }),
    db.review.groupBy({ by: ["status"], where: { OR: [{ sellerId: id }, { product: { sellerId: id } }] }, _count: { _all: true } }),
    db.returnRequest.count({ where: { sellerId: id } }),
  ]);
  return {
    recentItems: items.map((item) => ({
      id: item.id,
      orderId: item.orderId,
      orderNumber: item.order.orderNumber,
      placedAt: item.order.placedAt.toISOString(),
      title: item.titleSnapshot,
      variant: item.variantSnapshot,
      quantity: item.quantity,
      lineTotalPaise: item.lineTotalPaise,
      status: item.status,
      orderStatus: item.order.status,
    })),
    recentEvents: events.map(eventRow),
    reviews: {
      approved: reviewGroups.find((group) => group.status === "APPROVED")?._count._all ?? 0,
      pending: reviewGroups.find((group) => group.status === "PENDING")?._count._all ?? 0,
    },
    returns,
  };
}

// ---------------------------------------------------------------------------
// Documents, bank accounts, commission
// ---------------------------------------------------------------------------

export async function listSellerDocuments(id: string): Promise<SellerDocumentRow[]> {
  const rows = await db.sellerDocument.findMany({
    where: { sellerId: id },
    orderBy: [{ createdAt: "desc" }],
    include: {
      media: { select: { filename: true, mimeType: true, sizeBytes: true } },
      reviewedBy: { select: { name: true, email: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    label: row.label,
    status: row.status,
    note: row.note,
    mediaId: row.mediaId,
    fileUrl: row.mediaId ? `/api/admin/media/${row.mediaId}/file` : row.fileUrl,
    filename: row.media?.filename ?? null,
    mimeType: row.media?.mimeType ?? null,
    sizeBytes: row.media?.sizeBytes ?? null,
    uploadedAt: row.createdAt.toISOString(),
    reviewedAt: iso(row.reviewedAt),
    reviewedBy: row.reviewedBy?.name ?? row.reviewedBy?.email ?? null,
  }));
}

/** Masked list: the encrypted column is never selected here. */
export async function listSellerBankAccounts(id: string): Promise<SellerBankAccountRow[]> {
  const rows = await db.sellerBankAccount.findMany({
    where: { sellerId: id },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      accountHolder: true,
      bankName: true,
      accountNumberLast4: true,
      ifsc: true,
      upiId: true,
      isPrimary: true,
      isVerified: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { payouts: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    accountHolder: row.accountHolder,
    bankName: row.bankName,
    accountNumberLast4: row.accountNumberLast4,
    ifsc: row.ifsc,
    upiId: row.upiId,
    isPrimary: row.isPrimary,
    isVerified: row.isVerified,
    payoutCount: row._count.payouts,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getSellerCommissionInfo(id: string): Promise<SellerCommissionInfo> {
  const [view, global] = await Promise.all([
    getSellerCommission(id),
    db.commissionRule.findUnique({ where: { targetKey: "GLOBAL" }, select: { rateBps: true, fixedPaise: true } }),
  ]);
  return {
    resolved: view.resolved,
    override: view.override ? { ...view.override, updatedAt: view.override.updatedAt.toISOString() } : null,
    global,
  };
}

export { activationReady };

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export async function listSellerProducts(id: string, params: ListParams): Promise<{ rows: SellerProductRow[]; meta: PageMeta }> {
  const where: Prisma.ProductWhereInput = {
    sellerId: id,
    deletedAt: null,
    ...(params.q ? { title: { contains: params.q, mode: "insensitive" } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: params.skip,
      take: params.pageSize,
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        pricePaise: true,
        effectivePricePaise: true,
        orderCount: true,
        ratingAvg: true,
        reviewCount: true,
        updatedAt: true,
        category: { select: { name: true } },
        images: { where: { isPrimary: true }, take: 1, select: { media: { select: { thumbnailUrl: true, url: true } } } },
        _count: { select: { variants: true } },
      },
    }),
    db.product.count({ where }),
  ]);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      status: row.status,
      pricePaise: row.pricePaise,
      effectivePricePaise: row.effectivePricePaise || row.pricePaise,
      imageUrl: row.images[0]?.media.thumbnailUrl ?? row.images[0]?.media.url ?? null,
      categoryName: row.category?.name ?? null,
      orderCount: row.orderCount,
      ratingAvg: row.ratingAvg,
      reviewCount: row.reviewCount,
      variantCount: row._count.variants,
      updatedAt: row.updatedAt.toISOString(),
    })),
    meta: buildPageMeta(total, params),
  };
}

// ---------------------------------------------------------------------------
// Orders (grouped by order, seller's lines only)
// ---------------------------------------------------------------------------

export async function listSellerOrders(id: string, params: ListParams): Promise<{ groups: SellerOrderGroup[]; meta: PageMeta }> {
  const where: Prisma.OrderWhereInput = {
    items: { some: { sellerId: id } },
    ...(params.q ? { orderNumber: { contains: params.q, mode: "insensitive" } } : {}),
  };
  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: [{ placedAt: "desc" }, { id: "desc" }],
      skip: params.skip,
      take: params.pageSize,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        placedAt: true,
        items: {
          where: { sellerId: id },
          select: {
            id: true,
            titleSnapshot: true,
            variantSnapshot: true,
            quantity: true,
            lineTotalPaise: true,
            sellerFundedDiscountPaise: true,
            unitPricePaise: true,
            customizationPaise: true,
            commissionPaise: true,
            sellerPayablePaise: true,
            status: true,
          },
        },
      },
    }),
    db.order.count({ where }),
  ]);

  return {
    groups: orders.map((order) => {
      const items = order.items.map((item) => ({
        id: item.id,
        title: item.titleSnapshot,
        variant: item.variantSnapshot,
        quantity: item.quantity,
        lineTotalPaise: item.lineTotalPaise,
        // B3: sellerBaseGross = lineGross − seller-funded discount.
        sellerGrossPaise: (item.unitPricePaise + item.customizationPaise) * item.quantity - item.sellerFundedDiscountPaise,
        commissionPaise: item.commissionPaise,
        sellerPayablePaise: item.sellerPayablePaise,
        status: item.status,
      }));
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        placedAt: order.placedAt.toISOString(),
        items,
        totals: {
          grossPaise: items.reduce((sum, item) => sum + item.sellerGrossPaise, 0),
          commissionPaise: items.reduce((sum, item) => sum + item.commissionPaise, 0),
          payablePaise: items.reduce((sum, item) => sum + item.sellerPayablePaise, 0),
        },
      };
    }),
    meta: buildPageMeta(total, params),
  };
}

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------

export async function listSellerLedger(
  id: string,
  params: ListParams,
  filters: { type?: LedgerEntryType; status?: LedgerEntryStatus },
): Promise<{ rows: SellerLedgerRow[]; meta: PageMeta }> {
  const where: Prisma.SellerLedgerEntryWhereInput = {
    sellerId: id,
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(params.q ? { OR: [{ description: { contains: params.q, mode: "insensitive" } }, { order: { orderNumber: { contains: params.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.sellerLedgerEntry.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: params.skip,
      take: params.pageSize,
      include: { order: { select: { orderNumber: true } }, payout: { select: { payoutNumber: true } } },
    }),
    db.sellerLedgerEntry.count({ where }),
  ]);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      type: row.type as LedgerEntryType,
      status: row.status as LedgerEntryStatus,
      amountPaise: row.amountPaise,
      description: row.description,
      orderNumber: row.order?.orderNumber ?? null,
      orderId: row.orderId,
      payoutNumber: row.payout?.payoutNumber ?? null,
      payoutId: row.payoutId,
      availableAt: iso(row.availableAt),
      createdAt: row.createdAt.toISOString(),
    })),
    meta: buildPageMeta(total, params),
  };
}

export async function listSellerPayouts(id: string, take = 10): Promise<SellerPayoutRow[]> {
  const rows = await db.sellerPayout.findMany({ where: { sellerId: id }, orderBy: [{ createdAt: "desc" }], take });
  return rows.map((row) => ({
    id: row.id,
    payoutNumber: row.payoutNumber,
    status: row.status,
    periodFrom: row.periodFrom.toISOString(),
    periodTo: row.periodTo.toISOString(),
    netPaise: row.netPaise,
    grossSalesPaise: row.grossSalesPaise,
    commissionPaise: row.commissionPaise,
    createdAt: row.createdAt.toISOString(),
    paidAt: iso(row.paidAt),
  }));
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export async function listSellerReviews(id: string, params: ListParams): Promise<{ rows: SellerReviewRow[]; meta: PageMeta }> {
  const where: Prisma.ReviewWhereInput = { OR: [{ sellerId: id }, { product: { sellerId: id } }] };
  const [rows, total] = await Promise.all([
    db.review.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: params.skip,
      take: params.pageSize,
      select: {
        id: true,
        productId: true,
        authorName: true,
        rating: true,
        title: true,
        body: true,
        status: true,
        createdAt: true,
        product: { select: { title: true } },
      },
    }),
    db.review.count({ where }),
  ]);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      productTitle: row.product?.title ?? null,
      authorName: row.authorName,
      rating: row.rating,
      title: row.title,
      body: row.body,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    })),
    meta: buildPageMeta(total, params),
  };
}

// ---------------------------------------------------------------------------
// Performance (last 12 weeks)
// ---------------------------------------------------------------------------

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Monday-anchored IST week start for bucketing. */
function weekStart(date: Date): Date {
  const day = startOfIstDay(date);
  const shifted = new Date(day.getTime() + 5.5 * 60 * 60 * 1000);
  const weekday = (shifted.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(day.getTime() - weekday * 24 * 60 * 60 * 1000);
}

export async function getSellerPerformance(id: string): Promise<SellerPerformance> {
  const now = new Date();
  const firstWeek = weekStart(new Date(now.getTime() - 11 * WEEK_MS));

  const [seller, items, totals, cancelled, returns, delivered] = await Promise.all([
    db.seller.findUnique({ where: { id }, select: { ratingAvg: true, reviewCount: true } }),
    db.orderItem.findMany({
      where: { sellerId: id, status: { not: "CANCELLED" }, order: { placedAt: { gte: firstWeek } } },
      select: { productId: true, titleSnapshot: true, quantity: true, lineTotalPaise: true, order: { select: { placedAt: true } } },
    }),
    db.orderItem.count({ where: { sellerId: id } }),
    db.orderItem.count({ where: { sellerId: id, status: "CANCELLED" } }),
    db.returnRequest.count({ where: { sellerId: id } }),
    db.orderItem.findMany({
      where: { sellerId: id, deliveredAt: { not: null } },
      select: { deliveredAt: true, order: { select: { placedAt: true } } },
      take: 500,
      orderBy: { deliveredAt: "desc" },
    }),
  ]);

  const buckets = new Map<string, { grossPaise: number; items: number }>();
  for (let index = 0; index < 12; index += 1) {
    buckets.set(istDayKey(new Date(firstWeek.getTime() + index * WEEK_MS)), { grossPaise: 0, items: 0 });
  }
  const topMap = new Map<string, { label: string; value: number }>();
  for (const item of items) {
    const key = istDayKey(weekStart(item.order.placedAt));
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.grossPaise += item.lineTotalPaise;
      bucket.items += item.quantity;
    }
    const productKey = item.productId ?? item.titleSnapshot;
    const top = topMap.get(productKey) ?? { label: item.titleSnapshot, value: 0 };
    top.value += item.lineTotalPaise;
    topMap.set(productKey, top);
  }

  const fulfilmentDays = delivered
    .map((row) => (row.deliveredAt!.getTime() - row.order.placedAt.getTime()) / (24 * 60 * 60 * 1000))
    .filter((days) => Number.isFinite(days) && days >= 0);

  return {
    weekly: [...buckets.entries()].map(([date, bucket]) => ({ date, ...bucket })),
    topProducts: [...topMap.values()].sort((a, b) => b.value - a.value).slice(0, 8),
    kpis: {
      ratingAvg: seller?.ratingAvg ?? 0,
      reviewCount: seller?.reviewCount ?? 0,
      returnRatePct: totals > 0 ? (returns / totals) * 100 : 0,
      cancellationRatePct: totals > 0 ? (cancelled / totals) * 100 : 0,
      avgFulfilmentDays:
        fulfilmentDays.length > 0 ? fulfilmentDays.reduce((sum, days) => sum + days, 0) / fulfilmentDays.length : null,
      itemsInWindow: items.reduce((sum, item) => sum + item.quantity, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Activity (SellerEvent timeline + AuditLog)
// ---------------------------------------------------------------------------

export async function listSellerActivity(id: string, take = 100): Promise<SellerActivityRow[]> {
  const [events, audits] = await Promise.all([
    db.sellerEvent.findMany({
      where: { sellerId: id },
      orderBy: { createdAt: "desc" },
      take,
      include: { actor: { select: { name: true, email: true } } },
    }),
    db.auditLog.findMany({
      where: { entityType: "Seller", entityId: id },
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, action: true, summary: true, actorEmail: true, createdAt: true, actor: { select: { name: true } } },
    }),
  ]);

  const rows: SellerActivityRow[] = [
    ...events.map((event) => ({
      id: `event:${event.id}`,
      kind: "event" as const,
      title: event.toStatus && event.fromStatus !== event.toStatus ? `${event.fromStatus ?? "New"} → ${event.toStatus}` : event.message,
      description: event.toStatus && event.fromStatus !== event.toStatus ? event.message : null,
      actor: event.actor?.name ?? event.actor?.email ?? "Seller / system",
      tone: toneForStatus(event.toStatus),
      at: event.createdAt.toISOString(),
    })),
    ...audits.map((audit) => ({
      id: `audit:${audit.id}`,
      kind: "audit" as const,
      title: audit.action,
      description: audit.summary,
      actor: audit.actor?.name ?? audit.actorEmail,
      tone: "neutral" as const,
      at: audit.createdAt.toISOString(),
    })),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, take);
}

function toneForStatus(status: string | null): SellerActivityRow["tone"] {
  switch (status) {
    case "ACTIVE":
    case "APPROVED":
      return "success";
    case "SUSPENDED":
    case "REJECTED":
      return "danger";
    case "UNDER_REVIEW":
      return "info";
    case "PENDING":
      return "warning";
    default:
      return "neutral";
  }
}
