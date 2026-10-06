import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ratingLabel, ratingSummary, roundRating } from "@/features/reviews/rating";
import { bulkReviewSchema, publicReviewSchema, testimonialSchema } from "@/features/reviews/schemas";

/**
 * Pure checks for the reviews module: the rating recompute maths behind
 * Product/Seller.ratingAvg + reviewCount, and the public intake schema.
 * Run with `npm test` (node --import tsx --test).
 */

describe("ratingSummary", () => {
  it("averages rated reviews to two decimals and counts every approved review", () => {
    const summary = ratingSummary([5, 4, 4, null, 3]);
    assert.equal(summary.reviewCount, 5);
    assert.equal(summary.ratingAvg, 4);
  });

  it("rounds half-up at two decimals", () => {
    assert.equal(ratingSummary([5, 4, 4]).ratingAvg, 4.33);
    assert.equal(ratingSummary([5, 5, 4]).ratingAvg, 4.67);
    assert.equal(roundRating(1.005), 1.01);
  });

  it("returns zero for no reviews or only unrated ones", () => {
    assert.deepEqual(ratingSummary([]), { ratingAvg: 0, reviewCount: 0 });
    assert.deepEqual(ratingSummary([null, undefined]), { ratingAvg: 0, reviewCount: 2 });
  });

  it("ignores out-of-range values instead of skewing the average", () => {
    assert.equal(ratingSummary([5, 0, 9, 5]).ratingAvg, 5);
  });

  it("labels", () => {
    assert.equal(ratingLabel(4.333, 12), "4.3 (12)");
    assert.equal(ratingLabel(0, 0), null);
  });
});

describe("publicReviewSchema", () => {
  const valid = { authorName: "Asha", rating: 5, body: "Beautiful craftsmanship, arrived well packed." };

  it("accepts a minimal review and coerces the rating", () => {
    const parsed = publicReviewSchema.parse({ ...valid, rating: "4" });
    assert.equal(parsed.rating, 4);
    assert.equal(parsed.email, undefined);
  });

  it("rejects ratings outside 1-5 and bodies under 10 characters", () => {
    assert.equal(publicReviewSchema.safeParse({ ...valid, rating: 6 }).success, false);
    assert.equal(publicReviewSchema.safeParse({ ...valid, rating: 0 }).success, false);
    assert.equal(publicReviewSchema.safeParse({ ...valid, body: "short" }).success, false);
  });

  it("caps photos at five tokens", () => {
    assert.equal(publicReviewSchema.safeParse({ ...valid, images: ["a", "b", "c", "d", "e", "f"] }).success, false);
    assert.equal(publicReviewSchema.safeParse({ ...valid, images: ["a"] }).success, true);
  });

  it("normalises the email and keeps the honeypot field for the service to inspect", () => {
    const parsed = publicReviewSchema.parse({ ...valid, email: " ASHA@Example.com ", website: "http://spam" });
    assert.equal(parsed.email, "asha@example.com");
    assert.equal(parsed.website, "http://spam");
  });
});

describe("admin schemas", () => {
  it("bulk requires at least one id and a known op", () => {
    assert.equal(bulkReviewSchema.safeParse({ ids: [], op: "approve" }).success, false);
    assert.equal(bulkReviewSchema.safeParse({ ids: ["a"], op: "archive" }).success, false);
    assert.equal(bulkReviewSchema.safeParse({ ids: ["a"], op: "delete", reason: "spam" }).success, true);
  });

  it("testimonials default to approved with position 0", () => {
    const parsed = testimonialSchema.parse({ authorName: "Ravi", body: "Loved it." });
    assert.equal(parsed.status, "APPROVED");
    assert.equal(parsed.position, 0);
    assert.equal(parsed.isFeatured, false);
  });
});
