import { apiCreated, apiList, parseJsonBody, parseListQuery, withAdminApi } from "@/lib/api/admin";
import { forbiddenError } from "@/lib/api/errors";
import { can } from "@/lib/auth/guards";

import { listSellers } from "@/features/sellers/queries";
import { SELLER_SORTS, createSellerSchema, parseSellerFilters, parseSellerSort } from "@/features/sellers/schemas";
import { createSeller } from "@/features/sellers/service";

/**
 * GET  /api/admin/sellers?page&pageSize&sort&order&q&status&state&city&pendingDocs&minRating   (sellers.view)
 *      `{ data: SellerListRow[], meta }` - the same rows the list page renders.
 * POST /api/admin/sellers { profile, initialStatus?, commissionBps? }                          (sellers.create)
 *      201 `{ data: { id, slug, status } }`; a commission override also needs commissions.manage.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "registered", defaultOrder: "desc", allowedSorts: SELLER_SORTS });
    const filters = parseSellerFilters(query.raw);
    const result = await listSellers({ ...query, sort: parseSellerSort(query.sort) }, filters);
    return apiList(result.rows, result.meta);
  },
  { permission: "sellers.view" },
);

export const POST = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, createSellerSchema);
    if (input.commissionBps !== null && input.commissionBps !== undefined && !can(actor, "commissions.manage")) {
      throw forbiddenError("Setting a commission override requires commissions.manage.");
    }
    const { seller, commissionRuleId } = await createSeller(input, actor);
    return apiCreated({ id: seller.id, slug: seller.slug, status: seller.status, commissionRuleId });
  },
  { permission: "sellers.create" },
);
