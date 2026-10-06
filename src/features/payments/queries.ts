import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";
import { endOfIstDay, startOfIstDay } from "@/lib/dates";
import { resolveDateRangeParams } from "@/components/shared/date-range";

import type { PaymentListFilters, PaymentSort } from "./schemas";
import type { PaymentDetail, PaymentKpis, PaymentListRow, PaymentWebhookRow } from "./types";

/**
 * Read side for PAYMENTS (blueprint §1 Payments, §9, D4, D11).
 *
 * This module never writes: an OrderPayment row is created by the checkout,
 * by a webhook, by the manual-payment action on an order, or by the refunds
 * service when a refund settles. The screens exist to answer "did the money
 * arrive, and where is the evidence" - which is why the detail page can show
 * the raw gateway payload, and why that is gated on `payments.manage`.
 */

export function resolvePaymentRange(filters: PaymentListFilters, now = new Date()): { from: Date; to: Date } | null {
  if (!filters.range && !filters.from && !filters.to) return null;
  const params = new URLSearchParams();
  if (filters.range) params.set("range", filters.range);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const resolved = resolveDateRangeParams(params, "30d", now);
  return { from: resolved.from, to: resolved.to };
}

export function buildPaymentWhere(filters: PaymentListFilters, q: string): Prisma.OrderPaymentWhereInput {
  const where: Prisma.OrderPaymentWhereInput = {};
  const and: Prisma.OrderPaymentWhereInput[] = [];

  if (filters.provider) where.provider = filters.provider;
  if (filters.method) where.method = filters.method;
  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;
  // An id (from a link) or a human order number (typed) both narrow the list.
  if (filters.orderId) {
    and.push({ OR: [{ orderId: filters.orderId }, { order: { is: { orderNumber: { equals: filters.orderId, mode: "insensitive" } } } }] });
  }
  if (filters.customerId) where.order = { is: { customerId: filters.customerId } };

  const range = resolvePaymentRange(filters);
  if (range) where.createdAt = { gte: range.from, lte: range.to };

  const term = q.trim();
  if (term) {
    and.push({
      OR: [
        { providerPaymentId: { contains: term, mode: "insensitive" } },
        { providerOrderId: { contains: term, mode: "insensitive" } },
        { order: { is: { orderNumber: { contains: term, mode: "insensitive" } } } },
        { order: { is: { guestEmail: { contains: term, mode: "insensitive" } } } },
        { order: { is: { customer: { is: { email: { contains: term, mode: "insensitive" } } } } } },
        { order: { is: { customer: { is: { fullName: { contains: term, mode: "insensitive" } } } } } },
      ],
    });
  }

  if (and.length) where.AND = and;
  return where;
}

const SORT_COLUMN: Record<PaymentSort, (order: "asc" | "desc") => Prisma.OrderPaymentOrderByWithRelationInput> = {
  created: (order) => ({ createdAt: order }),
  amount: (order) => ({ amountPaise: order }),
  status: (order) => ({ status: order }),
  provider: (order) => ({ provider: order }),
  order: (order) => ({ order: { orderNumber: order } }),
  type: (order) => ({ type: order }),
};

const LIST_SELECT = {
  id: true,
  provider: true,
  providerOrderId: true,
  providerPaymentId: true,
  method: true,
  type: true,
  status: true,
  amountPaise: true,
  currency: true,
  createdAt: true,
  capturedAt: true,
  refundId: true,
  refund: { select: { refundNumber: true } },
  order: { select: { id: true, orderNumber: true, guestEmail: true, customer: { select: { id: true, fullName: true, email: true } } } },
} satisfies Prisma.OrderPaymentSelect;

type ListRow = Prisma.OrderPaymentGetPayload<{ select: typeof LIST_SELECT }>;

function toRow(row: ListRow): PaymentListRow {
  return {
    id: row.id,
    provider: row.provider,
    providerOrderId: row.providerOrderId,
    providerPaymentId: row.providerPaymentId,
    method: row.method,
    type: row.type,
    status: row.status,
    amountPaise: row.amountPaise,
    currency: row.currency,
    createdAt: row.createdAt,
    capturedAt: row.capturedAt,
    orderId: row.order.id,
    orderNumber: row.order.orderNumber,
    customerId: row.order.customer?.id ?? null,
    customerName: row.order.customer?.fullName ?? row.order.guestEmail ?? "Guest",
    customerEmail: row.order.customer?.email ?? row.order.guestEmail ?? "",
    refundId: row.refundId,
    refundNumber: row.refund?.refundNumber ?? null,
  };
}

export async function listPayments(
  params: ListParams & { sort: PaymentSort },
  filters: PaymentListFilters,
): Promise<{ rows: PaymentListRow[]; meta: PageMeta; total: number }> {
  const where = buildPaymentWhere(filters, params.q);
  const [total, rows] = await Promise.all([
    db.orderPayment.count({ where }),
    db.orderPayment.findMany({
      where,
      orderBy: SORT_COLUMN[params.sort](params.order),
      skip: params.skip,
      take: params.pageSize,
      select: LIST_SELECT,
    }),
  ]);
  return { rows: rows.map(toRow), meta: buildPageMeta(total, params), total };
}

/**
 * Collected = SUCCEEDED CHARGE/CAPTURE rows (B6's definition of "paid"), so
 * this tile can never disagree with `Order.paymentStatus`.
 */
export async function paymentKpis(now = new Date()): Promise<PaymentKpis> {
  const todayFrom = startOfIstDay(now);
  const todayTo = endOfIstDay(now);
  const istNow = new Date(now.getTime() + 5.5 * 3600_000);
  const monthFrom = startOfIstDay(new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1)));

  const charge: Prisma.OrderPaymentWhereInput = { status: "SUCCEEDED", type: { in: ["CHARGE", "CAPTURE"] } };
  const [today, month, pending, failed, refunded] = await Promise.all([
    db.orderPayment.aggregate({ where: { ...charge, createdAt: { gte: todayFrom, lte: todayTo } }, _sum: { amountPaise: true } }),
    db.orderPayment.aggregate({ where: { ...charge, createdAt: { gte: monthFrom } }, _sum: { amountPaise: true } }),
    db.orderPayment.count({ where: { status: "PENDING" } }),
    db.orderPayment.count({ where: { status: "FAILED", createdAt: { gte: monthFrom } } }),
    db.orderPayment.aggregate({ where: { type: "REFUND", status: "SUCCEEDED", createdAt: { gte: monthFrom } }, _sum: { amountPaise: true } }),
  ]);

  return {
    collectedTodayPaise: today._sum?.amountPaise ?? 0,
    collectedMonthPaise: month._sum?.amountPaise ?? 0,
    pending,
    failed,
    refundedMonthPaise: refunded._sum?.amountPaise ?? 0,
  };
}

/**
 * Webhook events that mention this payment. `WebhookEvent` has no foreign key
 * to the order (D5 keeps it a raw inbox), so the provider's own ids are
 * matched inside the JSON text - which is the only link that survives every
 * provider's differing payload shape.
 */
export async function listWebhookEventsFor(
  provider: string,
  ids: readonly (string | null)[],
  take = 20,
): Promise<PaymentWebhookRow[]> {
  const needles = ids.filter((id): id is string => Boolean(id && id.length >= 6));
  if (needles.length === 0) return [];

  const rows = await db.$queryRaw<PaymentWebhookRow[]>`
    SELECT id, provider, "providerEventId", "receivedAt", "processedAt", error
      FROM "WebhookEvent"
     WHERE provider = ${provider}
       AND payload::text ILIKE ANY (${needles.map((needle) => `%${needle}%`)})
     ORDER BY "receivedAt" DESC
     LIMIT ${take}`;
  return rows;
}

export async function getPaymentDetail(id: string, options: { includeRaw: boolean }): Promise<PaymentDetail | null> {
  const payment = await db.orderPayment.findUnique({
    where: { id },
    select: {
      ...LIST_SELECT,
      failureCode: true,
      failureMessage: true,
      updatedAt: true,
      rawPayload: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          paymentMethod: true,
          totalPaise: true,
          refundedPaise: true,
          placedAt: true,
          guestEmail: true,
          customer: { select: { id: true, fullName: true, email: true } },
        },
      },
    },
  });
  if (!payment) return null;

  const [refundRows, refunds, webhookEvents] = await Promise.all([
    db.orderPayment.findMany({
      where: { orderId: payment.order.id, type: "REFUND" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        provider: true,
        method: true,
        amountPaise: true,
        status: true,
        providerPaymentId: true,
        createdAt: true,
        refundId: true,
        refund: { select: { refundNumber: true } },
      },
    }),
    db.refund.findMany({
      where: { orderId: payment.order.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, refundNumber: true, amountPaise: true, status: true, method: true, createdAt: true },
    }),
    listWebhookEventsFor(payment.provider, [payment.providerOrderId, payment.providerPaymentId]),
  ]);

  return {
    ...toRow(payment as unknown as ListRow),
    failureCode: payment.failureCode,
    failureMessage: payment.failureMessage,
    updatedAt: payment.updatedAt,
    // D4/D11: the gateway payload can carry cardholder details and signatures.
    rawPayload: options.includeRaw ? (payment.rawPayload ?? null) : null,
    order: {
      id: payment.order.id,
      orderNumber: payment.order.orderNumber,
      status: payment.order.status,
      paymentStatus: payment.order.paymentStatus,
      paymentMethod: payment.order.paymentMethod,
      totalPaise: payment.order.totalPaise,
      refundedPaise: payment.order.refundedPaise,
      placedAt: payment.order.placedAt,
    },
    relatedRefundPayments: refundRows.map((row) => ({
      id: row.id,
      provider: row.provider,
      method: row.method,
      amountPaise: row.amountPaise,
      status: row.status,
      providerPaymentId: row.providerPaymentId,
      createdAt: row.createdAt,
      refundId: row.refundId,
      refundNumber: row.refund?.refundNumber ?? null,
    })),
    refunds,
    webhookEvents,
  };
}

export async function getPaymentOrderRef(orderId: string | undefined): Promise<{ id: string; title: string; subtitle?: string } | null> {
  if (!orderId) return null;
  const order = await db.order.findFirst({
    where: { OR: [{ id: orderId }, { orderNumber: { equals: orderId, mode: "insensitive" } }] },
    select: { id: true, orderNumber: true, totalPaise: true },
  });
  return order ? { id: order.id, title: order.orderNumber } : null;
}

export async function pagePaymentsForExport(
  filters: PaymentListFilters,
  q: string,
  skip: number,
  take: number,
): Promise<Array<Record<string, unknown>>> {
  const rows = await db.orderPayment.findMany({
    where: buildPaymentWhere(filters, q),
    orderBy: { createdAt: "desc" },
    skip,
    take,
    select: LIST_SELECT,
  });
  return rows.map((row) => {
    const mapped = toRow(row);
    return {
      transactionId: mapped.providerPaymentId ?? mapped.id,
      providerOrderId: mapped.providerOrderId ?? "",
      orderNumber: mapped.orderNumber,
      customer: mapped.customerName,
      email: mapped.customerEmail,
      amountPaise: mapped.amountPaise,
      currency: mapped.currency,
      provider: mapped.provider,
      method: mapped.method,
      type: mapped.type,
      status: mapped.status,
      createdAt: mapped.createdAt,
      capturedAt: mapped.capturedAt,
      refundNumber: mapped.refundNumber ?? "",
    };
  });
}
