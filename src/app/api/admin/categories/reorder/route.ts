import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { db } from "@/lib/db";

import { reorderSchema } from "@/features/categories/schemas";
import { reorderCategories } from "@/features/categories/service";

/**
 * PUT /api/admin/categories/reorder { moves: [{ id, parentId, position }] }   (categories.manage)
 *
 * G5: every move is validated against the tree as it will be after the whole
 * batch (cycles, depth cap), positions are renumbered per sibling list and
 * re-parented subtrees have their paths rewritten - all in one transaction.
 */
export const PUT = withAdminApi(
  async ({ req, actor, ip }) => {
    const { moves } = await parseJsonBody(req, reorderSchema);
    const result = await db.$transaction((tx) => reorderCategories(tx, moves, actor, { ip, userAgent: req.headers.get("user-agent") }));
    await invalidatePublic(listTagsFor("category"));
    return apiOk(result);
  },
  { permission: "categories.manage" },
);
