import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { setStatusSchema } from "@/features/customers/schemas";
import { setCustomerStatus } from "@/features/customers/service";

/** PUT /api/admin/customers/:id/status { status: ACTIVE|BLOCKED, reason? }   (customers.block; reason required to block, sessions revoked) */
export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, setStatusSchema);
    return apiOk(await setCustomerStatus(params.id, input.status, actor, { ip, reason: input.reason }));
  },
  { permission: "customers.block" },
);
