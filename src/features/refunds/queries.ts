import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";
import { COUNTED_REFUND_STATUSES, REFUND_STATUSES, type RefundStatus } from "@/lib/enums";
import { startOfIstDay } from "@/lib/dates";
import { resolveDateRangeParams } from "@/components/shared/date-range";
import { refundableRemaining } from "@/features/finance/service";

import { isGatewayProvider, type RefundListFilters, type RefundSort } from "./schemas";
import type { RefundActivityRow, RefundDetail, RefundListRow, RefundOrderOption } from "./types";

/**
 * Read side for REFUNDS. Money questions are asked of this file and nowhere
 * else in the UI, so a screen can never invent its own definition of
 * "refunded": the cap comes from `refundableRemaining` (the same helper the
 * service enforces) and the totals come from the Refund rows themselves.
 */

export function resolveRefundRange(filters: RefundListFilters, now = new Date()): { from: Date; to: Date } | null {
  if (!filters.range && !filters.from && !filters.to) return null;
  const params = new URLSearchParams();
  if (filters.range) params.set("range", filters.range);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const resolved = resolveDateRangeParams(params, "30d", now);
  return { from: resolved.from, to: resolved.to };
}

export function buildRefundWhere(
  filters: RefundListFilters,
  q: string,
  options: { includeStatus?: boolean } = {},
): Prisma.RefundWhereInput {
  const where: Prisma.RefundWhereInput = {};
  const and: Prisma.RefundWhereInput[] = [];

  if ((options.includeStatus ?? true) && filters.status) where.status = filters.status;
  if (filters.method) where.method = filters.method;
  if (filters.provider) where.provider = filters.provider;
  // The URL may carry an order id (from a link) or a human order number
  // (typed into the create-refund dialog); both must narrow the list.
  if (filters.orderId) {
    and.push({ OR: [{ orderId: filters.orderId }, { order: { is: { orderNumber: { equals: filters.orderId, mode: "insensitive" } } } }] });
  }
  if (filters.customerId) where.order = { is: { customerId: filters.customerId } };

  const range = resolveRefundRange(filters);
  if (range) where.createdAt = { gte: range.from, lte: range.to };

  const term = q.trim();
  if (term) {
    and.push({
      OR: [
        { refundNumber: { contains: term, mode: "insensitive" } },
        { providerRefundId: { contains: term, mode: "insensitive" } },
        { order: { is: { orderNumber: { contains: term, mode: "insensitive" } } } },
        { order: { is: { guestEmail: { contains: term, mode: "insensitive" } } } },
        { order: { is: { customer: { is: { fullName: { contains: term, mode: "insensitive" } } } } } },
        { order: { is: { customer: { is: { email: { contains: term, mode: "insensitive" } } } } } },
        { returnRequest: { is: { rmaNumber: { contains: term, mode: "insensitive" } } } },
      ],
    });
  }

  if (and.length) where.AND = and;
  return where;
}

const SORT_COLUMN: Record<RefundSort, (order: "asc" | "desc") => Prisma.RefundOrderByWithRelationInput> = {
  created: (order) => ({ createdAt: order }),
  number: (order) => ({ refundNumber: order }),
  amount: (order) => ({ amountPaise: order }),
  status: (order) => ({ status: order }),
  order: (order) => ({ order: { orderNumber: order } }),
  completed: (order) => ({ completedAt: order }),
};

const LIST_SELECT = {
  id: true,
  refundNumber: true,
  status: true,
  method: true,
  provider: true,
  amountPaise: true,
  reason: true,
  createdAt: true,
  completedAt: true,
  order: { select: { id: true, orderNumber: true, guestEmail: true, customer: { select: { id: true, fullName: true, email: true } } } },
  returnRequest: { select: { id: true, rmaNumber: true } },
  initiatedBy: { select: { name: true, email: true } },
  approvedBy: { select: { name: true, email: true } },
} satisfies Prisma.RefundSelect;

type ListRow = Prisma.RefundGetPayload<{ select: typeof LIST_SELECT }>;

function toRow(row: ListRow): RefundListRow {
  return {
    id: row.id,
    refundNumber: row.refundNumber,
    status: row.status,
    method: row.method,
    provider: row.provider,
    amountPaise: row.amountPaise,
    reason: row.reason,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    orderId: row.order.id,
    orderNumber: row.order.orderNumber,
    customerId: row.order.customer?.id ?? null,
    customerName: row.order.customer?.fullName ?? row.order.guestEmail ?? "Guest",
    customerEmail: row.order.customer?.email ?? row.order.guestEmail ?? "",
    returnRequestId: row.returnRequest?.id ?? null,
    rmaNumber: row.returnRequest?.rmaNumber ?? null,
    initiatedBy: row.initiatedBy?.name ?? row.initiatedBy?.email ?? null,
    approvedBy: row.approvedBy?.name ?? row.approvedBy?.email ?? null,
  };
}

export async function listRefunds(
  params: ListParams & { sort: RefundSort },
  filters: RefundListFilters,
): Promise<{ rows: RefundListRow[]; meta: PageMeta; total: number }> {
  const where = buildRefundWhere(filters, params.q);
  const [total, rows] = await Promise.all([
    db.refund.count({ where }),
    db.refund.findMany({
      where,
      orderBy: SORT_COLUMN[params.sort](params.order),
      skip: params.skip,
      take: params.pageSize,
      select: LIST_SELECT,
    }),
  ]);
  return { rows: rows.map(toRow), meta: buildPageMeta(total, params), total };
}

export type RefundStatusCounts = Record<RefundStatus, number> & { all: number };

export async function refundStatusCounts(filters: RefundListFilters, q: string): Promise<RefundStatusCounts> {
  const grouped = await db.refund.groupBy({
    by: ["status"],
    where: buildRefundWhere(filters, q, { includeStatus: false }),
    _count: { _all: true },
  });
  const counts = Object.fromEntries(REFUND_STATUSES.map((status) => [status, 0])) as Record<RefundStatus, number>;
  let all = 0;
  for (const row of grouped) {
    const status = row.status as RefundStatus;
    if (status in counts) counts[status] = row._count._all;
    all += row._count._all;
  }
  return { ...counts, all };
}

export type RefundKpis = {
  pending: number;
  processing: number;
  completedThisMonthPaise: number;
  failed: number;
};

export async function refundKpis(now = new Date()): Promise<RefundKpis> {
  // IST month to date (§11.27): the calendar the finance team reconciles by.
  const istNow = new Date(now.getTime() + 5.5 * 3600_000);
  const monthStart = startOfIstDay(new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1)));

  const [pending, processing, completed, failed] = await Promise.all([
    db.refund.count({ where: { status: "PENDING" } }),
    db.refund.count({ where: { status: { in: ["APPROVED", "PROCESSING"] } } }),
    db.refund.aggregate({ where: { status: "COMPLETED", completedAt: { gte: monthStart } }, _sum: { amountPaise: true } }),
    db.refund.count({ where: { status: "FAILED" } }),
  ]);

  return {
    pending,
    processing,
    completedThisMonthPaise: completed._sum.amountPaise ?? 0,
    failed,
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

const PAYMENT_SELECT = {
  id: true,
  provider: true,
  method: true,
  amountPaise: true,
  providerPaymentId: true,
  status: true,
  createdAt: true,
} satisfies Prisma.OrderPaymentSelect;

export async function getRefundDetail(id: string): Promise<RefundDetail | null> {
  const refund = await db.refund.findUnique({
    where: { id },
    select: {
      ...LIST_SELECT,
      providerRefundId: true,
      failureReason: true,
      notes: true,
      processedAt: true,
      updatedAt: true,
      orderPaymentId: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentMethod: true,
          paymentStatus: true,
          totalPaise: true,
          refundedPaise: true,
          placedAt: true,
          guestEmail: true,
          customer: { select: { id: true, fullName: true, email: true } },
        },
      },
      sourcePayment: { select: PAYMENT_SELECT },
      settlementPayments: { select: PAYMENT_SELECT, orderBy: { createdAt: "asc" } },
      returnRequest: {
        select: { id: true, rmaNumber: true, status: true, reason: true, quantity: true, orderItem: { select: { titleSnapshot: true } } },
      },
    },
  });
  if (!refund) return null;

  const remaining = await refundableRemaining(db, refund.order.id);

  return {
    ...toRow(refund as unknown as ListRow),
    providerRefundId: refund.providerRefundId,
    failureReason: refund.failureReason,
    notes: refund.notes,
    processedAt: refund.processedAt,
    updatedAt: refund.updatedAt,
    orderPaymentId: refund.orderPaymentId,
    order: {
      id: refund.order.id,
      orderNumber: refund.order.orderNumber,
      status: refund.order.status,
      paymentMethod: refund.order.paymentMethod,
      paymentStatus: refund.order.paymentStatus,
      totalPaise: refund.order.totalPaise,
      refundedPaise: refund.order.refundedPaise,
      placedAt: refund.order.placedAt,
    },
    sourcePayment: refund.sourcePayment,
    settlementPayments: refund.settlementPayments,
    returnRequest: refund.returnRequest
      ? {
          id: refund.returnRequest.id,
          rmaNumber: refund.returnRequest.rmaNumber,
          status: refund.returnRequest.status,
          reason: refund.returnRequest.reason,
          quantity: refund.returnRequest.quantity,
          itemTitle: refund.returnRequest.orderItem.titleSnapshot,
        }
      : null,
    refundableRemainingPaise: remaining,
  };
}

export async function listRefundActivity(refundId: string, take = 40): Promise<RefundActivityRow[]> {
  return db.auditLog.findMany({
    where: { entityType: "Refund", entityId: refundId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, action: true, summary: true, actorEmail: true, createdAt: true },
  });
}

/**
 * Context for the "create refund" dialog: what the order is worth, what was
 * actually collected and how much of it may still go back. Accepts an id or
 * the human order number, because an operator arriving from a phone call has
 * the number, not the id.
 */
export async function getRefundOrderOption(idOrNumber: string): Promise<RefundOrderOption | null> {
  const key = idOrNumber.trim();
  if (!key) return null;
  const order = await db.order.findFirst({
    where: { OR: [{ id: key }, { orderNumber: { equals: key, mode: "insensitive" } }] },
    select: {
      id: true,
      orderNumber: true,
      totalPaise: true,
      paymentMethod: true,
      guestEmail: true,
      customer: { select: { fullName: true } },
      payments: { where: { status: "SUCCEEDED", type: { in: ["CHARGE", "CAPTURE"] } }, select: { provider: true, amountPaise: true } },
    },
  });
  if (!order) return null;

  const remaining = await refundableRemaining(db, order.id);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customer?.fullName ?? order.guestEmail ?? "Guest",
    totalPaise: order.totalPaise,
    paidPaise: order.payments.reduce((sum, payment) => sum + payment.amountPaise, 0),
    refundableRemainingPaise: remaining,
    paymentMethod: order.paymentMethod,
    hasGatewayPayment: order.payments.some((payment) => isGatewayProvider(payment.provider)),
  };
}

/** Σ amounts of the refunds that still count against the cap (B6). */
export async function countedRefundsForOrder(orderId: string): Promise<number> {
  const counted = await db.refund.aggregate({
    where: { orderId, status: { in: [...COUNTED_REFUND_STATUSES] } },
    _sum: { amountPaise: true },
  });
  return counted._sum.amountPaise ?? 0;
}

export async function pageRefundsForExport(
  filters: RefundListFilters,
  q: string,
  skip: number,
  take: number,
): Promise<Array<Record<string, unknown>>> {
  const rows = await db.refund.findMany({
    where: buildRefundWhere(filters, q),
    orderBy: { createdAt: "desc" },
    skip,
    take,
    select: LIST_SELECT,
  });
  return rows.map((row) => {
    const mapped = toRow(row);
    return {
      refundNumber: mapped.refundNumber,
      orderNumber: mapped.orderNumber,
      customer: mapped.customerName,
      email: mapped.customerEmail,
      amountPaise: mapped.amountPaise,
      method: mapped.method,
      provider: mapped.provider ?? "",
      status: mapped.status,
      rmaNumber: mapped.rmaNumber ?? "",
      reason: mapped.reason ?? "",
      createdAt: mapped.createdAt,
      completedAt: mapped.completedAt,
      approvedBy: mapped.approvedBy ?? "",
    };
  });
}
