import { apiOk, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";
import { invalidatePublic } from "@/lib/cache-tags";

import { getItemEditor } from "@/features/navigation/queries";
import { itemInputSchema } from "@/features/navigation/schemas";
import { deleteItem, updateItem } from "@/features/navigation/service";

/**
 * GET    /api/admin/navigation/items/:id   the editor payload with hydrated picker chips   (navigation.view)
 * PUT    /api/admin/navigation/items/:id   replace the item (menu changes are rejected)     (navigation.manage)
 * DELETE /api/admin/navigation/items/:id   removes the item and its children (cascade)      (navigation.manage)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const item = await getItemEditor(params.id);
    if (!item) throw notFound("Menu item");
    return apiOk(item);
  },
  { permission: "navigation.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = itemInputSchema.parse(await req.json());
    const item = await updateItem(params.id, input, actor, { ip, userAgent: req.headers.get("user-agent") });
    await invalidatePublic(["nav"]);
    return apiOk(item);
  },
  { permission: "navigation.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const result = await deleteItem(params.id, actor, { ip, userAgent: req.headers.get("user-agent") });
    await invalidatePublic(["nav"]);
    return apiOk(result);
  },
  { permission: "navigation.manage" },
);
