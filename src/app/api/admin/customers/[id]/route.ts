import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getCustomerAddresses, getCustomerDetail } from "@/features/customers/queries";
import { customerPatchSchema } from "@/features/customers/schemas";
import { softDeleteCustomer, updateCustomer } from "@/features/customers/service";

/**
 * GET    /api/admin/customers/:id           profile + segment + per-tab counts + addresses   (customers.view)
 * PUT    /api/admin/customers/:id           any subset of the profile form                    (customers.edit)
 * DELETE /api/admin/customers/:id?reason=   soft delete / anonymise (E7)                      (customers.delete)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const customer = await getCustomerDetail(params.id);
    if (!customer) throw notFound("Customer");
    return apiOk({ ...customer, addresses: await getCustomerAddresses(params.id) });
  },
  { permission: "customers.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const patch = await parseJsonBody(req, customerPatchSchema);
    return apiOk(await updateCustomer(params.id, patch, actor, { ip }));
  },
  { permission: "customers.edit" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ searchParams, params, actor, ip }) => {
    await softDeleteCustomer(params.id, actor, { ip, reason: searchParams.get("reason") });
    return apiNoContent();
  },
  { permission: "customers.delete" },
);
