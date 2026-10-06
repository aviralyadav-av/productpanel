import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic } from "@/lib/cache-tags";

import { importCategoryTreeSchema } from "@/features/navigation/schemas";
import { importCategoryTree } from "@/features/navigation/service";

/**
 * POST /api/admin/navigation/import-categories   (navigation.manage)
 * { menuId, parentId?, categoryIds[], levels?, includeInactive? }
 *
 * Creates nested CATEGORY links for the chosen roots. Idempotent by category:
 * anything already linked in that menu is skipped and reported.
 */
export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, importCategoryTreeSchema);
    const result = await importCategoryTree(input, actor, { ip, userAgent: req.headers.get("user-agent") });
    await invalidatePublic(["nav"]);
    return apiOk(result);
  },
  { permission: "navigation.manage" },
);
