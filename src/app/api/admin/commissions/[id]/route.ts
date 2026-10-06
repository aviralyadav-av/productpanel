import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";
import { db } from "@/lib/db";

import { deleteCommissionRule, updateCommissionRule } from "@/features/finance/commission-service";
import { commissionRuleSchema } from "@/features/finance/ui-schemas";

/**
 * GET    /api/admin/commissions/:id                       (commissions.view)
 * PUT    /api/admin/commissions/:id { ...rule }           (commissions.manage)
 * DELETE /api/admin/commissions/:id                       (commissions.manage)
 *        409 for the GLOBAL rule - it is the fallback every other rule ends at.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const rule = await db.commissionRule.findUnique({ where: { id: params.id } });
    if (!rule) throw notFound("Commission rule");
    return apiOk(rule);
  },
  { permission: "commissions.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, commissionRuleSchema);
    const rule = await updateCommissionRule(params.id, input, actor, { ip });
    return apiOk({
      id: rule.id,
      scope: rule.scope,
      targetKey: rule.targetKey,
      rateBps: rule.rateBps,
      fixedPaise: rule.fixedPaise,
      isActive: rule.isActive,
      updatedAt: rule.updatedAt,
    });
  },
  { permission: "commissions.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ params, actor, ip }) => {
    await deleteCommissionRule(params.id, actor, { ip });
    return apiNoContent();
  },
  { permission: "commissions.manage" },
);
