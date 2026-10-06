import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { forbiddenError } from "@/lib/api/errors";
import { can } from "@/lib/auth/guards";

import { BULK_OP_PERMISSION, bulkRequestSchema } from "@/features/customers/schemas";
import { bulkCustomers } from "@/features/customers/service";

/**
 * POST /api/admin/customers/bulk { ids (<=500), op: BLOCK|UNBLOCK|ADD_TAG|REMOVE_TAG, tag?, reason? }   (customers.view + the op's own permission, 11.33)
 * -> { op, requested, affected, skipped: [{ id, reason }], summary }
 */
export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, bulkRequestSchema);
    if (!can(actor, BULK_OP_PERMISSION[input.op])) throw forbiddenError(`Requires ${BULK_OP_PERMISSION[input.op]}.`);
    return apiOk(await bulkCustomers(input, actor, { ip }));
  },
  { permission: "customers.view" },
);
