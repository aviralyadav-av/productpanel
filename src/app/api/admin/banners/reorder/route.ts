import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { bannerReorderSchema } from "@/features/banners/schemas";
import { reorderBanners } from "@/features/banners/service";

/** PUT /api/admin/banners/reorder { placement, ids } -> { data: { placement, moved } } (banners.manage) */
export const PUT = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, bannerReorderSchema);
    const result = await reorderBanners(input, actor);
    await invalidatePublic(listTagsFor("banner"));
    return apiOk(result);
  },
  { permission: "banners.manage" },
);
