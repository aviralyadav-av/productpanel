import "dotenv/config";

import sharp from "sharp";

import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { ELIGIBLE_PRODUCT_WHERE } from "@/features/storefront/queries/shared";

import { ratingSummary } from "@/features/reviews/rating";
import {
  bulkReviews,
  createPendingReviewUpload,
  createTestimonial,
  deleteReview,
  recomputeRatings,
  replyToReview,
  setReviewFeatured,
  setReviewStatus,
  submitPublicReview,
} from "@/features/reviews/service";

/**
 * End-to-end check against the REAL database:
 *
 *   npx tsx src/features/reviews/__checks__/reviews-check.ts
 *
 * Creates `check_` reviews on a demo product, approves one and asserts the
 * product's ratingAvg/reviewCount move exactly as ratingSummary predicts,
 * replies, features, bulk-rejects, deletes and finally verifies the product
 * is back to its starting numbers. Every row it creates is removed.
 */

const STAMP = Date.now();
const ACTOR = { id: "system", email: "system@diybaazar.local" };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

async function productRating(productId: string) {
  const product = await db.product.findUniqueOrThrow({ where: { id: productId }, select: { ratingAvg: true, reviewCount: true } });
  return product;
}

async function expected(productId: string) {
  const rows = await db.review.findMany({ where: { productId, status: "APPROVED" }, select: { rating: true } });
  return ratingSummary(rows.map((row) => row.rating));
}

async function main(): Promise<void> {
  // Eligible (not merely published) because the public intake refuses anything
  // the storefront would not show - the same rule, from the same helper.
  const product = await db.product.findFirst({
    where: { AND: [ELIGIBLE_PRODUCT_WHERE, { id: { startsWith: "demo_" } }] },
    orderBy: { reviewCount: "desc" },
    select: { id: true, title: true, slug: true, sellerId: true },
  });
  assert(product, "an eligible demo product exists (run the seed first)");

  const created: string[] = [];
  const createdMedia: string[] = [];
  const createdKeys: string[] = [];
  try {
    // Baseline: the stored numbers must already equal the recompute (seed consistency).
    await db.$transaction((tx) => recomputeRatings(tx, { productId: product.id, sellerId: product.sellerId }));
    const start = await productRating(product.id);
    const startExpected = await expected(product.id);
    assert(start.reviewCount === startExpected.reviewCount && start.ratingAvg === startExpected.ratingAvg, "baseline recompute is stable");

    const pending = await db.review.create({
      data: {
        id: `check_review_${STAMP}`,
        productId: product.id,
        sellerId: product.sellerId,
        authorName: "Check Bot",
        rating: 1,
        title: "check",
        body: "Automated check review - should be deleted.",
        status: "PENDING",
      },
    });
    created.push(pending.id);

    // PENDING must not count.
    const afterPending = await productRating(product.id);
    assert(afterPending.reviewCount === start.reviewCount, "pending review does not change reviewCount");

    // Approve -> counts and the average drops (rating 1).
    await setReviewStatus(pending.id, "APPROVED", ACTOR);
    const afterApprove = await productRating(product.id);
    const approveExpected = await expected(product.id);
    assert(afterApprove.reviewCount === start.reviewCount + 1, `approve increments reviewCount (${afterApprove.reviewCount} vs ${start.reviewCount + 1})`);
    assert(afterApprove.ratingAvg === approveExpected.ratingAvg, `approve recomputes ratingAvg (${afterApprove.ratingAvg} vs ${approveExpected.ratingAvg})`);
    if (start.reviewCount > 0) assert(afterApprove.ratingAvg <= start.ratingAvg, "a 1-star review cannot raise the average");

    // Reply + feature.
    const replied = await replyToReview(pending.id, "Thanks <b>a lot</b><script>alert(1)</script>", ACTOR);
    assert(replied.reply && !replied.reply.includes("<script"), "reply is sanitised");
    assert(replied.repliedAt !== null, "repliedAt set");
    const featured = await setReviewFeatured(pending.id, true, ACTOR);
    assert(featured.isFeatured, "featured flag set");

    // Bulk reject -> back to the starting numbers.
    const bulk = await bulkReviews({ ids: [pending.id], op: "reject" }, ACTOR);
    assert(bulk.affected === 1, "bulk reject affected one row");
    const afterReject = await productRating(product.id);
    assert(afterReject.reviewCount === start.reviewCount && afterReject.ratingAvg === start.ratingAvg, "reject restores the starting rating");

    // Approve again then delete -> recompute again returns to start.
    await setReviewStatus(pending.id, "APPROVED", ACTOR);
    await deleteReview(pending.id, ACTOR, { reason: "check cleanup" });
    created.splice(created.indexOf(pending.id), 1);
    const afterDelete = await productRating(product.id);
    assert(afterDelete.reviewCount === start.reviewCount && afterDelete.ratingAvg === start.ratingAvg, "delete restores the starting rating");

    // Testimonial: no product, never touches ratings.
    const testimonial = await createTestimonial(
      { authorName: "Check Bot", authorLocation: "Nowhere", body: "Automated testimonial.", rating: 5, position: 999, isFeatured: false, status: "APPROVED" },
      ACTOR,
    );
    created.push(testimonial.id);
    assert(testimonial.isTestimonial && testimonial.productId === null, "testimonial has no product");
    await deleteReview(testimonial.id, ACTOR);
    created.splice(created.indexOf(testimonial.id), 1);

    const audits = await db.auditLog.count({ where: { entityType: "Review", entityId: pending.id } });
    assert(audits >= 5, `audit rows written for the review (${audits})`);

    // ---- public intake (D6 upload tokens, D9, D12) -------------------------
    // A real 8x8 PNG, so the magic-byte sniff and the sharp re-encode both run.
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c2410c" } }).png().toBuffer();
    const upload = await createPendingReviewUpload({ buffer: png, filename: "check-photo.png", ip: "127.0.0.1" });
    assert(upload.uploadToken.length >= 32, "an opaque upload token was issued");
    const pendingUpload = await db.pendingUpload.findUniqueOrThrow({ where: { token: upload.uploadToken } });
    createdKeys.push(pendingUpload.storageKey);
    assert(pendingUpload.storageKey.startsWith("reviews/pending/"), `the photo is filed under reviews/pending (${pendingUpload.storageKey})`);
    assert((await (await getStorage()).exists(pendingUpload.storageKey)) === true, "the re-encoded object reached storage");

    // A non-image is refused before anything is written.
    let refused = false;
    try {
      await createPendingReviewUpload({ buffer: Buffer.from("<?php echo 1; ?>"), filename: "shell.php.png", ip: "127.0.0.1" });
    } catch {
      refused = true;
    }
    assert(refused, "a file that is not a real image is refused by magic bytes");

    const submitted = await submitPublicReview({
      slug: product.slug,
      values: {
        authorName: "Check Shopper",
        rating: 5,
        body: "Arrived quickly and looks exactly like the photos.",
        images: [upload.uploadToken],
        // A wrong access token must NOT buy a verified-purchase badge.
        orderNumber: "DB10008",
        token: "not-the-real-access-token",
      },
      ip: "127.0.0.1",
    });
    created.push(submitted.id);
    assert(!submitted.isVerifiedPurchase, "a mismatched order token does not mark a verified purchase");

    const publicReview = await db.review.findUniqueOrThrow({
      where: { id: submitted.id },
      select: { status: true, productId: true, sellerId: true, orderItemId: true, customerId: true, images: { select: { mediaId: true, url: true } } },
    });
    assert(publicReview.status === "PENDING", "a submitted review lands as PENDING");
    assert(publicReview.orderItemId === null && publicReview.customerId === null, "no order line or customer is attached without a valid token");
    assert(publicReview.productId === product.id && publicReview.sellerId === product.sellerId, "the review is attached to the product and its seller");
    assert(publicReview.images.length === 1 && publicReview.images[0].mediaId, "the upload token became a ReviewImage backed by a MediaAsset");
    createdMedia.push(publicReview.images[0].mediaId!);
    assert((await db.pendingUpload.count({ where: { token: upload.uploadToken } })) === 0, "the upload token is single-use");
    assert((await productRating(product.id)).reviewCount === start.reviewCount, "a pending public review does not touch the product rating");

    // The honeypot answers exactly like a real submission and stores nothing.
    const reviewsBefore = await db.review.count({ where: { productId: product.id } });
    const trapped = await submitPublicReview({
      slug: product.slug,
      values: { authorName: "Spam Bot", rating: 1, body: "Visit my site for cheap deals.", website: "http://spam.example" },
      ip: "127.0.0.1",
    });
    assert(trapped.message === submitted.message, "the honeypot answer is identical");
    assert((await db.review.count({ where: { productId: product.id } })) === reviewsBefore, "the honeypot submission stored nothing");

    await deleteReview(submitted.id, ACTOR, { reason: "check cleanup" });
    created.splice(created.indexOf(submitted.id), 1);
    assert((await db.reviewImage.count({ where: { reviewId: submitted.id } })) === 0, "deleting a review cascades its images");

    console.log("reviews-check PASSED", {
      product: product.title,
      start,
      afterApprove,
      afterDelete,
      publicIntake: { status: publicReview.status, images: publicReview.images.length, verified: submitted.isVerifiedPurchase },
    });
  } finally {
    if (created.length > 0) await db.review.deleteMany({ where: { id: { in: created } } });
    // The photo's MediaAsset and its object outlive the review row (ReviewImage
    // is SetNull-free but MediaAsset is not cascaded), so remove both by hand.
    if (createdMedia.length > 0) await db.mediaAsset.deleteMany({ where: { id: { in: createdMedia } } }).catch(() => undefined);
    if (createdKeys.length > 0) {
      const storage = await getStorage();
      for (const key of createdKeys) await storage.delete(key, "PUBLIC").catch(() => undefined);
    }
    await db.pendingUpload.deleteMany({ where: { ip: "127.0.0.1", storageKey: { startsWith: "reviews/pending/" } } }).catch(() => undefined);
    await db.$transaction((tx) => recomputeRatings(tx, { productId: product.id, sellerId: product.sellerId }));
    // AuditLog is append-only by trigger (D13), so the `check_review_*` rows this
    // script writes stay in /admin/audit-log. Harmless, and deliberately not
    // deleted: a check that could erase audit rows would be a hole in the audit.
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
