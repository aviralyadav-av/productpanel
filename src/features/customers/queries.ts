import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { previousRange, resolveRange } from "@/lib/dates";
import type { CustomerStatus, OrderStatus } from "@/lib/enums";
import type {
  CustomerDetail,
  CustomerKpis,
  CustomerListResult,
  CustomerRow,
  CustomerSegment,
  CustomerSort,
} from "./schemas";

/**
 * Every number on the customers screen is derived from the Order rows attached
 * to a Customer. There is no stored lifetime value, no stored order count and
 * no stored segment - a cached total that nobody recomputes is how an admin
 * starts quietly lying about money.
 *
 * Deliberately ABSENT, because the data does not exist anywhere on a server:
 *   - cart contents, cart value, wishlist. The storefront keeps both in the
 *     shopper's own localStorage and never transmits them.
 *   - sessions, page views, last-seen. No analytics is emitted by the site.
 *   - marketing consent. Checkout never asks for it.
 */

/**
 * Cancelled orders are money that never arrived, so they are excluded from
 * every figure here. RETURNED orders are NOT excluded: refunds are subtracted
 * separately, so a return that was refunded already nets to zero, while a
 * return the store has not paid back is still cash it holds. Excluding the row
 * as well would double-count the loss.
 */
const CANCELLED: OrderStatus = "CANCELLED";

/** One definition of "new", shared by the KPI tile and the ?segment=new filter. */
function newCustomerWindow() {
  return resolveRange("30d");
}

/**
 * A phone number in a list is a phone number on a screen someone walks past.
 * Masking happens in the query rather than the component so the unmasked digits
 * never enter the list payload at all - the detail sheet is the only place that
 * reads the real column.
 */
function maskPhone(phone: string | null): string | null {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length < 6) return "•".repeat(digits.length);

  return `${digits.slice(0, 2)}${"•".repeat(digits.length - 5)}${digits.slice(-3)}`;
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export async function getCustomerKpis(): Promise<CustomerKpis> {
  const range = newCustomerWindow();
  const previous = previousRange(range);

  const [total, newLast30, newPrevious30, grouped] = await Promise.all([
    db.customer.count(),
    db.customer.count({
      where: { createdAt: { gte: range.from, lte: range.to } },
    }),
    db.customer.count({
      where: { createdAt: { gte: previous.from, lte: previous.to } },
    }),
    db.order.groupBy({
      by: ["customerId"],
      where: { customerId: { not: null }, status: { not: CANCELLED } },
      _sum: { totalPaise: true, refundedPaise: true },
      _count: { _all: true },
    }),
  ]);

  let netPaise = 0;
  let repeat = 0;

  for (const row of grouped) {
    netPaise += (row._sum.totalPaise ?? 0) - (row._sum.refundedPaise ?? 0);
    if (row._count._all > 1) repeat += 1;
  }

  return {
    total,
    newLast30,
    newPrevious30,
    repeat,
    withOrders: grouped.length,
    // Divided by EVERY customer, not only the ones who bought. A record with no
    // order is a real customer worth nothing yet, and hiding those inflates the
    // average into a number that flatters the store.
    averageLifetimeValuePaise: total > 0 ? Math.round(netPaise / total) : 0,
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/**
 * Filtering happens in SQL; the aggregate columns (lifetime value, order count,
 * average order, last order) are joined and sorted in JavaScript.
 *
 * Sorting by a computed lifetime value in SQL means either a correlated
 * subquery per row or a materialised rollup, and this store has hundreds of
 * customers, not millions. Two queries and a sort in memory is measurably
 * faster than either, and it keeps one definition of lifetime value instead of
 * one in TypeScript and a second in raw SQL that drift apart. Revisit if the
 * customer table passes ~50k rows.
 */
export async function getCustomers(input: {
  q: string;
  status?: CustomerStatus;
  segment?: CustomerSegment;
  sort: CustomerSort;
  order: "asc" | "desc";
  skip: number;
  take: number;
}): Promise<CustomerListResult> {
  const where: Prisma.CustomerWhereInput = {};

  if (input.status) where.status = input.status;
  if (input.segment === "new") {
    where.createdAt = { gte: newCustomerWindow().from };
  }

  if (input.q) {
    const or: Prisma.CustomerWhereInput[] = [
      { fullName: { contains: input.q, mode: "insensitive" } },
      { email: { contains: input.q, mode: "insensitive" } },
      { phone: { contains: input.q } },
    ];

    // "98765 43210" and "9876543210" are the same number to a human, so a
    // search typed either way has to find a row stored the other way.
    const digits = input.q.replace(/\D/g, "");
    if (digits.length >= 4 && digits !== input.q) {
      or.push({ phone: { contains: digits } });
    }

    where.OR = or;
  }

  const customers = await db.customer.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      status: true,
      createdAt: true,
      userId: true,
    },
  });

  const ids = customers.map((customer) => customer.id);

  const grouped =
    ids.length === 0
      ? []
      : await db.order.groupBy({
          by: ["customerId"],
          where: { customerId: { in: ids }, status: { not: CANCELLED } },
          _sum: { totalPaise: true, refundedPaise: true },
          _count: { _all: true },
          _max: { placedAt: true },
        });

  const byCustomer = new Map(
    grouped.map((row) => [row.customerId as string, row]),
  );

  let rows: CustomerRow[] = customers.map((customer) => {
    const aggregate = byCustomer.get(customer.id);
    const orderCount = aggregate?._count._all ?? 0;
    const lifetimeValuePaise = aggregate
      ? (aggregate._sum.totalPaise ?? 0) - (aggregate._sum.refundedPaise ?? 0)
      : 0;

    return {
      id: customer.id,
      fullName: customer.fullName,
      email: customer.email,
      phoneMasked: maskPhone(customer.phone),
      status: customer.status,
      orderCount,
      lifetimeValuePaise,
      averageOrderPaise:
        orderCount > 0 ? Math.round(lifetimeValuePaise / orderCount) : 0,
      lastOrderAt: aggregate?._max.placedAt ?? null,
      createdAt: customer.createdAt,
      hasAccount: customer.userId !== null,
    };
  });

  if (input.segment === "repeat") {
    rows = rows.filter((row) => row.orderCount > 1);
  }

  const direction = input.order === "asc" ? 1 : -1;

  rows.sort((a, b) => {
    const primary =
      input.sort === "orders"
        ? a.orderCount - b.orderCount
        : input.sort === "joined"
          ? a.createdAt.getTime() - b.createdAt.getTime()
          : a.lifetimeValuePaise - b.lifetimeValuePaise;

    if (primary !== 0) return primary * direction;

    // A total tie-break, or paging through customers who have all spent
    // nothing would show the same row on two pages and skip another.
    return (
      b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id)
    );
  });

  return {
    rows: rows.slice(input.skip, input.skip + input.take),
    total: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export async function getCustomerDetail(
  id: string,
): Promise<CustomerDetail | null> {
  const customer = await db.customer.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      status: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      // The ONLY thing read about the linked login: that there is one. The User
      // row holds passwordHash and is never selected on this screen.
      userId: true,
      addresses: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          fullName: true,
          phone: true,
          line1: true,
          city: true,
          state: true,
          pinCode: true,
          country: true,
          isDefault: true,
        },
      },
      orders: {
        orderBy: { placedAt: "desc" },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          paymentMethod: true,
          totalPaise: true,
          refundedPaise: true,
          placedAt: true,
          _count: { select: { items: true } },
        },
      },
    },
  });

  if (!customer) return null;

  const orders = customer.orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    totalPaise: order.totalPaise,
    refundedPaise: order.refundedPaise,
    placedAt: order.placedAt,
    itemCount: order._count.items,
  }));

  const counted = orders.filter((order) => order.status !== CANCELLED);
  const lifetimeValuePaise = counted.reduce(
    (sum, order) => sum + order.totalPaise - order.refundedPaise,
    0,
  );

  return {
    id: customer.id,
    email: customer.email,
    fullName: customer.fullName,
    phone: customer.phone,
    status: customer.status,
    notes: customer.notes,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    hasAccount: customer.userId !== null,
    addresses: customer.addresses,
    orders,
    stats: {
      orderCount: counted.length,
      cancelledCount: orders.length - counted.length,
      lifetimeValuePaise,
      refundedPaise: counted.reduce(
        (sum, order) => sum + order.refundedPaise,
        0,
      ),
      averageOrderPaise:
        counted.length > 0
          ? Math.round(lifetimeValuePaise / counted.length)
          : 0,
      // `orders` is already sorted newest first, so the ends of the counted
      // list are the first and last purchase without another pass.
      firstOrderAt: counted.at(-1)?.placedAt ?? null,
      lastOrderAt: counted.at(0)?.placedAt ?? null,
    },
  };
}
