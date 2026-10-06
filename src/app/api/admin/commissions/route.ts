import { apiCreated, apiList, parseJsonBody, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { createCommissionRule } from "@/features/finance/commission-service";
import { commissionScopeCounts, listCommissionRules } from "@/features/finance/queries";
import {
  COMMISSION_SORTS,
  commissionRuleSchema,
  parseCommissionFilters,
  parseCommissionSort,
} from "@/features/finance/ui-schemas";

/**
 * GET  /api/admin/commissions?page&pageSize&sort&order&q&scope&active=1|0   (commissions.view)
 *      `{ data: CommissionRuleRow[], meta }` plus `X-Scope-Counts` for the tabs.
 * POST /api/admin/commissions { scope, targetId, rateBps, fixedPaise, startsAt?, endsAt?, note?, isActive? }
 *      (commissions.manage) → 201; 409 when a rule already covers that target.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, {
      defaultSort: "updatedAt",
      defaultOrder: "desc",
      allowedSorts: COMMISSION_SORTS,
    });
    const filters = parseCommissionFilters(query.raw);
    const [result, counts] = await Promise.all([
      listCommissionRules({ ...query, sort: parseCommissionSort(query.sort) }, filters),
      commissionScopeCounts(filters),
    ]);

    const response = apiList(result.rows, result.meta);
    response.headers.set("X-Scope-Counts", JSON.stringify(counts));
    return response;
  },
  { permission: "commissions.view" },
);

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, commissionRuleSchema);
    const rule = await createCommissionRule(input, actor, { ip });
    return apiCreated({
      id: rule.id,
      scope: rule.scope,
      targetKey: rule.targetKey,
      rateBps: rule.rateBps,
      fixedPaise: rule.fixedPaise,
      isActive: rule.isActive,
    });
  },
  { permission: "commissions.manage" },
);
