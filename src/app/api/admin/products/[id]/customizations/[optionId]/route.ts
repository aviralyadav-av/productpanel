import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { deleteCustomizationOption, updateCustomizationOption } from "@/features/products/customization-service";
import { customizationOptionPatchSchema } from "@/features/products/schemas";

/**
 * PUT    /api/admin/products/:id/customizations/:optionId   partial option   (products.edit)
 * DELETE /api/admin/products/:id/customizations/:optionId                    (products.edit)
 */
export const PUT = withAdminApi<{ id: string; optionId: string }>(
  async ({ req, params, actor, ip }) => {
    const patch = await parseJsonBody(req, customizationOptionPatchSchema);
    return apiOk(await updateCustomizationOption(params.id, params.optionId, patch, actor, { ip }));
  },
  { permission: "products.edit" },
);

export const DELETE = withAdminApi<{ id: string; optionId: string }>(
  async ({ params, actor, ip }) => {
    await deleteCustomizationOption(params.id, params.optionId, actor, { ip });
    return apiNoContent();
  },
  { permission: "products.edit" },
);
