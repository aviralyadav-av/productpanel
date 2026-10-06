import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { reorderProductImages } from "@/features/products/images-service";
import { reorderSchema } from "@/features/products/schemas";

/** PUT /api/admin/products/:id/images/reorder { orderedIds[] }   (products.edit) */
export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, reorderSchema);
    return apiOk(await reorderProductImages(params.id, input.orderedIds, actor, { ip }));
  },
  { permission: "products.edit" },
);
