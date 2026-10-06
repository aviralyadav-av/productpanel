import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { setReviewFeaturedSchema } from "@/features/reviews/schemas";
import { setReviewFeatured } from "@/features/reviews/service";

/** PUT /api/admin/reviews/:id/feature { isFeatured: boolean } (reviews.moderate) */
const bodySchema = setReviewFeaturedSchema.omit({ id: true });

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const body = await parseJsonBody(req, bodySchema);
    const review = await setReviewFeatured(params.id, body.isFeatured, actor, { ip });
    return apiOk({ id: review.id, isFeatured: review.isFeatured });
  },
  { permission: "reviews.moderate" },
);
