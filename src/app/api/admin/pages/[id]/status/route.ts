import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { pageStatusInputSchema } from "@/features/pages/schemas";
import { setPageStatus } from "@/features/pages/service";

/** PUT /api/admin/pages/:id/status { status: DRAFT|PUBLISHED|ARCHIVED, publishedAt? } -> { data: CmsPage } (pages.publish) */
export const PUT = withAdminApi<{ id: string }>(
  async ({ req, actor, params }) => {
    const input = await parseJsonBody(req, pageStatusInputSchema);
    const row = await setPageStatus(params.id, input, { actor, canPublish: true });
    await invalidatePublic(listTagsFor("page"));
    return apiOk(row);
  },
  { permission: "pages.publish" },
);
