import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";
import { OPEN_RETURN_STATUSES, RETURN_REQUEST_STATUSES, type ReturnRequestStatus } from "@/lib/enums";
import { resolveDateRangeParams } from "@/components/shared/date-range";
import { readSettingBoolean, readSettingNumber } from "@/features/finance/settings-reader";
import { refundCapFor } from "@/features/refunds/service";

import { CLOSED_RETURN_STATUSES, type ReturnListFilters, type ReturnSort } from "./schemas";
import type { ReturnDetail, ReturnListRow } from "./types";

/**
 * Read side for RETURNS (Server Components + REST GETs).
 *
 * The list is one page-sized query with the order, the customer, the line
 * snapshot and the seller joined in: an RMA is only meaningful next to the
 * thing that came back, so a table that made the operator open every row to
 * see the product would be a worse screen than a spreadsheet.
 */

export function resolveReturnRange(filters: ReturnListFilters, now = new Date()): { from: Date; to: Date } | null {
  if (!filters.range && !filters.from && !filters.to) return null;
  const params = new URLSearchParams();
  if (filters.range) params.set("range", filters.range);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const resolved = resolveDateRangeParams(params, "30d", now);
  return { from: resolved.from, to: resolved.to };
}

export function buildReturnWhere(
  filters: ReturnListFilters,
  q: string,
  options: { includeStatus?: boolean } = {},
): Prisma.ReturnRequestWhereInput {
  const includeStatus = options.includeStatus ?? true;
  const where: Prisma.ReturnRequestWhereInput = {};
  const and: Prisma.ReturnRequestWhereInput[] = [];

  if (includeStatus) {
    // An explicit status wins over the open/closed tab: a bookmarked
    // "?status=QC_FAILED" must not be widened by whichever tab is default.
    if (filters.status) where.status = filters.status;
    else if (filters.state === "open") where.status = { in: [...OPEN_RETURN_STATUSES] };
    else if (filters.state === "closed") where.status = { in: [...CLOSED_RETURN_STATUSES] };
  }

  if (filters.reason) where.reason = filters.reason;
  if (filters.resolution) {
    and.push({ OR: [{ resolution: filters.resolution }, { AND: [{ resolution: null }, { requestedResolution: filters.resolution }] }] });
  }
  if (filters.sellerId) where.sellerId = filters.sellerId;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.orderId) {
    and.push({ OR: [{ orderId: filters.orderId }, { order: { is: { orderNumber: { equals: filters.orderId, mode: "insensitive" } } } }] });
  }

  const range = resolveReturnRange(filters);
  if (range) where.requestedAt = { gte: range.from, lte: range.to };

  const term = q.trim();
  if (term) {
    and.push({
      OR: [
        { rmaNumber: { contains: term, mode: "insensitive" } },
        { order: { is: { orderNumber: { contains: term, mode: "insensitive" } } } },
        { order: { is: { guestEmail: { contains: term, mode: "insensitive" } } } },
        { customer: { is: { fullName: { contains: term, mode: "insensitive" } } } },
        { customer: { is: { email: { contains: term, mode: "insensitive" } } } },
        { orderItem: { is: { titleSnapshot: { contains: term, mode: "insensitive" } } } },
        { pickupTrackingNumber: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  if (and.length) where.AND = and;
  return where;
}

const SORT_COLUMN: Record<ReturnSort, (order: "asc" | "desc") => Prisma.ReturnRequestOrderByWithRelationInput> = {
  requested: (order) => ({ requestedAt: order }),
  rma: (order) => ({ rmaNumber: order }),
  status: (order) => ({ status: order }),
  customer: (order) => ({ customer: { fullName: order } }),
  order: (order) => ({ order: { orderNumber: order } }),
  updated: (order) => ({ updatedAt: order }),
};

const LIST_SELECT = {
  id: true,
  rmaNumber: true,
  status: true,
  reason: true,
  requestedResolution: true,
  resolution: true,
  quantity: true,
  requestedAt: true,
  updatedAt: true,
  order: { select: { id: true, orderNumber: true, guestEmail: true } },
  customer: { select: { id: true, fullName: true, email: true } },
  seller: { select: { id: true, displayName: true } },
  orderItem: { select: { id: true, titleSnapshot: true, variantSnapshot: true, imageUrl: true } },
  handledBy: { select: { id: true, name: true, email: true } },
  refund: { select: { id: true, refundNumber: true, status: true, amountPaise: true } },
} satisfies Prisma.ReturnRequestSelect;

export async function listReturns(
  params: ListParams & { sort: ReturnSort },
  filters: ReturnListFilters,
): Promise<{ rows: ReturnListRow[]; meta: PageMeta; total: number }> {
  const where = buildReturnWhere(filters, params.q);
  const [total, rows] = await Promise.all([
    db.returnRequest.count({ where }),
    db.returnRequest.findMany({
      where,
      orderBy: SORT_COLUMN[params.sort](params.order),
      skip: params.skip,
      take: params.pageSize,
      select: LIST_SELECT,
    }),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      rmaNumber: row.rmaNumber,
      status: row.status,
      reason: row.reason,
      requestedResolution: row.requestedResolution,
      resolution: row.resolution,
      quantity: row.quantity,
      requestedAt: row.requestedAt,
      updatedAt: row.updatedAt,
      orderId: row.order.id,
      orderNumber: row.order.orderNumber,
      customerId: row.customer?.id ?? null,
      customerName: row.customer?.fullName ?? row.order.guestEmail ?? "Guest",
      customerEmail: row.customer?.email ?? row.order.guestEmail ?? "",
      sellerId: row.seller?.id ?? null,
      sellerName: row.seller?.displayName ?? "Platform",
      itemTitle: row.orderItem.titleSnapshot,
      itemVariant: row.orderItem.variantSnapshot,
      itemImageUrl: row.orderItem.imageUrl,
      handledBy: row.handledBy?.name ?? row.handledBy?.email ?? null,
      refundNumber: row.refund?.refundNumber ?? null,
      refundId: row.refund?.id ?? null,
      refundStatus: row.refund?.status ?? null,
      refundAmountPaise: row.refund?.amountPaise ?? null,
    })),
    meta: buildPageMeta(total, params),
    total,
  };
}

export type ReturnStatusCounts = Record<ReturnRequestStatus, number> & { all: number; open: number; closed: number };

/** Tab counts honour every filter EXCEPT the status/state tab itself. */
export async function returnStatusCounts(filters: ReturnListFilters, q: string): Promise<ReturnStatusCounts> {
  const where = buildReturnWhere(filters, q, { includeStatus: false });
  const grouped = await db.returnRequest.groupBy({ by: ["status"], where, _count: { _all: true } });

  const counts = Object.fromEntries(RETURN_REQUEST_STATUSES.map((status) => [status, 0])) as Record<ReturnRequestStatus, number>;
  let all = 0;
  for (const row of grouped) {
    const status = row.status as ReturnRequestStatus;
    if (status in counts) counts[status] = row._count._all;
    all += row._count._all;
  }
  const open = OPEN_RETURN_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  return { ...counts, all, open, closed: all - open };
}

export type ReturnKpis = {
  open: number;
  awaitingQc: number;
  refundsPending: number;
  /** Returned units ÷ delivered units over the last 30 days, in percent. */
  returnRatePct: number;
};

export async function returnKpis(now = new Date()): Promise<ReturnKpis> {
  const from = new Date(now.getTime() - 30 * 86_400_000);
  const [open, awaitingQc, refundsPending, returnedUnits, deliveredUnits] = await Promise.all([
    db.returnRequest.count({ where: { status: { in: [...OPEN_RETURN_STATUSES] } } }),
    db.returnRequest.count({ where: { status: "RECEIVED" } }),
    db.refund.count({ where: { status: { in: ["PENDING", "APPROVED", "PROCESSING"] }, returnRequestId: { not: null } } }),
    db.returnRequest.aggregate({ where: { requestedAt: { gte: from } }, _sum: { quantity: true } }),
    db.orderItem.aggregate({ where: { deliveredAt: { gte: from } }, _sum: { quantity: true } }),
  ]);

  const returned = returnedUnits._sum.quantity ?? 0;
  const delivered = deliveredUnits._sum.quantity ?? 0;
  return {
    open,
    awaitingQc,
    refundsPending,
    returnRatePct: delivered > 0 ? Math.round((returned / delivered) * 1000) / 10 : 0,
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export async function getReturnDetail(id: string): Promise<ReturnDetail | null> {
  const rma = await db.returnRequest.findUnique({
    where: { id },
    select: {
      id: true,
      rmaNumber: true,
      status: true,
      reason: true,
      reasonDetail: true,
      requestedResolution: true,
      resolution: true,
      qcDisposition: true,
      qcNote: true,
      rejectionReason: true,
      quantity: true,
      imageUrls: true,
      pickupScheduledAt: true,
      pickupTrackingNumber: true,
      receivedAt: true,
      requestedAt: true,
      resolvedAt: true,
      createdAt: true,
      updatedAt: true,
      replacementShipmentId: true,
      pickupPartner: { select: { id: true, name: true } },
      handledBy: { select: { id: true, name: true, email: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentMethod: true,
          paymentStatus: true,
          totalPaise: true,
          shippingPaise: true,
          placedAt: true,
          guestEmail: true,
          customer: { select: { id: true, fullName: true, email: true, phone: true } },
        },
      },
      orderItem: {
        select: {
          id: true,
          titleSnapshot: true,
          variantSnapshot: true,
          skuSnapshot: true,
          imageUrl: true,
          quantity: true,
          returnedQty: true,
          refundedPaise: true,
          lineTotalPaise: true,
          unitPricePaise: true,
          status: true,
          deliveredAt: true,
          customization: true,
          productId: true,
        },
      },
      seller: { select: { id: true, displayName: true, email: true } },
      refund: {
        select: { id: true, refundNumber: true, amountPaise: true, status: true, method: true, provider: true, completedAt: true, createdAt: true },
      },
      replacementShipment: { select: { id: true, shipmentNumber: true, status: true, trackingNumber: true, carrierName: true } },
      events: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          message: true,
          fromStatus: true,
          toStatus: true,
          isInternal: true,
          createdAt: true,
          actor: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (!rma) return null;

  const customization = Array.isArray(rma.orderItem.customization)
    ? (rma.orderItem.customization as unknown[]).flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const row = entry as { label?: unknown; value?: unknown; priceDeltaPaise?: unknown };
        if (typeof row.label !== "string") return [];
        return [
          {
            label: row.label,
            value: typeof row.value === "string" ? row.value : "",
            priceDeltaPaise: typeof row.priceDeltaPaise === "number" ? row.priceDeltaPaise : 0,
          },
        ];
      })
    : [];

  return {
    id: rma.id,
    rmaNumber: rma.rmaNumber,
    status: rma.status,
    reason: rma.reason,
    reasonDetail: rma.reasonDetail,
    requestedResolution: rma.requestedResolution,
    resolution: rma.resolution,
    qcDisposition: rma.qcDisposition,
    qcNote: rma.qcNote,
    rejectionReason: rma.rejectionReason,
    quantity: rma.quantity,
    imageUrls: rma.imageUrls,
    pickupPartnerId: rma.pickupPartner?.id ?? null,
    pickupPartnerName: rma.pickupPartner?.name ?? null,
    pickupScheduledAt: rma.pickupScheduledAt,
    pickupTrackingNumber: rma.pickupTrackingNumber,
    receivedAt: rma.receivedAt,
    requestedAt: rma.requestedAt,
    resolvedAt: rma.resolvedAt,
    updatedAt: rma.updatedAt,
    handledBy: rma.handledBy?.name ?? rma.handledBy?.email ?? null,
    order: {
      id: rma.order.id,
      orderNumber: rma.order.orderNumber,
      status: rma.order.status,
      paymentMethod: rma.order.paymentMethod,
      paymentStatus: rma.order.paymentStatus,
      totalPaise: rma.order.totalPaise,
      shippingPaise: rma.order.shippingPaise,
      placedAt: rma.order.placedAt,
    },
    customer: {
      id: rma.order.customer?.id ?? null,
      name: rma.order.customer?.fullName ?? rma.order.guestEmail ?? "Guest",
      email: rma.order.customer?.email ?? rma.order.guestEmail ?? "",
      phone: rma.order.customer?.phone ?? null,
    },
    item: {
      id: rma.orderItem.id,
      productId: rma.orderItem.productId,
      title: rma.orderItem.titleSnapshot,
      variant: rma.orderItem.variantSnapshot,
      sku: rma.orderItem.skuSnapshot,
      imageUrl: rma.orderItem.imageUrl,
      quantity: rma.orderItem.quantity,
      returnedQty: rma.orderItem.returnedQty,
      refundedPaise: rma.orderItem.refundedPaise,
      lineTotalPaise: rma.orderItem.lineTotalPaise,
      unitPricePaise: rma.orderItem.unitPricePaise,
      status: rma.orderItem.status,
      deliveredAt: rma.orderItem.deliveredAt,
      customization,
    },
    seller: rma.seller ? { id: rma.seller.id, name: rma.seller.displayName, email: rma.seller.email } : null,
    refund: rma.refund
      ? {
          id: rma.refund.id,
          refundNumber: rma.refund.refundNumber,
          amountPaise: rma.refund.amountPaise,
          status: rma.refund.status,
          method: rma.refund.method,
          provider: rma.refund.provider,
          createdAt: rma.refund.createdAt,
          completedAt: rma.refund.completedAt,
        }
      : null,
    replacementShipment: rma.replacementShipment
      ? {
          id: rma.replacementShipment.id,
          shipmentNumber: rma.replacementShipment.shipmentNumber,
          status: rma.replacementShipment.status,
          trackingNumber: rma.replacementShipment.trackingNumber,
          carrierName: rma.replacementShipment.carrierName,
        }
      : null,
    events: rma.events.map((event) => ({
      id: event.id,
      message: event.message,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      isInternal: event.isInternal,
      createdAt: event.createdAt,
      actor: event.actor?.name ?? event.actor?.email ?? null,
    })),
  };
}

export type ReturnActivityRow = {
  id: string;
  action: string;
  summary: string;
  actorEmail: string;
  createdAt: Date;
};

/** The audit trail for one RMA and the refund it produced (D13). */
export async function listReturnActivity(returnRequestId: string, refundId: string | null, take = 40): Promise<ReturnActivityRow[]> {
  const rows = await db.auditLog.findMany({
    where: {
      OR: [
        { entityType: "ReturnRequest", entityId: returnRequestId },
        ...(refundId ? [{ entityType: "Refund", entityId: refundId }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, action: true, summary: true, actorEmail: true, createdAt: true },
  });
  return rows;
}

/** Pickup partners for the "schedule pickup" dialog. */
export async function listPickupPartners(): Promise<Array<{ id: string; name: string; code: string }>> {
  return db.shippingPartner.findMany({
    where: { isActive: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, code: true },
  });
}

export async function getSellerRef(id: string | undefined): Promise<{ id: string; title: string; subtitle?: string } | null> {
  if (!id) return null;
  const row = await db.seller.findUnique({ where: { id }, select: { id: true, displayName: true, city: true } });
  return row ? { id: row.id, title: row.displayName, subtitle: row.city ?? undefined } : null;
}

export async function getCustomerRef(id: string | undefined): Promise<{ id: string; title: string; subtitle?: string } | null> {
  if (!id) return null;
  const row = await db.customer.findUnique({ where: { id }, select: { id: true, fullName: true, email: true } });
  return row ? { id: row.id, title: row.fullName ?? row.email, subtitle: row.email } : null;
}

/** One page of rows for the export stream (§11.28). */
export async function pageReturnsForExport(
  filters: ReturnListFilters,
  q: string,
  skip: number,
  take: number,
): Promise<Array<Record<string, unknown>>> {
  const rows = await db.returnRequest.findMany({
    where: buildReturnWhere(filters, q),
    orderBy: { requestedAt: "desc" },
    skip,
    take,
    select: LIST_SELECT,
  });
  return rows.map((row) => ({
    rmaNumber: row.rmaNumber,
    orderNumber: row.order.orderNumber,
    customer: row.customer?.fullName ?? row.order.guestEmail ?? "Guest",
    email: row.customer?.email ?? row.order.guestEmail ?? "",
    item: row.orderItem.titleSnapshot,
    variant: row.orderItem.variantSnapshot ?? "",
    quantity: row.quantity,
    seller: row.seller?.displayName ?? "Platform",
    reason: row.reason,
    requestedResolution: row.requestedResolution ?? "",
    resolution: row.resolution ?? "",
    status: row.status,
    requestedAt: row.requestedAt,
    updatedAt: row.updatedAt,
    handledBy: row.handledBy?.name ?? row.handledBy?.email ?? "",
    refundNumber: row.refund?.refundNumber ?? "",
    refundAmountPaise: row.refund?.amountPaise ?? 0,
  }));
}

/**
 * The refund ceiling for one RMA, for the "initiate refund" dialog. Computed
 * with the same function the service uses, so the number the operator is shown
 * is the number the server will enforce (B6).
 */
export async function getReturnRefundCap(returnRequestId: string, orderId: string): Promise<{ capPaise: number; notes: string[] }> {
  const cap = await refundCapFor(db, { orderId, returnRequestId });
  return { capPaise: cap.capPaise, notes: cap.notes };
}

/** The two returns.* settings the detail screen explains to the operator (B5). */
export async function getReturnPolicySettings(): Promise<{ pickupFeePaise: number; customerPaysPickup: boolean; windowDays: number }> {
  const [pickupFeePaise, customerPaysPickup, windowDays] = await Promise.all([
    readSettingNumber(db, "returns.pickup_fee_paise"),
    readSettingBoolean(db, "returns.customer_pays_pickup"),
    readSettingNumber(db, "returns.window_days"),
  ]);
  return { pickupFeePaise, customerPaysPickup, windowDays };
}
