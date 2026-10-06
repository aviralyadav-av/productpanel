import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { CouponStatus } from "@/lib/enums";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";
import type { EntityRef } from "@/components/shared/entity-picker";
import { deriveCouponStatus } from "@/features/finance/math";

import type { CouponEditorData, CouponListFilters, CouponRow, CouponSort, CouponUsageRow } from "./schemas";

/**
 * Read side of the coupons module. The derived status (§4.7) is expressed in
 * Prisma `where` clauses as far as SQL allows: lifecycle by `isActive` and the
 * date window, exhaustion by a one-column-vs-column comparison Prisma cannot
 * write, so `exhaustedCouponIds()` fetches those ids with one raw query and the
 * rest of the filter uses `id in/notIn`. Rows are then labelled in JS with the
 * SAME `deriveCouponStatus` the rule engine uses, so a tab never disagrees
 * with the badge.
 */

type Db = Prisma.TransactionClient;

const SORT_COLUMN: Record<CouponSort, keyof Prisma.CouponOrderByWithRelationInput> = {
  code: "code",
  type: "type",
  value: "value",
  usage: "usageCount",
  startsAt: "startsAt",
  endsAt: "endsAt",
  updatedAt: "updatedAt",
};

const LIVE: Prisma.CouponWhereInput = { deletedAt: null };

async function exhaustedCouponIds(client: Db): Promise<string[]> {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Coupon"
     WHERE "deletedAt" IS NULL AND "isActive" = TRUE
       AND "usageLimit" IS NOT NULL AND "usageCount" >= "usageLimit"`;
  return rows.map((row) => row.id);
}

function statusWhere(status: CouponStatus, now: Date, exhaustedIds: string[]): Prisma.CouponWhereInput {
  const notExhausted: Prisma.CouponWhereInput = exhaustedIds.length > 0 ? { id: { notIn: exhaustedIds } } : {};
  switch (status) {
    case "DISABLED":
      return { isActive: false };
    case "EXHAUSTED":
      return { id: { in: exhaustedIds.length > 0 ? exhaustedIds : ["__none__"] } };
    case "SCHEDULED":
      return { isActive: true, startsAt: { gt: now }, ...notExhausted };
    case "EXPIRED":
      return { isActive: true, OR: [{ startsAt: null }, { startsAt: { lte: now } }], endsAt: { lt: now }, ...notExhausted };
    case "ACTIVE":
    default:
      return {
        isActive: true,
        AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
        ...notExhausted,
      };
  }
}

export function buildCouponWhere(
  filters: CouponListFilters & { q?: string },
  context: { now: Date; exhaustedIds: string[] },
  options: { includeStatus?: boolean } = {},
): Prisma.CouponWhereInput {
  const clauses: Prisma.CouponWhereInput[] = [LIVE];
  if ((options.includeStatus ?? true) && filters.status) clauses.push(statusWhere(filters.status, context.now, context.exhaustedIds));
  if (filters.type) clauses.push({ type: filters.type });
  if (filters.fundedBy) clauses.push({ fundedBy: filters.fundedBy });
  if (filters.appliesTo) clauses.push({ appliesTo: filters.appliesTo });
  if (filters.q) {
    clauses.push({
      OR: [
        { code: { contains: filters.q, mode: "insensitive" } },
        { name: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }
  return { AND: clauses };
}

// ---------------------------------------------------------------------------
// Scope labels ("3 categories", "Kalakriti Studio")
// ---------------------------------------------------------------------------

type ScopeNames = { category: Map<string, string>; product: Map<string, string>; seller: Map<string, string> };

async function loadScopeNames(
  client: Db,
  rows: ReadonlyArray<{ appliesTo: string; categoryIds: string[]; productIds: string[]; sellerIds: string[] }>,
): Promise<ScopeNames> {
  const single = (kind: "CATEGORIES" | "PRODUCTS" | "SELLERS", pick: (row: (typeof rows)[number]) => string[]) =>
    [...new Set(rows.filter((row) => row.appliesTo === kind && pick(row).length === 1).flatMap(pick))];
  const [categories, products, sellers] = await Promise.all([
    client.category.findMany({ where: { id: { in: single("CATEGORIES", (r) => r.categoryIds) } }, select: { id: true, name: true } }),
    client.product.findMany({ where: { id: { in: single("PRODUCTS", (r) => r.productIds) } }, select: { id: true, title: true } }),
    client.seller.findMany({ where: { id: { in: single("SELLERS", (r) => r.sellerIds) } }, select: { id: true, displayName: true } }),
  ]);
  return {
    category: new Map(categories.map((row) => [row.id, row.name])),
    product: new Map(products.map((row) => [row.id, row.title])),
    seller: new Map(sellers.map((row) => [row.id, row.displayName])),
  };
}

function scopeLabelFor(
  row: { appliesTo: string; categoryIds: string[]; productIds: string[]; sellerIds: string[] },
  names: ScopeNames,
): { scopeCount: number; scopeLabel: string } {
  const pick = (ids: string[], map: Map<string, string>, noun: string) =>
    ids.length === 1 ? (map.get(ids[0]) ?? `1 ${noun}`) : `${ids.length} ${noun}${ids.length === 1 ? "" : "s"}`;
  switch (row.appliesTo) {
    case "CATEGORIES":
      return { scopeCount: row.categoryIds.length, scopeLabel: pick(row.categoryIds, names.category, "category").replace("categorys", "categories") };
    case "PRODUCTS":
      return { scopeCount: row.productIds.length, scopeLabel: pick(row.productIds, names.product, "product") };
    case "SELLERS":
      return { scopeCount: row.sellerIds.length, scopeLabel: pick(row.sellerIds, names.seller, "seller") };
    default:
      return { scopeCount: 0, scopeLabel: "Whole order" };
  }
}

// ---------------------------------------------------------------------------
// List + KPIs
// ---------------------------------------------------------------------------

export type CouponListResult = {
  rows: CouponRow[];
  meta: PageMeta;
  /** Per-status totals for the same filters minus `status`, for the tab counts. */
  statusCounts: Record<CouponStatus, number>;
};

export async function listCoupons(
  params: ListParams & { sort: CouponSort },
  filters: CouponListFilters,
  now: Date = new Date(),
): Promise<CouponListResult> {
  const exhaustedIds = await exhaustedCouponIds(db);
  const context = { now, exhaustedIds };
  const where = buildCouponWhere({ ...filters, q: params.q }, context);
  const base = buildCouponWhere({ ...filters, q: params.q }, context, { includeStatus: false });

  const [total, rows, ...counts] = await Promise.all([
    db.coupon.count({ where }),
    db.coupon.findMany({
      where,
      orderBy: [{ [SORT_COLUMN[params.sort]]: params.order }, { id: "asc" }],
      skip: params.skip,
      take: params.pageSize,
    }),
    ...(["ACTIVE", "SCHEDULED", "EXPIRED", "EXHAUSTED", "DISABLED"] as CouponStatus[]).map((status) =>
      db.coupon.count({ where: { AND: [base, statusWhere(status, now, exhaustedIds)] } }),
    ),
  ]);

  const names = await loadScopeNames(db, rows);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type as CouponRow["type"],
      value: row.value,
      maxDiscountPaise: row.maxDiscountPaise,
      minOrderPaise: row.minOrderPaise,
      appliesTo: row.appliesTo as CouponRow["appliesTo"],
      ...scopeLabelFor(row, names),
      excludedCount: row.excludedProductIds.length,
      usageCount: row.usageCount,
      usageLimit: row.usageLimit,
      perCustomerLimit: row.perCustomerLimit,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      isActive: row.isActive,
      isPublic: row.isPublic,
      fundedBy: row.fundedBy as CouponRow["fundedBy"],
      firstOrderOnly: row.firstOrderOnly,
      targetedCustomers: row.customerIds.length,
      status: deriveCouponStatus(row, now),
      updatedAt: row.updatedAt,
    })),
    meta: buildPageMeta(total, params),
    statusCounts: { ACTIVE: counts[0], SCHEDULED: counts[1], EXPIRED: counts[2], EXHAUSTED: counts[3], DISABLED: counts[4] },
  };
}

export type CouponKpis = {
  active: number;
  scheduled: number;
  expired: number;
  exhausted: number;
  disabled: number;
  redemptions: number;
  discountGivenPaise: number;
};

export async function couponKpis(now: Date = new Date()): Promise<CouponKpis> {
  const exhaustedIds = await exhaustedCouponIds(db);
  const count = (status: CouponStatus) => db.coupon.count({ where: { AND: [LIVE, statusWhere(status, now, exhaustedIds)] } });
  const [active, scheduled, expired, disabled, usage] = await Promise.all([
    count("ACTIVE"),
    count("SCHEDULED"),
    count("EXPIRED"),
    count("DISABLED"),
    db.couponUsage.aggregate({ _count: { _all: true }, _sum: { discountPaise: true } }),
  ]);
  return {
    active,
    scheduled,
    expired,
    exhausted: exhaustedIds.length,
    disabled,
    redemptions: usage._count._all,
    discountGivenPaise: usage._sum.discountPaise ?? 0,
  };
}

/** Export feed: same filters as the list, pages of `take`, oldest-first for a stable file. */
export async function pageCouponsForExport(
  filters: CouponListFilters & { q?: string },
  skip: number,
  take: number,
  now: Date = new Date(),
): Promise<CouponRow[]> {
  const exhaustedIds = await exhaustedCouponIds(db);
  const rows = await db.coupon.findMany({
    where: buildCouponWhere(filters, { now, exhaustedIds }),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip,
    take,
  });
  const names = await loadScopeNames(db, rows);
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type as CouponRow["type"],
    value: row.value,
    maxDiscountPaise: row.maxDiscountPaise,
    minOrderPaise: row.minOrderPaise,
    appliesTo: row.appliesTo as CouponRow["appliesTo"],
    ...scopeLabelFor(row, names),
    excludedCount: row.excludedProductIds.length,
    usageCount: row.usageCount,
    usageLimit: row.usageLimit,
    perCustomerLimit: row.perCustomerLimit,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    isActive: row.isActive,
    isPublic: row.isPublic,
    fundedBy: row.fundedBy as CouponRow["fundedBy"],
    firstOrderOnly: row.firstOrderOnly,
    targetedCustomers: row.customerIds.length,
    status: deriveCouponStatus(row, now),
    updatedAt: row.updatedAt,
  }));
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

/** Turn stored id lists back into the chips the EntityPicker renders. Missing ids are dropped. */
export async function hydrateEntityRefs(
  kind: "category" | "product" | "seller" | "customer",
  ids: readonly string[],
  client: Db = db,
): Promise<EntityRef[]> {
  if (ids.length === 0) return [];
  const list = [...ids];
  switch (kind) {
    case "category": {
      const rows = await client.category.findMany({ where: { id: { in: list } }, select: { id: true, name: true, path: true } });
      return order(list, rows.map((row) => ({ id: row.id, title: row.name, subtitle: row.path })));
    }
    case "product": {
      const rows = await client.product.findMany({
        where: { id: { in: list } },
        select: { id: true, title: true, status: true, images: { take: 1, orderBy: { position: "asc" }, select: { media: { select: { thumbnailUrl: true, url: true } } } } },
      });
      return order(
        list,
        rows.map((row) => ({
          id: row.id,
          title: row.title,
          subtitle: row.status,
          imageUrl: row.images[0]?.media?.thumbnailUrl ?? row.images[0]?.media?.url ?? undefined,
        })),
      );
    }
    case "seller": {
      const rows = await client.seller.findMany({ where: { id: { in: list } }, select: { id: true, displayName: true, status: true } });
      return order(list, rows.map((row) => ({ id: row.id, title: row.displayName, subtitle: row.status })));
    }
    case "customer": {
      const rows = await client.customer.findMany({ where: { id: { in: list } }, select: { id: true, fullName: true, email: true } });
      return order(list, rows.map((row) => ({ id: row.id, title: row.fullName ?? row.email, subtitle: row.email })));
    }
  }
}

function order(ids: string[], refs: EntityRef[]): EntityRef[] {
  const byId = new Map(refs.map((ref) => [ref.id, ref]));
  return ids.map((id) => byId.get(id)).filter((ref): ref is EntityRef => Boolean(ref));
}

export async function getCouponEditor(id: string, now: Date = new Date()): Promise<CouponEditorData | null> {
  const row = await db.coupon.findFirst({ where: { id, deletedAt: null }, include: { createdBy: { select: { email: true } } } });
  if (!row) return null;

  const [categories, products, sellers, excludedProducts, customers, usage] = await Promise.all([
    hydrateEntityRefs("category", row.categoryIds),
    hydrateEntityRefs("product", row.productIds),
    hydrateEntityRefs("seller", row.sellerIds),
    hydrateEntityRefs("product", row.excludedProductIds),
    hydrateEntityRefs("customer", row.customerIds),
    db.couponUsage.aggregate({ where: { couponId: id }, _count: { _all: true }, _sum: { discountPaise: true } }),
  ]);

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    type: row.type as CouponEditorData["type"],
    value: row.value,
    maxDiscountPaise: row.maxDiscountPaise,
    minOrderPaise: row.minOrderPaise,
    appliesTo: row.appliesTo as CouponEditorData["appliesTo"],
    categories,
    products,
    sellers,
    excludedProducts,
    customers,
    firstOrderOnly: row.firstOrderOnly,
    usageLimit: row.usageLimit,
    perCustomerLimit: row.perCustomerLimit,
    usageCount: row.usageCount,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    isActive: row.isActive,
    isPublic: row.isPublic,
    fundedBy: row.fundedBy as CouponEditorData["fundedBy"],
    status: deriveCouponStatus(row, now),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdByEmail: row.createdBy?.email ?? null,
    redemptions: usage._count._all,
    discountGivenPaise: usage._sum.discountPaise ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Usage + activity tabs
// ---------------------------------------------------------------------------

export async function listCouponUsages(couponId: string, params: ListParams): Promise<{ rows: CouponUsageRow[]; meta: PageMeta }> {
  const where: Prisma.CouponUsageWhereInput = { couponId };
  const [total, rows] = await Promise.all([
    db.couponUsage.count({ where }),
    db.couponUsage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: params.skip,
      take: params.pageSize,
      select: {
        id: true,
        orderId: true,
        customerId: true,
        discountPaise: true,
        createdAt: true,
        order: { select: { orderNumber: true, status: true, guestEmail: true } },
        customer: { select: { fullName: true, email: true } },
      },
    }),
  ]);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      orderNumber: row.order?.orderNumber ?? null,
      orderStatus: row.order?.status ?? null,
      customerId: row.customerId,
      customerName: row.customer?.fullName ?? null,
      customerEmail: row.customer?.email ?? row.order?.guestEmail ?? null,
      discountPaise: row.discountPaise,
      createdAt: row.createdAt,
    })),
    meta: buildPageMeta(total, params),
  };
}

export type CouponActivityRow = {
  id: string;
  action: string;
  summary: string;
  actorEmail: string;
  createdAt: Date;
  diff: unknown;
};

export async function listCouponActivity(couponId: string, take = 50): Promise<CouponActivityRow[]> {
  const rows = await db.auditLog.findMany({
    where: { entityType: "coupon", entityId: couponId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, action: true, summary: true, actorEmail: true, createdAt: true, diff: true },
  });
  return rows;
}
