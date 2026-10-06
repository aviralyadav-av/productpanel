import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { replyReviewSchema } from "@/features/reviews/schemas";
import { replyToReview } from "@/features/reviews/service";

/** POST /api/admin/reviews/:id/reply { reply: string | null } (reviews.reply) - null clears the reply. */
const bodySchema = replyReviewSchema.omit({ id: true });

export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const body = await parseJsonBody(req, bodySchema);
    const review = await replyToReview(params.id, body.reply, actor, { ip });
    return apiOk({ id: review.id, reply: review.reply, repliedAt: review.repliedAt });
  },
  { permission: "reviews.reply" },
);
