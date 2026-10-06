import { apiCreated, apiList, parseJsonBody, parseListQuery, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { listPromotions } from "@/features/promotions/queries";
import { PROMOTION_SORTS, parsePromotionListFilters, promotionFormSchema, resolvePromotionSort } from "@/features/promotions/schemas";
import { createPromotion } from "@/features/promotions/service";

/**
 * GET  /api/admin/promotions?page&pageSize&sort&order&q&status&type&fundedBy  (promotions.view) -> { data: PromotionRow[], meta }
 * POST /api/admin/promotions  body = PromotionFormInput                      (promotions.manage) -> 201 { data: Promotion & { repriced } }
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "startsAt", defaultOrder: "desc", allowedSorts: PROMOTION_SORTS });
    const result = await listPromotions({ ...query, sort: resolvePromotionSort(query.sort) }, parsePromotionListFilters(searchParams));
    return apiList(result.rows, result.meta);
  },
  { permission: "promotions.view" },
);

export const POST = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, promotionFormSchema);
    const result = await createPromotion(input, actor);
    await invalidatePublic(listTagsFor("promotion"));
    return apiCreated({ ...result.promotion, repriced: result.repriced });
  },
  { permission: "promotions.manage" },
);
