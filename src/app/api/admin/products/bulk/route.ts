import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { forbiddenError } from "@/lib/api/errors";
import { can } from "@/lib/auth/guards";

import { bulkProducts } from "@/features/products/bulk-service";
import { BULK_OP_PERMISSION, bulkRequestSchema } from "@/features/products/schemas";

/**
 * POST /api/admin/products/bulk { ids (≤500), op, ...opFields }   (products.bulk + the op's own permission, blueprint A7)
 * → { op, requested, affected, skipped: [{ id, title, reason }], summary }
 */
export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, bulkRequestSchema);
    if (!can(actor, BULK_OP_PERMISSION[input.op])) throw forbiddenError(`Requires ${BULK_OP_PERMISSION[input.op]}.`);
    return apiOk(await bulkProducts(input, actor, { ip }));
  },
  { permission: "products.bulk" },
);
