import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic } from "@/lib/cache-tags";

import { menuUpdateSchema } from "@/features/navigation/schemas";
import { deleteMenu, updateMenu } from "@/features/navigation/service";

/**
 * PUT    /api/admin/navigation/menus/:id   rename / re-describe; the slug is frozen   (navigation.manage)
 * DELETE /api/admin/navigation/menus/:id   custom menus only - 409 for the built-in five
 */
export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, menuUpdateSchema);
    const menu = await updateMenu(params.id, input, actor, { ip, userAgent: req.headers.get("user-agent") });
    await invalidatePublic(["nav"]);
    return apiOk(menu);
  },
  { permission: "navigation.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const result = await deleteMenu(params.id, actor, { ip, userAgent: req.headers.get("user-agent") });
    await invalidatePublic(["nav"]);
    return apiOk(result);
  },
  { permission: "navigation.manage" },
);
