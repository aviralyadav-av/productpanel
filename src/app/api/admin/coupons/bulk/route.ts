import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { couponBulkSchema } from "@/features/coupons/schemas";
import { bulkCoupons } from "@/features/coupons/service";

/** POST /api/admin/coupons/bulk { ids: string[] (≤500), op: ENABLE|DISABLE|DELETE } -> { data: BulkCouponResult } */
export const POST = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, couponBulkSchema);
    const result = await bulkCoupons(input, actor);
    await invalidatePublic(listTagsFor("coupon"));
    return apiOk(result);
  },
  { permission: "coupons.manage" },
);
