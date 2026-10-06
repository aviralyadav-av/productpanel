import { apiCreated, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic } from "@/lib/cache-tags";
import { scheduleContentExpiry } from "@/lib/queue/handlers/platform";

import { blockInputSchema } from "@/features/content/homepage/schemas";
import { addBlock } from "@/features/content/homepage/service";

/**
 * POST /api/admin/homepage/sections/:id/blocks   (homepage.manage)
 *
 * Only repeatable types (trust_badges, announcement_bar) accept blocks; the
 * payload is validated against that type's `blockSchema` and the per-type
 * maximum is enforced before the row is written.
 */
export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor }) => {
    const input = blockInputSchema.parse(await req.json());
    const block = await addBlock(params.id, input, actor);
    await invalidatePublic(["content"]);
    await scheduleContentExpiry();
    return apiCreated(block);
  },
  { permission: "homepage.manage" },
);
