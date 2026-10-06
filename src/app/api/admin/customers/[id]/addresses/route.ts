import { apiCreated, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getCustomerAddresses, getCustomerDetail } from "@/features/customers/queries";
import { addressSchema } from "@/features/customers/schemas";
import { createAddress } from "@/features/customers/service";

/**
 * GET  /api/admin/customers/:id/addresses          (customers.view)
 * POST /api/admin/customers/:id/addresses  body = address   (customers.edit; first address becomes default)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    if (!(await getCustomerDetail(params.id))) throw notFound("Customer");
    return apiOk(await getCustomerAddresses(params.id));
  },
  { permission: "customers.view" },
);

export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, addressSchema);
    return apiCreated(await createAddress(params.id, input, actor, { ip }));
  },
  { permission: "customers.edit" },
);
