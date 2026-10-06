import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { removeProductImage, updateProductImage } from "@/features/products/images-service";
import { updateImageSchema } from "@/features/products/schemas";

/**
 * PUT    /api/admin/products/:id/images/:imageId { alt?, isPrimary?, variantId? }   (products.edit)
 * DELETE /api/admin/products/:id/images/:imageId                                     (products.edit)
 */
export const PUT = withAdminApi<{ id: string; imageId: string }>(
  async ({ req, params, actor, ip }) => {
    const patch = await parseJsonBody(req, updateImageSchema);
    return apiOk(await updateProductImage(params.id, params.imageId, patch, actor, { ip }));
  },
  { permission: "products.edit" },
);

export const DELETE = withAdminApi<{ id: string; imageId: string }>(
  async ({ params, actor, ip }) => {
    await removeProductImage(params.id, params.imageId, actor, { ip });
    return apiNoContent();
  },
  { permission: "products.edit" },
);
