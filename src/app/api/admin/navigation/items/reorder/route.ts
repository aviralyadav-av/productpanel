import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic } from "@/lib/cache-tags";

import { reorderItemsSchema } from "@/features/navigation/schemas";
import { reorderItems } from "@/features/navigation/service";

/**
 * PUT /api/admin/navigation/items/reorder { moves: [{ id, parentId, position }] }   (navigation.manage)
 *
 * G5: the batch is validated against the tree as it will be afterwards (cycle
 * and depth), then both the old and the new sibling lists are renumbered dense
 * in one transaction.
 */
export const PUT = withAdminApi(
  async ({ req, actor, ip }) => {
    const { moves } = await parseJsonBody(req, reorderItemsSchema);
    const result = await reorderItems(moves, actor, { ip, userAgent: req.headers.get("user-agent") });
    await invalidatePublic(["nav"]);
    return apiOk(result);
  },
  { permission: "navigation.manage" },
);
