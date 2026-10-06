import { apiCreated, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { scheduleContentExpiry } from "@/lib/queue/handlers/platform";

import { listBannerGroups } from "@/features/banners/queries";
import { bannerFormSchema, parseBannerListFilters } from "@/features/banners/schemas";
import { createBanner } from "@/features/banners/service";

/**
 * GET  /api/admin/banners?placement&status&q   (banners.view)   -> { data: BannerGroup[], total, statusCounts }
 * POST /api/admin/banners  body = BannerFormInput (banners.manage) -> 201 { data: Banner }
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const result = await listBannerGroups(parseBannerListFilters(searchParams));
    return apiOk(result.groups, { headers: { "X-Total-Count": String(result.total) } });
  },
  { permission: "banners.view" },
);

export const POST = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, bannerFormSchema);
    const row = await createBanner(input, actor);
    await invalidatePublic(listTagsFor("banner"));
    await scheduleContentExpiry();
    return apiCreated(row);
  },
  { permission: "banners.manage" },
);
