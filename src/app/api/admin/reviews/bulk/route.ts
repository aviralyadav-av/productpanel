import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { forbiddenError } from "@/lib/api/errors";
import { can } from "@/lib/auth/guards";

import { REVIEW_BULK_PERMISSION, bulkReviewSchema } from "@/features/reviews/schemas";
import { bulkReviews } from "@/features/reviews/service";

/**
 * POST /api/admin/reviews/bulk { ids: string[] (≤500), op: approve|reject|delete, reason? }
 * approve/reject need reviews.moderate, delete needs reviews.delete. One transaction; audited with the id count (D13).
 */
export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const body = await parseJsonBody(req, bulkReviewSchema);
    const needed = REVIEW_BULK_PERMISSION[body.op];
    if (!can(actor, needed)) throw forbiddenError(`This operation requires ${needed}.`);
    return apiOk(await bulkReviews(body, actor, { ip }));
  },
  { permission: ["reviews.moderate", "reviews.delete"] },
);
