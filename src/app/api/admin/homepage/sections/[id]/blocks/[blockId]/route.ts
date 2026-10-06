import { apiOk, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic } from "@/lib/cache-tags";
import { scheduleContentExpiry } from "@/lib/queue/handlers/platform";

import { blockInputSchema } from "@/features/content/homepage/schemas";
import { deleteBlock, updateBlock } from "@/features/content/homepage/service";

/**
 * PUT    /api/admin/homepage/sections/:id/blocks/:blockId   (homepage.manage)
 * DELETE /api/admin/homepage/sections/:id/blocks/:blockId   remaining blocks are renumbered dense
 */
export const PUT = withAdminApi<{ id: string; blockId: string }>(
  async ({ req, params, actor }) => {
    const input = blockInputSchema.parse(await req.json());
    const block = await updateBlock(params.id, params.blockId, input, actor);
    await invalidatePublic(["content"]);
    await scheduleContentExpiry();
    return apiOk(block);
  },
  { permission: "homepage.manage" },
);

export const DELETE = withAdminApi<{ id: string; blockId: string }>(
  async ({ params, actor }) => {
    const result = await deleteBlock(params.id, params.blockId, actor);
    await invalidatePublic(["content"]);
    return apiOk(result);
  },
  { permission: "homepage.manage" },
);
