import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getReviewDetail } from "@/features/reviews/queries";
import { reviewPatchSchema } from "@/features/reviews/schemas";
import { deleteReview, updateReview } from "@/features/reviews/service";

/**
 * GET    /api/admin/reviews/:id            (reviews.view)     `{ data: ReviewDetail }`
 * PUT    /api/admin/reviews/:id  { patch } (reviews.moderate) edit fields; status changes recompute ratings
 * DELETE /api/admin/reviews/:id?reason=    (reviews.delete)   hard delete + recompute
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const review = await getReviewDetail(params.id);
    if (!review) throw notFound("Review");
    return apiOk(review);
  },
  { permission: "reviews.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const patch = await parseJsonBody(req, reviewPatchSchema);
    const review = await updateReview(params.id, patch, actor, { ip });
    return apiOk(review);
  },
  { permission: "reviews.moderate" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ params, actor, ip, searchParams }) => {
    await deleteReview(params.id, actor, { ip, reason: searchParams.get("reason") });
    return apiNoContent();
  },
  { permission: "reviews.delete" },
);
