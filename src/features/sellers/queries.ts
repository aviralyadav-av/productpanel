import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { OPEN_PAYOUT_STATUSES, SELLER_STATUSES, commissionTargetKey, type CommissionScope, type SellerStatus } from "@/lib/enums";
import { buildPageMeta, type ListParams } from "@/lib/list-params";

import { maskGstin, type SellerListFilters, type SellerSort } from "@/features/sellers/schemas";
import type { SellerFilterOptions, SellerKpis, SellerListResult, SellerListRow, SellerStatusCounts } from "@/features/sellers/types";

/**
 * Read side of the seller LIST (blueprint §6 brief, §14.B3/B4). The detail
 * tabs live in detail-queries.ts. Everything here is one page of rows plus
 * the per-page enrichments (documents, distinct orders, commission, payout
 * state) fetched in bulk for the ids on that page - never one query per row.
 */

const SORT_COLUMN: Record<SellerSort, Prisma.SellerOrderByWithRelationInput> = {
  name: { displayName: "asc" },
  registered: { createdAt: "desc" },
  products: { productCount: "desc" },
  orders: { orderItemCount: "desc" },
  grossSales: { grossSalesPaise: "desc" },
  rating: { ratingAvg: "desc" },
  status: { status: "asc" },
};

function orderBy(sort: SellerSort, order: "asc" | "desc"): Prisma.SellerOrderByWithRelationInput[] {
  const [[column]] = Object.entries(SORT_COLUMN[sort]) as Array<[keyof Prisma.SellerOrderByWithRelationInput, unknown]>;
  return [{ [column]: order } as Prisma.SellerOrderByWithRelationInput, { id: order }];
}

export function buildSellerWhere(filters: SellerListFilters, options: { includeStatus?: boolean } = {}): Prisma.SellerWhereInput {
  const clauses: Prisma.SellerWhereInput[] = [{ deletedAt: null }];

  if ((options.includeStatus ?? true) && filters.status) clauses.push({ status: filters.status });
  if (filters.state) clauses.push({ state: { equals: filters.state, mode: "insensitive" } });
  if (filters.city) clauses.push({ city: { equals: filters.city, mode: "insensitive" } });
  if (filters.pendingDocs) clauses.push({ documents: { some: { status: "PENDING" } } });
  if (filters.minRating !== undefined) clauses.push({ ratingAvg: { gte: filters.minRating } });

  if (filters.q) {
    const q = filters.q;
    clauses.push({
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { legalName: { contains: q, mode: "insensitive" } },
        { ownerName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { slug: { contains: q, mode: "insensitive" } },
        { gstin: { equals: q.toUpperCase() } },
        { pan: { equals: q.toUpperCase() } },
        { id: q },
      ],
    });
  }

  return { AND: clauses };
}

// ---------------------------------------------------------------------------
// Per-page enrichments
// ---------------------------------------------------------------------------

type CommissionRuleLite = { rateBps: number; fixedPaise: number; scope: string; targetKey: string; startsAt: Date | null; endsAt: Date | null };

/**
 * One CommissionRule load for the whole page: SELLER:<id> wins over GLOBAL
 * (B3). Category/product rules are per line and do not belong in a seller
 * column, so the resolved value here is "what this seller's own products
 * default to".
 */
function resolveInMemory(rules: CommissionRuleLite[], sellerId: string, now: Date): SellerListRow["commission"] {
  const live = rules.filter((rule) => (!rule.startsAt || rule.startsAt <= now) && (!rule.endsAt || rule.endsAt >= now));
  const own = live.find((rule) => rule.targetKey === commissionTargetKey("SELLER", sellerId));
  const global = live.find((rule) => rule.targetKey === "GLOBAL");
  const hit = own ?? global;
  return hit
    ? { rateBps: hit.rateBps, fixedPaise: hit.fixedPaise, scope: hit.scope as CommissionScope }
    : { rateBps: 0, fixedPaise: 0, scope: "GLOBAL" };
}

async function distinctOrderCounts(sellerIds: string[]): Promise<Map<string, number>> {
  if (sellerIds.length === 0) return new Map();
  const rows = await db.$queryRaw<Array<{ sellerId: string; orders: bigint | number }>>`
    SELECT "sellerId", COUNT(DISTINCT "orderId") AS orders
    FROM "OrderItem"
    WHERE "sellerId" IN (${Prisma.join(sellerIds)})
    GROUP BY "sellerId"
  `;
  return new Map(rows.map((row) => [row.sellerId, Number(row.orders)]));
}

async function enrichRows(
  sellers: Array<
    Prisma.SellerGetPayload<{ include: { logo: { select: { url: true; thumbnailUrl: true } }; balance: true } }>
  >,
): Promise<SellerListRow[]> {
  const ids = sellers.map((seller) => seller.id);
  if (ids.length === 0) return [];

  const [docGroups, orders, rules, openPayouts] = await Promise.all([
    db.sellerDocument.groupBy({ by: ["sellerId", "status"], where: { sellerId: { in: ids } }, _count: { _all: true } }),
    distinctOrderCounts(ids),
    db.commissionRule.findMany({
      where: { isActive: true, OR: [{ scope: "GLOBAL" }, { scope: "SELLER", sellerId: { in: ids } }] },
      select: { rateBps: true, fixedPaise: true, scope: true, targetKey: true, startsAt: true, endsAt: true },
    }),
    db.sellerPayout.findMany({
      where: { sellerId: { in: ids }, status: { in: [...OPEN_PAYOUT_STATUSES] } },
      select: { id: true, sellerId: true, payoutNumber: true, status: true, netPaise: true },
    }),
  ]);

  const docs = new Map<string, { verified: number; total: number; pending: number }>();
  for (const group of docGroups) {
    const entry = docs.get(group.sellerId) ?? { verified: 0, total: 0, pending: 0 };
    entry.total += group._count._all;
    if (group.status === "VERIFIED") entry.verified += group._count._all;
    if (group.status === "PENDING") entry.pending += group._count._all;
    docs.set(group.sellerId, entry);
  }
  const payoutBySeller = new Map(openPayouts.map((payout) => [payout.sellerId, payout]));
  const now = new Date();

  return sellers.map((seller) => {
    const open = payoutBySeller.get(seller.id);
    return {
      id: seller.id,
      slug: seller.slug,
      displayName: seller.displayName,
      legalName: seller.legalName,
      ownerName: seller.ownerName,
      email: seller.email,
      phone: seller.phone,
      city: seller.city,
      state: seller.state,
      logoUrl: seller.logo?.thumbnailUrl ?? seller.logo?.url ?? null,
      status: seller.status as SellerStatus,
      gstinMasked: maskGstin(seller.gstin),
      registeredAt: seller.createdAt.toISOString(),
      documents: docs.get(seller.id) ?? { verified: 0, total: 0, pending: 0 },
      productCount: seller.productCount,
      publishedProductCount: seller.publishedProductCount,
      orderCount: orders.get(seller.id) ?? 0,
      orderItemCount: seller.orderItemCount,
      grossSalesPaise: seller.grossSalesPaise,
      ratingAvg: seller.ratingAvg,
      reviewCount: seller.reviewCount,
      commission: resolveInMemory(rules, seller.id, now),
      payout: {
        availablePaise: seller.balance?.availablePaise ?? 0,
        pendingPaise: seller.balance?.pendingPaise ?? 0,
        scheduledPaise: seller.balance?.scheduledPaise ?? 0,
        openPayout: open ? { id: open.id, number: open.payoutNumber, status: open.status, netPaise: open.netPaise } : null,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// List, counts, KPIs, filter options
// ---------------------------------------------------------------------------

export async function listSellers(params: ListParams & { sort: SellerSort }, filters: SellerListFilters): Promise<SellerListResult> {
  const where = buildSellerWhere(filters);
  const [sellers, total] = await Promise.all([
    db.seller.findMany({
      where,
      orderBy: orderBy(params.sort, params.order),
      skip: params.skip,
      take: params.pageSize,
      include: { logo: { select: { url: true, thumbnailUrl: true } }, balance: true },
    }),
    db.seller.count({ where }),
  ]);
  return { rows: await enrichRows(sellers), meta: buildPageMeta(total, params) };
}

/** Rows for export: every seller matching the filters, in pages. */
export async function listSellersForExport(filters: SellerListFilters, skip: number, take: number): Promise<SellerListRow[]> {
  const sellers = await db.seller.findMany({
    where: buildSellerWhere(filters),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
    include: { logo: { select: { url: true, thumbnailUrl: true } }, balance: true },
  });
  return enrichRows(sellers);
}

/** Tab counts for the SAME filters minus status, so each tab shows what it would reveal. */
export async function sellerStatusCounts(filters: SellerListFilters): Promise<SellerStatusCounts> {
  const groups = await db.seller.groupBy({
    by: ["status"],
    where: buildSellerWhere(filters, { includeStatus: false }),
    _count: { _all: true },
  });
  const counts = Object.fromEntries(SELLER_STATUSES.map((status) => [status, 0])) as Record<SellerStatus, number>;
  let all = 0;
  for (const group of groups) {
    const status = group.status as SellerStatus;
    if (status in counts) counts[status] = group._count._all;
    all += group._count._all;
  }
  return { ...counts, all };
}

export async function sellerKpis(): Promise<SellerKpis> {
  const [byStatus, gross, balances] = await Promise.all([
    db.seller.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
    db.seller.aggregate({ where: { deletedAt: null }, _sum: { grossSalesPaise: true } }),
    db.sellerBalance.aggregate({
      where: { seller: { deletedAt: null } },
      _sum: { availablePaise: true, scheduledPaise: true, pendingPaise: true },
    }),
  ]);
  const count = (status: SellerStatus) => byStatus.find((group) => group.status === status)?._count._all ?? 0;
  return {
    active: count("ACTIVE"),
    pendingApprovals: count("PENDING") + count("UNDER_REVIEW"),
    suspended: count("SUSPENDED"),
    grossSalesPaise: gross._sum.grossSalesPaise ?? 0,
    payablePaise: (balances._sum.availablePaise ?? 0) + (balances._sum.scheduledPaise ?? 0),
    onHoldPaise: balances._sum.pendingPaise ?? 0,
  };
}

/** Distinct states and cities for the filter selects; small lists, read whole. */
export async function sellerFilterOptions(): Promise<SellerFilterOptions> {
  const rows = await db.seller.findMany({
    where: { deletedAt: null },
    select: { state: true, city: true },
    distinct: ["state", "city"],
  });
  const states = [...new Set(rows.map((row) => row.state).filter((value): value is string => Boolean(value)))].sort();
  const cities = [...new Set(rows.map((row) => row.city).filter((value): value is string => Boolean(value)))].sort();
  return { states, cities };
}
