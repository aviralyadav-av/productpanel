import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { optionalTextSchema } from "@/lib/validation";

import { setReviewStatusSchema } from "@/features/reviews/schemas";
import { setReviewStatus } from "@/features/reviews/service";

/**
 * PUT /api/admin/reviews/:id/status { status: PENDING|APPROVED|REJECTED, reason? } (reviews.moderate)
 * The optional reason is not stored on the review - it goes into the audit summary,
 * which is where "why was this rejected" has to be answerable months later (D13).
 */
const bodySchema = setReviewStatusSchema.omit({ id: true }).extend({ reason: optionalTextSchema(500).optional() });

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const body = await parseJsonBody(req, bodySchema);
    const review = await setReviewStatus(params.id, body.status, actor, { ip, reason: body.reason });
    return apiOk({ id: review.id, status: review.status });
  },
  { permission: "reviews.moderate" },
);
