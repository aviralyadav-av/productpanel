import { apiCreated, parseJsonBody, parseListQuery, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { listCoupons } from "@/features/coupons/queries";
import { COUPON_SORTS, couponFormSchema, parseCouponListFilters, resolveCouponSort } from "@/features/coupons/schemas";
import { createCoupon } from "@/features/coupons/service";

/**
 * GET /api/admin/coupons?page&pageSize&sort&order&q&status&type&fundedBy&appliesTo   (coupons.view)
 *   -> { data: CouponRow[], meta, statusCounts }
 * POST /api/admin/coupons  body = CouponFormInput                                   (coupons.manage)
 *   -> 201 { data: Coupon }
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "updatedAt", defaultOrder: "desc", allowedSorts: COUPON_SORTS });
    const result = await listCoupons({ ...query, sort: resolveCouponSort(query.sort) }, parseCouponListFilters(searchParams));
    // apiList's envelope plus the per-status counts the tabs need.
    return Response.json(
      { data: result.rows, meta: result.meta, statusCounts: result.statusCounts },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
  { permission: "coupons.view" },
);

export const POST = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, couponFormSchema);
    const row = await createCoupon(input, actor);
    await invalidatePublic(listTagsFor("coupon"));
    return apiCreated(row);
  },
  { permission: "coupons.manage" },
);
