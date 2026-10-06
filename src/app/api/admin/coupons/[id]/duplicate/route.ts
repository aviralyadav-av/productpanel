import { apiCreated, withAdminApi } from "@/lib/api/admin";

import { duplicateCoupon } from "@/features/coupons/service";

/** POST /api/admin/coupons/:id/duplicate -> 201 { data: Coupon } (a disabled copy with a new code). */
export const POST = withAdminApi<{ id: string }>(
  async ({ actor, params }) => apiCreated(await duplicateCoupon(params.id, actor)),
  { permission: "coupons.manage" },
);
