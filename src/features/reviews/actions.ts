"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { REVIEW_STATUS_META } from "@/lib/enums";

import {
  REVIEW_BULK_PERMISSION,
  bulkReviewSchema,
  looseIdSchema,
  replyReviewSchema,
  setReviewFeaturedSchema,
  setReviewStatusSchema,
  testimonialSchema,
  updateReviewSchema,
  type BulkReviewInput,
  type ReplyReviewInput,
  type SetReviewFeaturedInput,
  type SetReviewStatusInput,
  type TestimonialInput,
  type UpdateReviewInput,
} from "./schemas";
import {
  bulkReviews,
  createTestimonial,
  deleteReview,
  replyToReview,
  setReviewFeatured,
  setReviewStatus,
  updateReview,
  type BulkReviewResult,
} from "./service";

/**
 * Server Actions behind /admin/reviews: permission -> Zod -> service ->
 * revalidate -> ActionResult. The rules live in service.ts so the REST
 * routes share them.
 */

const LIST_PATH = "/admin/reviews";

export async function setReviewStatusAction(input: SetReviewStatusInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("reviews.moderate");
    const parsed = setReviewStatusSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const review = await setReviewStatus(parsed.data.id, parsed.data.status, actor);
    revalidatePath(LIST_PATH);
    return ok({ id: review.id }, `Review marked ${REVIEW_STATUS_META[parsed.data.status].label.toLowerCase()}.`);
  });
}

export async function setReviewFeaturedAction(input: SetReviewFeaturedInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("reviews.moderate");
    const parsed = setReviewFeaturedSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const review = await setReviewFeatured(parsed.data.id, parsed.data.isFeatured, actor);
    revalidatePath(LIST_PATH);
    return ok({ id: review.id }, parsed.data.isFeatured ? "Review featured." : "Review unfeatured.");
  });
}

export async function replyToReviewAction(input: ReplyReviewInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("reviews.reply");
    const parsed = replyReviewSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const review = await replyToReview(parsed.data.id, parsed.data.reply, actor);
    revalidatePath(LIST_PATH);
    return ok({ id: review.id }, parsed.data.reply ? "Reply posted." : "Reply removed.");
  });
}

export async function updateReviewAction(input: UpdateReviewInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("reviews.moderate");
    const parsed = updateReviewSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const review = await updateReview(parsed.data.id, parsed.data.patch, actor);
    revalidatePath(LIST_PATH);
    return ok({ id: review.id }, "Saved.");
  });
}

export async function deleteReviewAction(id: string, reason?: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("reviews.delete");
    const parsed = looseIdSchema.safeParse(id);
    if (!parsed.success) return fail("Invalid review id.");
    await deleteReview(parsed.data, actor, { reason });
    revalidatePath(LIST_PATH);
    return ok({ id: parsed.data }, "Review deleted.");
  });
}

export async function bulkReviewsAction(input: BulkReviewInput): Promise<ActionResult<BulkReviewResult>> {
  return runAction(async () => {
    const parsed = bulkReviewSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const actor = await requirePermissionOrThrow(REVIEW_BULK_PERMISSION[parsed.data.op]);
    const result = await bulkReviews(parsed.data, actor);
    revalidatePath(LIST_PATH);
    return ok(result, `${result.affected} review${result.affected === 1 ? "" : "s"} ${parsed.data.op === "delete" ? "deleted" : `${parsed.data.op}d`}.`);
  });
}

export async function createTestimonialAction(input: TestimonialInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("reviews.moderate");
    const parsed = testimonialSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const review = await createTestimonial(parsed.data, actor);
    revalidatePath(LIST_PATH);
    return ok({ id: review.id }, `Testimonial by ${review.authorName} added.`);
  });
}
