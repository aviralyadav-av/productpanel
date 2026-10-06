import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { forbiddenError } from "@/lib/api/errors";
import { can } from "@/lib/auth/guards";

import { bulkSellerStatusSchema } from "@/features/sellers/schemas";
import { bulkTransitionSellers } from "@/features/sellers/service";

/**
 * POST /api/admin/sellers/bulk { ids[], toStatus, reason? }
 *
 * Same edge for many sellers. SUSPENDED needs sellers.suspend; every other
 * target needs sellers.approve. Sellers that cannot legally make the move are
 * skipped and listed with the reason; the bulk itself is audited (D13).
 */
export const POST = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, bulkSellerStatusSchema);
    const needed = input.toStatus === "SUSPENDED" ? "sellers.suspend" : "sellers.approve";
    if (!can(actor, needed)) throw forbiddenError(`This bulk action requires ${needed}.`);
    const result = await bulkTransitionSellers({ ids: input.ids, toStatus: input.toStatus, actor, reason: input.reason });
    return apiOk(result);
  },
  { permission: ["sellers.approve", "sellers.suspend"] },
);
