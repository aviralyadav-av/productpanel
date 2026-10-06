import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { reorderCustomizationOptions } from "@/features/products/customization-service";
import { reorderSchema } from "@/features/products/schemas";

/** PUT /api/admin/products/:id/customizations/reorder { orderedIds[] }   (products.edit) */
export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, reorderSchema);
    return apiOk(await reorderCustomizationOptions(params.id, input.orderedIds, actor, { ip }));
  },
  { permission: "products.edit" },
);
