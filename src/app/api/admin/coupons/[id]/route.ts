import { notFound } from "@/lib/api/errors";
import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { getCouponEditor } from "@/features/coupons/queries";
import { couponFormSchema } from "@/features/coupons/schemas";
import { deleteCoupon, updateCoupon } from "@/features/coupons/service";

/**
 * GET    /api/admin/coupons/:id  -> { data: CouponEditorData }   (coupons.view)
 * PUT    /api/admin/coupons/:id  body = CouponFormInput          (coupons.manage)
 * DELETE /api/admin/coupons/:id  -> 204; soft when redeemed (F8) (coupons.manage)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const coupon = await getCouponEditor(params.id);
    if (!coupon) throw notFound("Coupon");
    return apiOk(coupon);
  },
  { permission: "coupons.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, actor, params }) => {
    const input = await parseJsonBody(req, couponFormSchema);
    const row = await updateCoupon(params.id, input, actor);
    await invalidatePublic(listTagsFor("coupon"));
    return apiOk(row);
  },
  { permission: "coupons.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ actor, params, searchParams }) => {
    const result = await deleteCoupon(params.id, actor, searchParams.get("reason") ?? undefined);
    await invalidatePublic(listTagsFor("coupon"));
    return result.mode === "hard" ? apiNoContent() : apiOk(result);
  },
  { permission: "coupons.manage" },
);
