import { notFound } from "@/lib/api/errors";
import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { getPromotionEditor } from "@/features/promotions/queries";
import { promotionFormSchema } from "@/features/promotions/schemas";
import { deletePromotion, updatePromotion } from "@/features/promotions/service";

/**
 * GET    /api/admin/promotions/:id -> { data: PromotionEditorData }  (promotions.view)
 * PUT    /api/admin/promotions/:id  body = PromotionFormInput         (promotions.manage)
 * DELETE /api/admin/promotions/:id -> 204                             (promotions.manage)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const promotion = await getPromotionEditor(params.id);
    if (!promotion) throw notFound("Promotion");
    return apiOk(promotion);
  },
  { permission: "promotions.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, actor, params }) => {
    const input = await parseJsonBody(req, promotionFormSchema);
    const result = await updatePromotion(params.id, input, actor);
    await invalidatePublic(listTagsFor("promotion"));
    return apiOk({ ...result.promotion, repriced: result.repriced });
  },
  { permission: "promotions.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ actor, params, searchParams }) => {
    await deletePromotion(params.id, actor, searchParams.get("reason") ?? undefined);
    await invalidatePublic(listTagsFor("promotion"));
    return apiNoContent();
  },
  { permission: "promotions.manage" },
);
