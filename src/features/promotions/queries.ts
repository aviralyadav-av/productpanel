import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";
import { hydrateEntityRefs } from "@/features/coupons/queries";
import { toPickedAsset } from "@/features/media/dto";
import { getMediaAsset } from "@/features/media/queries";

import {
  derivePromotionStatus,
  type AffectedProductRow,
  type PromotionEditorData,
  type PromotionListFilters,
  type PromotionRow,
  type PromotionSort,
  type PromotionStatus,
} from "./schemas";

/**
 * Read side of promotions. Status is derived from `isActive` + the window, so
 * every filter is a plain Prisma `where`; "affected products" counts rows
 * whose `activePromotionId` points here - the A4 column the catalog maintains.
 */

type Db = Prisma.TransactionClient;

const SORT_COLUMN: Record<PromotionSort, keyof Prisma.PromotionOrderByWithRelationInput> = {
  name: "name",
  type: "type",
  value: "value",
  priority: "priority",
  startsAt: "startsAt",
  endsAt: "endsAt",
  updatedAt: "updatedAt",
};

function statusWhere(status: PromotionStatus, now: Date): Prisma.PromotionWhereInput {
  switch (status) {
    case "DISABLED":
      return { isActive: false };
    case "SCHEDULED":
      return { isActive: true, startsAt: { gt: now } };
    case "EXPIRED":
      return { isActive: true, endsAt: { lt: now } };
    case "ACTIVE":
    default:
      return { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } };
  }
}

export function buildPromotionWhere(filters: PromotionListFilters & { q?: string }, now: Date, options: { includeStatus?: boolean } = {}): Prisma.PromotionWhereInput {
  const clauses: Prisma.PromotionWhereInput[] = [];
  if ((options.includeStatus ?? true) && filters.status) clauses.push(statusWhere(filters.status, now));
  if (filters.type) clauses.push({ type: filters.type });
  if (filters.fundedBy) clauses.push({ fundedBy: filters.fundedBy });
  if (filters.q) {
    clauses.push({
      OR: [
        { name: { contains: filters.q, mode: "insensitive" } },
        { slug: { contains: filters.q, mode: "insensitive" } },
        { badgeText: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }
  return clauses.length > 0 ? { AND: clauses } : {};
}

async function scopeLabels(
  client: Db,
  rows: ReadonlyArray<{ appliesTo: string; categoryIds: string[]; productIds: string[]; sellerIds: string[] }>,
): Promise<(row: (typeof rows)[number]) => { scopeCount: number; scopeLabel: string }> {
  const singles = (kind: string, pick: (row: (typeof rows)[number]) => string[]) =>
    [...new Set(rows.filter((row) => row.appliesTo === kind && pick(row).length === 1).flatMap(pick))];
  const [categories, products, sellers] = await Promise.all([
    client.category.findMany({ where: { id: { in: singles("CATEGORIES", (r) => r.categoryIds) } }, select: { id: true, name: true } }),
    client.product.findMany({ where: { id: { in: singles("PRODUCTS", (r) => r.productIds) } }, select: { id: true, title: true } }),
    client.seller.findMany({ where: { id: { in: singles("SELLERS", (r) => r.sellerIds) } }, select: { id: true, displayName: true } }),
  ]);
  const names = {
    category: new Map(categories.map((row) => [row.id, row.name])),
    product: new Map(products.map((row) => [row.id, row.title])),
    seller: new Map(sellers.map((row) => [row.id, row.displayName])),
  };
  const label = (ids: string[], map: Map<string, string>, noun: string, pluralNoun: string) =>
    ids.length === 1 ? (map.get(ids[0]) ?? `1 ${noun}`) : `${ids.length} ${pluralNoun}`;
  return (row) => {
    switch (row.appliesTo) {
      case "CATEGORIES":
        return { scopeCount: row.categoryIds.length, scopeLabel: label(row.categoryIds, names.category, "category", "categories") };
      case "PRODUCTS":
        return { scopeCount: row.productIds.length, scopeLabel: label(row.productIds, names.product, "product", "products") };
      case "SELLERS":
        return { scopeCount: row.sellerIds.length, scopeLabel: label(row.sellerIds, names.seller, "seller", "sellers") };
      default:
        return { scopeCount: 0, scopeLabel: "Whole catalogue" };
    }
  };
}

export type PromotionListResult = { rows: PromotionRow[]; meta: PageMeta; statusCounts: Record<PromotionStatus, number> };

export async function listPromotions(
  params: ListParams & { sort: PromotionSort },
  filters: PromotionListFilters,
  now: Date = new Date(),
): Promise<PromotionListResult> {
  const where = buildPromotionWhere({ ...filters, q: params.q }, now);
  const base = buildPromotionWhere({ ...filters, q: params.q }, now, { includeStatus: false });

  const [total, rows, active, scheduled, expired, disabled] = await Promise.all([
    db.promotion.count({ where }),
    db.promotion.findMany({
      where,
      orderBy: [{ [SORT_COLUMN[params.sort]]: params.order }, { id: "asc" }],
      skip: params.skip,
      take: params.pageSize,
      include: { _count: { select: { activeOnProducts: true } } },
    }),
    ...(["ACTIVE", "SCHEDULED", "EXPIRED", "DISABLED"] as PromotionStatus[]).map((status) =>
      db.promotion.count({ where: { AND: [base, statusWhere(status, now)] } }),
    ),
  ]);

  const scope = await scopeLabels(db, rows);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      type: row.type as PromotionRow["type"],
      discountType: row.discountType as PromotionRow["discountType"],
      value: row.value,
      appliesTo: row.appliesTo as PromotionRow["appliesTo"],
      ...scope(row),
      badgeText: row.badgeText,
      priority: row.priority,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      isActive: row.isActive,
      fundedBy: row.fundedBy as PromotionRow["fundedBy"],
      status: derivePromotionStatus(row, now),
      affectedProducts: row._count.activeOnProducts,
      updatedAt: row.updatedAt,
    })),
    meta: buildPageMeta(total, params),
    statusCounts: { ACTIVE: active, SCHEDULED: scheduled, EXPIRED: expired, DISABLED: disabled },
  };
}

export async function getPromotionEditor(id: string, now: Date = new Date()): Promise<PromotionEditorData | null> {
  const row = await db.promotion.findUnique({ where: { id }, include: { _count: { select: { activeOnProducts: true } } } });
  if (!row) return null;
  const [categories, products, sellers, banner] = await Promise.all([
    hydrateEntityRefs("category", row.categoryIds),
    hydrateEntityRefs("product", row.productIds),
    hydrateEntityRefs("seller", row.sellerIds),
    row.bannerMediaId ? getMediaAsset(row.bannerMediaId) : Promise.resolve(null),
  ]);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    type: row.type as PromotionEditorData["type"],
    discountType: row.discountType as PromotionEditorData["discountType"],
    value: row.value,
    appliesTo: row.appliesTo as PromotionEditorData["appliesTo"],
    categories,
    products,
    sellers,
    badgeText: row.badgeText,
    bannerMedia: banner ? toPickedAsset(banner) : null,
    priority: row.priority,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    isActive: row.isActive,
    fundedBy: row.fundedBy as PromotionEditorData["fundedBy"],
    status: derivePromotionStatus(row, now),
    affectedProducts: row._count.activeOnProducts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Products in the promotion's scope (plus any still carrying it), flagged by whether it actually wins on them. */
export async function listAffectedProducts(promotionId: string, params: ListParams): Promise<{ rows: AffectedProductRow[]; meta: PageMeta } | null> {
  const promotion = await db.promotion.findUnique({ where: { id: promotionId } });
  if (!promotion) return null;

  const scoped: Prisma.ProductWhereInput[] = [{ activePromotionId: promotionId }];
  switch (promotion.appliesTo) {
    case "PRODUCTS":
      scoped.push({ id: { in: promotion.productIds } });
      break;
    case "SELLERS":
      scoped.push({ sellerId: { in: promotion.sellerIds } });
      break;
    case "CATEGORIES": {
      const categories = await db.category.findMany({ where: { id: { in: promotion.categoryIds } }, select: { path: true } });
      for (const category of categories) scoped.push({ categoryPath: category.path }, { categoryPath: { startsWith: `${category.path}/` } });
      break;
    }
    default:
      scoped.push({});
  }

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    OR: scoped,
    ...(params.q ? { title: { contains: params.q, mode: "insensitive" } } : {}),
  };

  const [total, rows] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy: [{ activePromotionId: "desc" }, { title: "asc" }, { id: "asc" }],
      skip: params.skip,
      take: params.pageSize,
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        pricePaise: true,
        effectivePricePaise: true,
        promotionPricePaise: true,
        activePromotionId: true,
        activePromotion: { select: { name: true } },
        seller: { select: { displayName: true } },
        images: { take: 1, orderBy: { position: "asc" }, select: { media: { select: { thumbnailUrl: true, url: true } } } },
      },
    }),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      status: row.status,
      imageUrl: row.images[0]?.media?.thumbnailUrl ?? row.images[0]?.media?.url ?? null,
      sellerName: row.seller?.displayName ?? null,
      pricePaise: row.pricePaise,
      effectivePricePaise: row.effectivePricePaise,
      promotionPricePaise: row.promotionPricePaise,
      applied: row.activePromotionId === promotionId,
      outrankedBy: row.activePromotionId && row.activePromotionId !== promotionId ? (row.activePromotion?.name ?? "another promotion") : null,
    })),
    meta: buildPageMeta(total, params),
  };
}
