import type { ReviewStatus } from "@/lib/enums";
import type { PageMeta } from "@/lib/list-params";

/** Client-safe read models for the reviews module. Dates are ISO strings. */

export type ReviewImageRef = { id: string; url: string; mediaId: string | null };

export type ReviewListRow = {
  id: string;
  productId: string | null;
  productTitle: string | null;
  productSlug: string | null;
  productImageUrl: string | null;
  sellerId: string | null;
  sellerName: string | null;
  customerId: string | null;
  orderItemId: string | null;
  authorName: string;
  authorLocation: string | null;
  rating: number | null;
  title: string | null;
  body: string;
  images: ReviewImageRef[];
  /** The stored (already sanitised) public reply, so the table can prefill its editor. */
  reply: string | null;
  isVerifiedPurchase: boolean;
  isFeatured: boolean;
  isTestimonial: boolean;
  status: ReviewStatus;
  hasReply: boolean;
  position: number;
  createdAt: string;
};

export type ReviewListResult = { rows: ReviewListRow[]; meta: PageMeta };

export type ReviewStatusCounts = Record<ReviewStatus, number> & { all: number };

export type ReviewKpis = {
  pending: number;
  approved: number;
  averageRating: number;
  featured: number;
  testimonials: number;
};

export type ReviewActivityRow = {
  id: string;
  action: string;
  summary: string;
  actor: string;
  at: string;
};

export type ReviewDetail = ReviewListRow & {
  repliedAt: string | null;
  repliedBy: string | null;
  helpfulCount: number;
  updatedAt: string;
  order: { id: string; orderNumber: string } | null;
  customer: { id: string; name: string | null; email: string } | null;
  activity: ReviewActivityRow[];
};

export type EntityChip = { id: string; title: string; subtitle?: string; imageUrl?: string | null };

export type ReviewFilterRefs = {
  product: EntityChip | null;
  seller: EntityChip | null;
  customer: EntityChip | null;
};
