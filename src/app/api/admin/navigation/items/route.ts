import { apiCreated, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic } from "@/lib/cache-tags";

import { itemInputSchema } from "@/features/navigation/schemas";
import { createItem } from "@/features/navigation/service";

/**
 * POST /api/admin/navigation/items   append a link to a menu (or under a parent)   (navigation.manage)
 *
 * The parent must belong to the same menu and the resulting depth is checked
 * against the three-level cap before anything is written.
 */
export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = itemInputSchema.parse(await req.json());
    const item = await createItem(input, actor, { ip, userAgent: req.headers.get("user-agent") });
    await invalidatePublic(["nav"]);
    return apiCreated(item);
  },
  { permission: "navigation.manage" },
);
