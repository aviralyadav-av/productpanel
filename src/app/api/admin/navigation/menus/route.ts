import { apiCreated, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic } from "@/lib/cache-tags";

import { listMenus } from "@/features/navigation/queries";
import { menuCreateSchema } from "@/features/navigation/schemas";
import { createMenu } from "@/features/navigation/service";

/**
 * GET  /api/admin/navigation/menus   every menu with item / visible / broken counts   (navigation.view)
 * POST /api/admin/navigation/menus   create a custom menu (built-in slugs rejected)   (navigation.manage)
 */
export const GET = withAdminApi(
  async () => apiOk(await listMenus()),
  { permission: "navigation.view" },
);

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, menuCreateSchema);
    const menu = await createMenu(input, actor, { ip, userAgent: req.headers.get("user-agent") });
    await invalidatePublic(["nav"]);
    return apiCreated(menu);
  },
  { permission: "navigation.manage" },
);
