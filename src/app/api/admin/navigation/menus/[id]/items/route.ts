import { apiOk, withAdminApi } from "@/lib/api/admin";

import { getMenuTree } from "@/features/navigation/queries";

/**
 * GET /api/admin/navigation/menus/:id/items   (navigation.view)
 *
 * The whole menu, flat and ordered, each row carrying its resolved storefront
 * URL and the §11.25 availability flag - the client nests it (the tree screen
 * needs the flat list anyway for drag projection).
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => apiOk(await getMenuTree(params.id)),
  { permission: "navigation.view" },
);
