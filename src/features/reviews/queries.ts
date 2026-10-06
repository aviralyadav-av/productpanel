import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { REVIEW_STATUSES, type ReviewStatus } from "@/lib/enums";
import { buildPageMeta, type ListParams } from "@/lib/list-params";

import { roundRating } from "./rating";
import type { ReviewListFilters, ReviewSort } from "./schemas";
import type {
  ReviewDetail,
  ReviewFilterRefs,
  ReviewKpis,
  ReviewListResult,
  ReviewListRow,
  ReviewStatusCounts,
} from "./types";

/**
 * Read side of /admin/reviews. One page of rows plus the product thumbnail,
 * seller name and images fetched through relations in the same query - never
 * a query per row.
 */

const LIST_SELECT = {
  id: true,
  productId: true,
  sellerId: true,
  customerId: true,
  orderItemId: true,
  authorName: true,
  authorLocation: true,
  rating: true,
  title: true,
  body: true,
  status: true,
  isFeatured: true,
  isTestimonial: true,
  isVerifiedPurchase: true,
  reply: true,
  position: true,
  createdAt: true,
  product: {
    select: {
      title: true,
      slug: true,
      images: { orderBy: [{ isPrimary: "desc" }, { position: "asc" }], take: 1, select: { media: { select: { thumbnailUrl: true, url: true } } } },
    },
  },
  seller: { select: { displayName: true } },
  images: { orderBy: { position: "asc" }, select: { id: true, url: true, mediaId: true } },
} satisfies Prisma.ReviewSelect;

type ListRow = Prisma.ReviewGetPayload<{ select: typeof LIST_SELECT }>;

function toRow(row: ListRow): ReviewListRow {
  const media = row.product?.images[0]?.media;
  return {
    id: row.id,
    productId: row.productId,
    productTitle: row.product?.title ?? null,
    productSlug: row.product?.slug ?? null,
    productImageUrl: media?.thumbnailUrl ?? media?.url ?? null,
    sellerId: row.sellerId,
    sellerName: row.seller?.displayName ?? null,
    customerId: row.customerId,
    orderItemId: row.orderItemId,
    authorName: row.authorName,
    authorLocation: row.authorLocation,
    rating: row.rating,
    title: row.title,
    body: row.body,
    images: row.images,
    reply: row.reply,
    isVerifiedPurchase: row.isVerifiedPurchase,
    isFeatured: row.isFeatured,
    isTestimonial: row.isTestimonial,
    status: row.status as ReviewStatus,
    hasReply: Boolean(row.reply),
    position: row.position,
    createdAt: row.createdAt.toISOString(),
  };
}

export function buildReviewWhere(
  filters: ReviewListFilters,
  options: { includeStatus?: boolean; testimonials?: boolean } = {},
): Prisma.ReviewWhereInput {
  const clauses: Prisma.ReviewWhereInput[] = [{ isTestimonial: options.testimonials ?? false }];

  if ((options.includeStatus ?? true) && filters.status) clauses.push({ status: filters.status });
  if (filters.rating) clauses.push({ rating: filters.rating });
  if (filters.productId) clauses.push({ productId: filters.productId });
  if (filters.sellerId) clauses.push({ sellerId: filters.sellerId });
  if (filters.customerId) clauses.push({ customerId: filters.customerId });
  if (filters.verified !== undefined) clauses.push({ isVerifiedPurchase: filters.verified });
  if (filters.featured !== undefined) clauses.push({ isFeatured: filters.featured });
  if (filters.hasImages !== undefined) clauses.push(filters.hasImages ? { images: { some: {} } } : { images: { none: {} } });
  if (filters.from || filters.to) clauses.push({ createdAt: { gte: filters.from, lte: filters.to } });

  if (filters.q) {
    const q = filters.q;
    clauses.push({
      OR: [
        { authorName: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { body: { contains: q, mode: "insensitive" } },
        { product: { title: { contains: q, mode: "insensitive" } } },
        { id: q },
      ],
    });
  }

  return { AND: clauses };
}

function orderBy(sort: ReviewSort, order: "asc" | "desc"): Prisma.ReviewOrderByWithRelationInput[] {
  switch (sort) {
    case "rating":
      return [{ rating: { sort: order, nulls: "last" } }, { createdAt: "desc" }];
    case "product":
      return [{ product: { title: order } }, { createdAt: "desc" }];
    case "author":
      return [{ authorName: order }, { createdAt: "desc" }];
    case "status":
      return [{ status: order }, { createdAt: "desc" }];
    default:
      return [{ createdAt: order }, { id: order }];
  }
}

export async function listReviews(params: ListParams & { sort: ReviewSort }, filters: ReviewListFilters): Promise<ReviewListResult> {
  const where = buildReviewWhere(filters);
  const [total, rows] = await Promise.all([
    db.review.count({ where }),
    db.review.findMany({ where, orderBy: orderBy(params.sort, params.order), skip: params.skip, take: params.pageSize, select: LIST_SELECT }),
  ]);
  return { rows: rows.map(toRow), meta: buildPageMeta(total, params) };
}

/** Testimonials keep their own ordering (position) because the homepage shows them in that order. */
export async function listTestimonials(params: ListParams, filters: ReviewListFilters): Promise<ReviewListResult> {
  const where = buildReviewWhere(filters, { testimonials: true });
  const [total, rows] = await Promise.all([
    db.review.count({ where }),
    db.review.findMany({ where, orderBy: [{ position: "asc" }, { createdAt: "desc" }], skip: params.skip, take: params.pageSize, select: LIST_SELECT }),
  ]);
  return { rows: rows.map(toRow), meta: buildPageMeta(total, params) };
}

export async function reviewStatusCounts(filters: ReviewListFilters, testimonials = false): Promise<ReviewStatusCounts> {
  const grouped = await db.review.groupBy({
    by: ["status"],
    where: buildReviewWhere(filters, { includeStatus: false, testimonials }),
    _count: { _all: true },
  });
  const counts = Object.fromEntries(REVIEW_STATUSES.map((status) => [status, 0])) as Record<ReviewStatus, number>;
  let all = 0;
  for (const row of grouped) {
    if ((REVIEW_STATUSES as readonly string[]).includes(row.status)) counts[row.status as ReviewStatus] = row._count._all;
    all += row._count._all;
  }
  return { ...counts, all };
}

export async function reviewKpis(): Promise<ReviewKpis> {
  const [pending, approved, avg, featured, testimonials] = await Promise.all([
    db.review.count({ where: { status: "PENDING", isTestimonial: false } }),
    db.review.count({ where: { status: "APPROVED", isTestimonial: false } }),
    db.review.aggregate({ where: { status: "APPROVED", isTestimonial: false, rating: { not: null } }, _avg: { rating: true } }),
    // Scoped to product reviews so the tile agrees with where it links (?featured=1
    // lands on the reviews tab); featured testimonials are covered by the tile beside it.
    db.review.count({ where: { isFeatured: true, status: "APPROVED", isTestimonial: false } }),
    db.review.count({ where: { isTestimonial: true, status: "APPROVED" } }),
  ]);
  return { pending, approved, averageRating: roundRating(avg._avg.rating ?? 0), featured, testimonials };
}

export async function getReviewDetail(id: string): Promise<ReviewDetail | null> {
  const row = await db.review.findUnique({
    where: { id },
    select: {
      ...LIST_SELECT,
      repliedAt: true,
      helpfulCount: true,
      updatedAt: true,
      repliedBy: { select: { name: true, email: true } },
      customer: { select: { id: true, fullName: true, email: true } },
      orderItem: { select: { order: { select: { id: true, orderNumber: true } } } },
    },
  });
  if (!row) return null;

  const audits = await db.auditLog.findMany({
    where: { entityType: "Review", entityId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, action: true, summary: true, actorEmail: true, createdAt: true, actor: { select: { name: true } } },
  });

  return {
    ...toRow(row),
    repliedAt: row.repliedAt?.toISOString() ?? null,
    repliedBy: row.repliedBy?.name ?? row.repliedBy?.email ?? null,
    helpfulCount: row.helpfulCount,
    updatedAt: row.updatedAt.toISOString(),
    order: row.orderItem?.order ?? null,
    customer: row.customer ? { id: row.customer.id, name: row.customer.fullName, email: row.customer.email } : null,
    activity: audits.map((audit) => ({
      id: audit.id,
      action: audit.action,
      summary: audit.summary,
      actor: audit.actor?.name ?? audit.actorEmail,
      at: audit.createdAt.toISOString(),
    })),
  };
}

/** Hydrate the EntityPicker chips for ?product= / ?seller= / ?customer= on first paint. */
export async function getReviewFilterRefs(filters: ReviewListFilters): Promise<ReviewFilterRefs> {
  const [product, seller, customer] = await Promise.all([
    filters.productId
      ? db.product.findUnique({
          where: { id: filters.productId },
          select: {
            id: true,
            title: true,
            slug: true,
            images: { orderBy: [{ isPrimary: "desc" }, { position: "asc" }], take: 1, select: { media: { select: { thumbnailUrl: true, url: true } } } },
          },
        })
      : null,
    filters.sellerId ? db.seller.findUnique({ where: { id: filters.sellerId }, select: { id: true, displayName: true, city: true } }) : null,
    filters.customerId ? db.customer.findUnique({ where: { id: filters.customerId }, select: { id: true, fullName: true, email: true } }) : null,
  ]);
  return {
    product: product
      ? { id: product.id, title: product.title, subtitle: `/${product.slug}`, imageUrl: product.images[0]?.media.thumbnailUrl ?? product.images[0]?.media.url ?? null }
      : null,
    seller: seller ? { id: seller.id, title: seller.displayName, subtitle: seller.city ?? undefined } : null,
    customer: customer ? { id: customer.id, title: customer.fullName ?? customer.email, subtitle: customer.email } : null,
  };
}
