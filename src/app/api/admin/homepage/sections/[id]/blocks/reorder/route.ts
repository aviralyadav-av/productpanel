import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic } from "@/lib/cache-tags";

import { blockReorderSchema } from "@/features/content/homepage/schemas";
import { reorderBlocks } from "@/features/content/homepage/service";

/** POST /api/admin/homepage/sections/:id/blocks/reorder { ids }   (homepage.manage) */
export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor }) => {
    const { ids } = await parseJsonBody(req, blockReorderSchema);
    const result = await reorderBlocks(params.id, ids, actor);
    await invalidatePublic(["content"]);
    return apiOk(result);
  },
  { permission: "homepage.manage" },
);
