import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { addressSchema } from "@/features/customers/schemas";
import { deleteAddress, updateAddress } from "@/features/customers/service";

/**
 * PUT    /api/admin/customers/:id/addresses/:addressId   partial address (isDefault: true re-points the default for its type)   (customers.edit)
 * DELETE /api/admin/customers/:id/addresses/:addressId                                                                            (customers.edit)
 */
export const PUT = withAdminApi<{ id: string; addressId: string }>(
  async ({ req, params, actor, ip }) => {
    const patch = await parseJsonBody(req, addressSchema.partial());
    return apiOk(await updateAddress(params.id, params.addressId, patch, actor, { ip }));
  },
  { permission: "customers.edit" },
);

export const DELETE = withAdminApi<{ id: string; addressId: string }>(
  async ({ params, actor, ip }) => {
    await deleteAddress(params.id, params.addressId, actor, { ip });
    return apiNoContent();
  },
  { permission: "customers.edit" },
);
