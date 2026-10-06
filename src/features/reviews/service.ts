import type { Prisma } from "@prisma/client";

import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { constantTimeEqual, hashToken, randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { REVIEW_STATUS_META, type ReviewStatus } from "@/lib/enums";
import { ImageProcessingError, processImageUpload } from "@/lib/images";
import { sanitizeHtml, stripHtml } from "@/lib/sanitize/html";
import { buildStorageKey, getStorage, kindForMime, sniffMime } from "@/lib/storage";
import { emitEvent } from "@/features/notifications/service";
import { ELIGIBLE_PRODUCT_WHERE } from "@/features/storefront/queries/shared";

import { ratingSummary } from "./rating";
import {
  PUBLIC_REVIEW_MAX_IMAGES,
  REVIEW_IMAGE_MAX_BYTES,
  REVIEW_IMAGE_MIME_TYPES,
  type BulkReviewInput,
  type PublicReviewValues,
  type ReviewPatchValues,
  type TestimonialValues,
} from "./schemas";

/**
 * Business rules for reviews and testimonials (blueprint §1 Reviews, §4.8,
 * §14.D6, D9, D12, E3). Pure of `server-only` / `next/*` so the check script
 * and the seed can call it as plain tsx; the actions and REST handlers are
 * thin wrappers.
 *
 * The one invariant everything here protects: `Product.ratingAvg/reviewCount`
 * and `Seller.ratingAvg/reviewCount` are derived from APPROVED reviews only,
 * and are recomputed inside the same transaction as any status change or
 * deletion so the storefront never shows a rating a moderator just rejected.
 */

type Db = Prisma.TransactionClient;
export type ReviewActor = AuditActor;
type ClientInfo = { ip?: string | null; reason?: string | null };

const REVIEW_SELECT = {
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
  repliedAt: true,
  repliedById: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ReviewSelect;

export type ReviewRecord = Prisma.ReviewGetPayload<{ select: typeof REVIEW_SELECT }>;

function actorId(actor: ReviewActor): string | null {
  return actor.id === "system" ? null : actor.id;
}

function labelOf(review: { authorName: string; title: string | null }): string {
  return review.title ? `${review.authorName}: ${review.title}` : review.authorName;
}

async function requireReview(tx: Db, id: string): Promise<ReviewRecord> {
  const review = await tx.review.findUnique({ where: { id }, select: REVIEW_SELECT });
  if (!review) throw notFound("Review");
  return review;
}

// ---------------------------------------------------------------------------
// Rating recompute (exported for the products/sellers/orders modules)
// ---------------------------------------------------------------------------

export type RecomputeRatingsResult = {
  product: { id: string; ratingAvg: number; reviewCount: number } | null;
  seller: { id: string; ratingAvg: number; reviewCount: number } | null;
};

/**
 * Recompute the denormalised rating columns from APPROVED reviews. Pass the
 * ids you touched; missing/null targets are skipped. Testimonials without a
 * product never count towards anything.
 */
export async function recomputeRatings(
  tx: Db,
  target: { productId?: string | null; sellerId?: string | null },
): Promise<RecomputeRatingsResult> {
  const result: RecomputeRatingsResult = { product: null, seller: null };

  if (target.productId) {
    const rows = await tx.review.findMany({
      where: { productId: target.productId, status: "APPROVED" },
      select: { rating: true },
    });
    const summary = ratingSummary(rows.map((row) => row.rating));
    const exists = await tx.product.findUnique({ where: { id: target.productId }, select: { id: true } });
    if (exists) {
      await tx.product.update({ where: { id: target.productId }, data: summary });
      result.product = { id: target.productId, ...summary };
    }
  }

  if (target.sellerId) {
    const rows = await tx.review.findMany({
      where: { sellerId: target.sellerId, status: "APPROVED" },
      select: { rating: true },
    });
    const summary = ratingSummary(rows.map((row) => row.rating));
    const exists = await tx.seller.findUnique({ where: { id: target.sellerId }, select: { id: true } });
    if (exists) {
      await tx.seller.update({ where: { id: target.sellerId }, data: summary });
      result.seller = { id: target.sellerId, ...summary };
    }
  }

  return result;
}

/** Public catalog + content caches show ratings and testimonials. */
async function invalidateReviewCaches(): Promise<void> {
  await invalidatePublic(listTagsFor("review"));
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

export async function setReviewStatus(
  id: string,
  status: ReviewStatus,
  actor: ReviewActor,
  client: ClientInfo = {},
): Promise<ReviewRecord> {
  const updated = await db.$transaction(async (tx) => {
    const before = await requireReview(tx, id);
    if (before.status === status) return before;

    const after = await tx.review.update({ where: { id }, data: { status }, select: REVIEW_SELECT });
    await recomputeRatings(tx, { productId: after.productId, sellerId: after.sellerId });
    await writeAudit(tx, {
      actor,
      action: "review.status_change",
      entityType: "Review",
      entityId: id,
      entityLabel: labelOf(after),
      summary: `Review by ${after.authorName} marked ${REVIEW_STATUS_META[status].label.toLowerCase()}${client.reason ? ` - ${client.reason}` : ""}.`,
      diff: diffOf({ status: before.status }, { status: after.status }),
      ip: client.ip,
    });
    return after;
  });
  await invalidateReviewCaches();
  return updated;
}

export async function setReviewFeatured(
  id: string,
  isFeatured: boolean,
  actor: ReviewActor,
  client: ClientInfo = {},
): Promise<ReviewRecord> {
  const updated = await db.$transaction(async (tx) => {
    const before = await requireReview(tx, id);
    if (before.isFeatured === isFeatured) return before;
    const after = await tx.review.update({ where: { id }, data: { isFeatured }, select: REVIEW_SELECT });
    await writeAudit(tx, {
      actor,
      action: "review.feature",
      entityType: "Review",
      entityId: id,
      entityLabel: labelOf(after),
      summary: `${isFeatured ? "Featured" : "Unfeatured"} review by ${after.authorName}.`,
      diff: diffOf({ isFeatured: before.isFeatured }, { isFeatured }),
      ip: client.ip,
    });
    return after;
  });
  await invalidateReviewCaches();
  return updated;
}

/**
 * The public reply under a review. Sanitised with the `basic` profile: a
 * moderator may paste a link or bold a word, nothing more. `null` clears it.
 */
export async function replyToReview(
  id: string,
  reply: string | null,
  actor: ReviewActor,
  client: ClientInfo = {},
): Promise<ReviewRecord> {
  const clean = reply === null ? null : sanitizeHtml(reply, "basic").trim();
  if (reply !== null && !clean) throw badRequest("The reply is empty after removing unsupported markup.", { reply: "Empty." });

  const updated = await db.$transaction(async (tx) => {
    const before = await requireReview(tx, id);
    const after = await tx.review.update({
      where: { id },
      data: clean
        ? { reply: clean, repliedAt: new Date(), repliedById: actorId(actor) }
        : { reply: null, repliedAt: null, repliedById: null },
      select: REVIEW_SELECT,
    });
    await writeAudit(tx, {
      actor,
      action: "review.reply",
      entityType: "Review",
      entityId: id,
      entityLabel: labelOf(after),
      summary: clean ? `Replied to the review by ${after.authorName}.` : `Removed the reply on the review by ${after.authorName}.`,
      diff: diffOf({ reply: before.reply }, { reply: after.reply }),
      ip: client.ip,
    });
    return after;
  });
  await invalidateReviewCaches();
  return updated;
}

/** Edit fields (testimonial editor, REST PUT). Status changes recompute ratings. */
export async function updateReview(
  id: string,
  patch: ReviewPatchValues,
  actor: ReviewActor,
  client: ClientInfo = {},
): Promise<ReviewRecord> {
  const updated = await db.$transaction(async (tx) => {
    const before = await requireReview(tx, id);
    const data: Prisma.ReviewUpdateInput = {};
    if (patch.authorName !== undefined) data.authorName = patch.authorName;
    if (patch.authorLocation !== undefined) data.authorLocation = patch.authorLocation;
    if (patch.rating !== undefined) data.rating = patch.rating;
    if (patch.title !== undefined) data.title = patch.title ? stripHtml(patch.title) : null;
    if (patch.body !== undefined) data.body = sanitizeHtml(patch.body, "basic");
    if (patch.isFeatured !== undefined) data.isFeatured = patch.isFeatured;
    if (patch.isTestimonial !== undefined) data.isTestimonial = patch.isTestimonial;
    if (patch.position !== undefined) data.position = patch.position;
    if (patch.status !== undefined) data.status = patch.status;

    const after = await tx.review.update({ where: { id }, data, select: REVIEW_SELECT });
    if (before.status !== after.status || before.rating !== after.rating) {
      await recomputeRatings(tx, { productId: after.productId, sellerId: after.sellerId });
    }
    await writeAudit(tx, {
      actor,
      action: "review.update",
      entityType: "Review",
      entityId: id,
      entityLabel: labelOf(after),
      summary: `Edited the ${after.isTestimonial ? "testimonial" : "review"} by ${after.authorName}.`,
      diff: diffOf(
        { ...before, createdAt: undefined, updatedAt: undefined },
        { ...after, createdAt: undefined, updatedAt: undefined },
      ),
      ip: client.ip,
    });
    return after;
  });
  await invalidateReviewCaches();
  return updated;
}

/**
 * Hard delete. Reviews carry no money and no legal retention requirement, and
 * a spam review that keeps existing as "REJECTED" still shows up in every
 * count. The audit row keeps the text for the record.
 */
export async function deleteReview(id: string, actor: ReviewActor, client: ClientInfo = {}): Promise<{ id: string }> {
  await db.$transaction(async (tx) => {
    const review = await requireReview(tx, id);
    await tx.review.delete({ where: { id } });
    await recomputeRatings(tx, { productId: review.productId, sellerId: review.sellerId });
    await writeAudit(tx, {
      actor,
      action: "review.delete",
      entityType: "Review",
      entityId: id,
      entityLabel: labelOf(review),
      summary: `Deleted the ${review.isTestimonial ? "testimonial" : "review"} by ${review.authorName}${client.reason ? ` - ${client.reason}` : ""}.`,
      diff: diffOf(null, { ...review, createdAt: review.createdAt.toISOString(), updatedAt: review.updatedAt.toISOString() }),
      ip: client.ip,
    });
  });
  await invalidateReviewCaches();
  return { id };
}

export type BulkReviewResult = { op: BulkReviewInput["op"]; requested: number; affected: number; skipped: number };

/** One transaction; each touched product/seller is recomputed once (D13: audited with id count). */
export async function bulkReviews(input: BulkReviewInput, actor: ReviewActor, client: ClientInfo = {}): Promise<BulkReviewResult> {
  const ids = [...new Set(input.ids)];
  const result = await db.$transaction(async (tx) => {
    const rows = await tx.review.findMany({ where: { id: { in: ids } }, select: { id: true, productId: true, sellerId: true, status: true } });
    const targetStatus: ReviewStatus | null = input.op === "approve" ? "APPROVED" : input.op === "reject" ? "REJECTED" : null;

    const affectedIds = rows.filter((row) => (targetStatus ? row.status !== targetStatus : true)).map((row) => row.id);
    if (affectedIds.length > 0) {
      if (targetStatus) {
        await tx.review.updateMany({ where: { id: { in: affectedIds } }, data: { status: targetStatus } });
      } else {
        await tx.review.deleteMany({ where: { id: { in: affectedIds } } });
      }
    }

    const productIds = new Set(rows.map((row) => row.productId).filter((v): v is string => Boolean(v)));
    const sellerIds = new Set(rows.map((row) => row.sellerId).filter((v): v is string => Boolean(v)));
    for (const productId of productIds) await recomputeRatings(tx, { productId });
    for (const sellerId of sellerIds) await recomputeRatings(tx, { sellerId });

    await writeAudit(tx, {
      actor,
      action: `review.bulk_${input.op}`,
      entityType: "Review",
      summary: `Bulk ${input.op}: ${affectedIds.length} of ${ids.length} review(s)${input.reason ? ` - ${input.reason}` : ""}.`,
      diff: { op: input.op, requested: ids.length, affected: affectedIds.length, ids: affectedIds.slice(0, 200) },
      ip: client.ip,
    });

    return { op: input.op, requested: ids.length, affected: affectedIds.length, skipped: ids.length - affectedIds.length };
  });
  await invalidateReviewCaches();
  return result;
}

// ---------------------------------------------------------------------------
// Testimonials
// ---------------------------------------------------------------------------

/** A hand-entered quote for the homepage `testimonials` section (E1). */
export async function createTestimonial(input: TestimonialValues, actor: ReviewActor, client: ClientInfo = {}): Promise<ReviewRecord> {
  const created = await db.$transaction(async (tx) => {
    const review = await tx.review.create({
      data: {
        authorName: input.authorName,
        authorLocation: input.authorLocation,
        body: sanitizeHtml(input.body, "basic"),
        rating: input.rating ?? null,
        position: input.position,
        isFeatured: input.isFeatured,
        isTestimonial: true,
        status: input.status,
      },
      select: REVIEW_SELECT,
    });
    await writeAudit(tx, {
      actor,
      action: "review.testimonial_create",
      entityType: "Review",
      entityId: review.id,
      entityLabel: review.authorName,
      summary: `Added a testimonial by ${review.authorName}.`,
      diff: diffOf(null, { authorName: review.authorName, authorLocation: review.authorLocation, rating: review.rating, status: review.status }),
      ip: client.ip,
    });
    return review;
  });
  await invalidateReviewCaches();
  return created;
}

// ---------------------------------------------------------------------------
// Public intake (D6, D9, E3)
// ---------------------------------------------------------------------------

export const REVIEW_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const REVIEW_MEDIA_FOLDER = "reviews";
export const REVIEW_SUBMITTED_MESSAGE = "Thank you! Your review will appear once it has been approved.";

/**
 * Store a shopper's review photo as a PUBLIC pending object and hand back an
 * opaque token. Public (not PRIVATE like KYC/customisation files) because an
 * approved review shows the photo to everyone; until the review exists the
 * URL is unguessable and the purge job removes it after 24 h.
 */
export async function createPendingReviewUpload(input: {
  buffer: Buffer;
  filename: string;
  ip: string | null;
}): Promise<{ uploadToken: string; expiresAt: Date; filename: string }> {
  if (input.buffer.byteLength === 0) throw badRequest("The file is empty.", { file: "Empty." });
  if (input.buffer.byteLength > REVIEW_IMAGE_MAX_BYTES) throw badRequest("The image must be 5 MB or smaller.", { file: "Too large." });

  const allowed = new Set<string>(REVIEW_IMAGE_MIME_TYPES);
  const detected = sniffMime(input.buffer);
  if (!detected || !allowed.has(detected)) throw badRequest("Only JPEG, PNG and WebP photos are accepted.", { file: "Unsupported type." });

  let processed;
  try {
    processed = await processImageUpload(input.buffer, { thumbnail: false });
  } catch (error) {
    if (error instanceof ImageProcessingError) throw badRequest(error.message, { file: error.code });
    throw error;
  }
  if (!allowed.has(processed.mimeType)) throw badRequest("Only JPEG, PNG and WebP photos are accepted.", { file: "Unsupported type." });

  const storage = await getStorage();
  const storageKey = buildStorageKey({ folder: `${REVIEW_MEDIA_FOLDER}/pending`, ext: processed.ext });
  await storage.put({ key: storageKey, body: processed.buffer, contentType: processed.mimeType, visibility: "PUBLIC" });

  const expiresAt = new Date(Date.now() + REVIEW_UPLOAD_TTL_MS);
  const pending = await db.pendingUpload.create({
    data: {
      token: randomToken(32),
      storageKey,
      mimeType: processed.mimeType,
      sizeBytes: processed.buffer.byteLength,
      ip: input.ip,
      expiresAt,
    },
    select: { token: true },
  });
  return { uploadToken: pending.token, expiresAt, filename: input.filename.slice(0, 120) };
}

async function ensureFolder(tx: Db, path: string): Promise<string> {
  const existing = await tx.mediaFolder.findUnique({ where: { path }, select: { id: true } });
  if (existing) return existing.id;
  const created = await tx.mediaFolder.create({ data: { path, name: path, parentId: null }, select: { id: true } });
  return created.id;
}

/** PendingUpload tokens -> PUBLIC MediaAsset rows filed under `reviews/`; the object keeps its key. */
async function exchangeReviewUploads(tx: Db, tokens: readonly string[], now: Date): Promise<Array<{ mediaId: string; url: string }>> {
  const unique = [...new Set(tokens)];
  if (unique.length === 0) return [];
  const rows = await tx.pendingUpload.findMany({ where: { token: { in: unique } } });
  if (rows.length !== unique.length) throw badRequest("One of the photos is no longer available. Please upload it again.", { images: "Unknown upload token." });
  if (rows.some((row) => row.expiresAt <= now)) throw badRequest("One of the photos has expired. Please upload it again.", { images: "Expired upload token." });

  const storage = await getStorage();
  const folderId = await ensureFolder(tx, REVIEW_MEDIA_FOLDER);
  const results: Array<{ mediaId: string; url: string }> = [];
  for (const token of unique) {
    const pending = rows.find((row) => row.token === token)!;
    const url = storage.publicUrl(pending.storageKey);
    const asset = await tx.mediaAsset.create({
      data: {
        url,
        storageKey: pending.storageKey,
        storageProvider: storage.driver,
        visibility: "PUBLIC",
        filename: `review-${token.slice(0, 8)}.${pending.storageKey.split(".").pop() ?? "jpg"}`,
        kind: kindForMime(pending.mimeType),
        mimeType: pending.mimeType,
        sizeBytes: pending.sizeBytes,
        folderId,
      },
      select: { id: true, url: true },
    });
    await tx.pendingUpload.delete({ where: { id: pending.id } });
    results.push({ mediaId: asset.id, url: asset.url });
  }
  return results;
}

export type SubmitReviewResult = { id: string; isVerifiedPurchase: boolean; message: string };

/**
 * POST /api/v1/products/:slug/reviews. Lands as PENDING; a matching order
 * number + the checkout access token marks it a verified purchase and links
 * the order line and customer. Anything else is an anonymous review.
 */
export async function submitPublicReview(input: { slug: string; values: PublicReviewValues; ip: string | null }): Promise<SubmitReviewResult> {
  const { values } = input;
  if (values.website && values.website.trim() !== "") {
    // Honeypot tripped: answer as if accepted so the bot learns nothing.
    return { id: "", isVerifiedPurchase: false, message: REVIEW_SUBMITTED_MESSAGE };
  }

  const product = await db.product.findFirst({
    where: { slug: input.slug, ...ELIGIBLE_PRODUCT_WHERE },
    select: { id: true, title: true, sellerId: true },
  });
  if (!product) throw notFound("Product");

  const now = new Date();
  let orderItemId: string | null = null;
  let customerId: string | null = null;

  if (values.orderNumber && values.token) {
    const order = await db.order.findUnique({
      where: { orderNumber: values.orderNumber.toUpperCase() },
      select: { id: true, customerId: true, accessTokenHash: true, items: { where: { productId: product.id }, select: { id: true }, take: 1 } },
    });
    if (order && constantTimeEqual(hashToken(values.token), order.accessTokenHash) && order.items[0]) {
      orderItemId = order.items[0].id;
      customerId = order.customerId;
    }
  }

  if (orderItemId) {
    const existing = await db.review.findUnique({ where: { orderItemId }, select: { id: true } });
    if (existing) throw conflict("This purchase has already been reviewed.");
  }

  const images = (values.images ?? []).slice(0, PUBLIC_REVIEW_MAX_IMAGES);

  const review = await db.$transaction(async (tx) => {
    const exchanged = await exchangeReviewUploads(tx, images, now);
    const created = await tx.review.create({
      data: {
        productId: product.id,
        sellerId: product.sellerId,
        customerId,
        orderItemId,
        authorName: stripHtml(values.authorName),
        rating: values.rating,
        title: values.title ? stripHtml(values.title) : null,
        body: sanitizeHtml(values.body, "basic"),
        status: "PENDING",
        isVerifiedPurchase: Boolean(orderItemId),
        images: {
          create: exchanged.map((image, index) => ({ mediaId: image.mediaId, url: image.url, position: index })),
        },
      },
      select: { id: true },
    });
    await emitEvent(
      "review.created",
      { reviewId: created.id, productId: product.id, productTitle: product.title, rating: values.rating, authorName: values.authorName },
      tx,
    );
    return created;
  });

  return { id: review.id, isVerifiedPurchase: Boolean(orderItemId), message: REVIEW_SUBMITTED_MESSAGE };
}
