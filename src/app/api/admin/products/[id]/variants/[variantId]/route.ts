import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { updateVariantSchema } from "@/features/products/schemas";
import { deleteVariant, updateVariant } from "@/features/products/variants-service";

/**
 * PUT    /api/admin/products/:id/variants/:variantId   { name?, sku?, barcode?, pricePaise?, salePricePaise?, costPaise?, weightGrams?, isActive? }   (products.edit)
 * DELETE /api/admin/products/:id/variants/:variantId   soft delete (blueprint F2)   (products.edit)
 */
export const PUT = withAdminApi<{ id: string; variantId: string }>(
  async ({ req, params, actor, ip }) => {
    const patch = await parseJsonBody(req, updateVariantSchema);
    return apiOk(await updateVariant(params.id, params.variantId, patch, actor, { ip }));
  },
  { permission: "products.edit" },
);

export const DELETE = withAdminApi<{ id: string; variantId: string }>(
  async ({ params, actor, ip }) => {
    await deleteVariant(params.id, params.variantId, actor, { ip });
    return apiNoContent();
  },
  { permission: "products.edit" },
);
