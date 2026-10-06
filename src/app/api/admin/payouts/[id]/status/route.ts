import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { forbiddenError } from "@/lib/api/errors";
import { can } from "@/lib/auth/guards";

import { transitionStatement } from "@/features/finance/payout-service";
import { payoutTransitionSchema } from "@/features/finance/ui-schemas";

/**
 * PUT /api/admin/payouts/:id/status { toStatus, referenceNumber?, failureReason?, bankAccountId?, notes? }
 *
 * Separation of duties (D14): APPROVED and CANCELLED need `payouts.approve`;
 * PROCESSING, PAID and FAILED need `payouts.process`. The permission is
 * checked here rather than in the wrapper because it depends on the body.
 */
export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, payoutTransitionSchema);
    const permission =
      input.toStatus === "APPROVED" || input.toStatus === "CANCELLED"
        ? "payouts.approve"
        : "payouts.process";
    if (!can(actor, permission)) throw forbiddenError(`That move requires ${permission}.`);

    const result = await transitionStatement(params.id, input, actor, { ip });
    return apiOk(result);
  },
  { permission: "payouts.view" },
);
