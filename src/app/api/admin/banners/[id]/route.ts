import { notFound } from "@/lib/api/errors";
import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { scheduleContentExpiry } from "@/lib/queue/handlers/platform";

import { getBannerEditor } from "@/features/banners/queries";
import { bannerFormSchema } from "@/features/banners/schemas";
import { deleteBanner, updateBanner } from "@/features/banners/service";

/**
 * GET    /api/admin/banners/:id -> { data: BannerEditorData }  (banners.view)
 * PUT    /api/admin/banners/:id  body = BannerFormInput         (banners.manage)
 * DELETE /api/admin/banners/:id -> 204                          (banners.manage)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const banner = await getBannerEditor(params.id);
    if (!banner) throw notFound("Banner");
    return apiOk(banner);
  },
  { permission: "banners.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, actor, params }) => {
    const input = await parseJsonBody(req, bannerFormSchema);
    const row = await updateBanner(params.id, input, actor);
    await invalidatePublic(listTagsFor("banner"));
    await scheduleContentExpiry();
    return apiOk(row);
  },
  { permission: "banners.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ actor, params }) => {
    await deleteBanner(params.id, actor);
    await invalidatePublic(listTagsFor("banner"));
    return apiNoContent();
  },
  { permission: "banners.manage" },
);
