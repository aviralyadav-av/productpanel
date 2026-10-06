import { notFound } from "@/lib/api/errors";
import { apiList, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { getCouponEditor, listCouponUsages } from "@/features/coupons/queries";

/** GET /api/admin/coupons/:id/usages?page&pageSize -> { data: CouponUsageRow[], meta } (coupons.view) */
export const GET = withAdminApi<{ id: string }>(
  async ({ params, searchParams }) => {
    const coupon = await getCouponEditor(params.id);
    if (!coupon) throw notFound("Coupon");
    const result = await listCouponUsages(params.id, parseListQuery(searchParams, { pageSize: 25 }));
    return apiList(result.rows, result.meta);
  },
  { permission: "coupons.view" },
);
