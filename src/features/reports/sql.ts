import { Prisma, type PrismaClient } from "@prisma/client";

import { db } from "@/lib/db";
import type { OrderStatus, PaymentMethod } from "@/lib/enums";
import type { Bucket } from "./bucketing";

/**
 * Raw-SQL building blocks shared by every metric (blueprint §11.27, §11.28,
 * E4). Reports aggregate in the database - `GROUP BY date_trunc(...)`,
 * `SUM(...) FILTER (...)` - rather than loading order rows into Node, so a
 * year of orders costs one round trip regardless of volume.
 *
 * Everything here is composed with `Prisma.sql`; identifiers that vary
 * (bucket unit, sort column) come from closed unions and go through
 * `Prisma.raw` only after validation, values are always bound parameters.
 */

export type Db = Prisma.TransactionClient | PrismaClient;

export function client(tx?: Db): Db {
  return tx ?? db;
}

export type MetricRange = { from: Date; to: Date };

/**
 * E4: revenue counts every order that is not CANCELLED or FAILED. RETURNED /
 * REFUNDED orders stay in, because their refunds are subtracted separately
 * (via refundedPaise) - excluding the row as well would double-count the loss.
 */
export const EXCLUDED_ORDER_STATUSES: readonly OrderStatus[] = ["CANCELLED", "FAILED"];

/** Order-level filters; every key optional. */
export type OrderFilters = {
  status?: OrderStatus;
  paymentMethod?: PaymentMethod;
  couponId?: string;
  source?: string;
  customerId?: string;
};

/** Line-level filters; when applied to orders they mean "orders containing such a line". */
export type ItemFilters = OrderFilters & {
  sellerId?: string;
  /** Resolved category path ("/home-living"); matches the category and every descendant. */
  categoryPath?: string;
  productId?: string;
  variantId?: string;
};

/** Numbers come back from SUM/COUNT as bigint or Decimal-ish strings; normalise to a JS number. */
export function num(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

/**
 * A bound Date compared against a `timestamp` column that stores UTC wall-clock.
 *
 * The ISO string is bound, NOT the Date: the pg adapter sends a Date without a
 * zone marker, so `::timestamptz` would resolve it in the DATABASE SESSION's
 * zone (this server runs Asia/Calcutta) and every range boundary in every
 * metric would land 5h30m early. `toISOString()` carries the `Z`, so the cast
 * is unambiguous whatever the session zone is.
 */
export function utcTs(date: Date): Prisma.Sql {
  return Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/** `to_char(date_trunc(<bucket>, <column> in IST), 'YYYY-MM-DD')` - the bucket key (see bucketing.ts). */
export function istBucketKey(bucket: Bucket, column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`to_char(date_trunc(${Prisma.raw(`'${bucket}'`)}, (${column} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')), 'YYYY-MM-DD')`;
}

/** `WHERE a AND b ...`, or nothing when there are no conditions. */
export function whereAll(conditions: readonly Prisma.Sql[]): Prisma.Sql {
  if (conditions.length === 0) return Prisma.empty;
  return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
}

export function inList(values: readonly string[]): Prisma.Sql {
  return Prisma.join(values.map((value) => Prisma.sql`${value}`));
}

/** `column BETWEEN range` for a UTC timestamp column. */
export function inRange(column: Prisma.Sql, range: MetricRange): Prisma.Sql {
  return Prisma.sql`${column} >= ${utcTs(range.from)} AND ${column} <= ${utcTs(range.to)}`;
}

/**
 * Conditions on an `"Order" o` row: placed in range, not cancelled/failed
 * (unless a specific status is requested, or `allStatuses` asks for the full
 * funnel including cancellations), plus the optional order filters.
 * Line-level filters become an EXISTS so "orders for seller X" works.
 */
export function orderConditions(
  range: MetricRange,
  filters: ItemFilters = {},
  alias = "o",
  options: { allStatuses?: boolean } = {},
): Prisma.Sql[] {
  const o = Prisma.raw(alias);
  const conditions: Prisma.Sql[] = [inRange(Prisma.sql`${o}."placedAt"`, range)];

  if (filters.status) conditions.push(Prisma.sql`${o}.status = ${filters.status}`);
  else if (!options.allStatuses) conditions.push(Prisma.sql`${o}.status NOT IN (${inList(EXCLUDED_ORDER_STATUSES)})`);

  if (filters.paymentMethod) conditions.push(Prisma.sql`${o}."paymentMethod" = ${filters.paymentMethod}`);
  if (filters.couponId) conditions.push(Prisma.sql`${o}."couponId" = ${filters.couponId}`);
  if (filters.source) conditions.push(Prisma.sql`${o}.source = ${filters.source}`);
  if (filters.customerId) conditions.push(Prisma.sql`${o}."customerId" = ${filters.customerId}`);

  const lineConditions = itemOnlyConditions(filters, "x");
  if (lineConditions.length > 0) {
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "OrderItem" x WHERE x."orderId" = ${o}.id AND ${Prisma.join(lineConditions, " AND ")})`,
    );
  }
  return conditions;
}

/** Just the line-level part (seller / category subtree / product / variant) on an `"OrderItem"` alias. */
export function itemOnlyConditions(filters: ItemFilters, alias = "oi"): Prisma.Sql[] {
  const oi = Prisma.raw(alias);
  const conditions: Prisma.Sql[] = [];
  if (filters.sellerId) conditions.push(Prisma.sql`${oi}."sellerId" = ${filters.sellerId}`);
  if (filters.productId) conditions.push(Prisma.sql`${oi}."productId" = ${filters.productId}`);
  if (filters.variantId) conditions.push(Prisma.sql`${oi}."variantId" = ${filters.variantId}`);
  if (filters.categoryPath) {
    // Exact match OR a descendant: "/home" must not match "/home-living".
    conditions.push(
      Prisma.sql`(${oi}."categoryPathSnapshot" = ${filters.categoryPath} OR ${oi}."categoryPathSnapshot" LIKE ${`${filters.categoryPath}/%`})`,
    );
  }
  return conditions;
}

/**
 * Conditions for `"OrderItem" oi JOIN "Order" o`: the order-level rules
 * (range, status, payment) plus the line filters on the line itself, and the
 * line must not be a cancelled line (a cancelled line on a live order sold
 * nothing).
 */
export function itemConditions(range: MetricRange, filters: ItemFilters = {}): Prisma.Sql[] {
  const { sellerId, categoryPath, productId, variantId, ...orderOnly } = filters;
  void sellerId;
  void categoryPath;
  void productId;
  void variantId;
  return [
    ...orderConditions(range, orderOnly, "o"),
    Prisma.sql`oi.status <> 'CANCELLED'`,
    ...itemOnlyConditions(filters, "oi"),
  ];
}

/** Category id -> path, so a category filter covers the whole subtree. Unknown ids filter to nothing. */
export async function resolveCategoryPath(categoryId: string | undefined, tx?: Db): Promise<string | undefined> {
  if (!categoryId) return undefined;
  const row = await client(tx).category.findUnique({ where: { id: categoryId }, select: { path: true } });
  return row?.path ?? "/__unknown__";
}

/** `ORDER BY <validated column> <dir>, <tiebreak>` - the caller passes a whitelist map. */
export function orderBy(
  sortKey: string,
  order: "asc" | "desc",
  columns: Record<string, string>,
  fallbackKey: string,
  tiebreak = "1",
): Prisma.Sql {
  const column = columns[sortKey] ?? columns[fallbackKey];
  const direction = order === "asc" ? "ASC" : "DESC";
  return Prisma.raw(`ORDER BY ${column} ${direction} NULLS LAST, ${tiebreak}`);
}

export function limitOffset(take: number, skip: number): Prisma.Sql {
  return Prisma.sql`LIMIT ${Math.max(0, Math.trunc(take))} OFFSET ${Math.max(0, Math.trunc(skip))}`;
}
