import { apiCreated, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { returnNoteSchema } from "@/features/returns/schemas";
import { addReturnNote } from "@/features/returns/service";

/**
 * POST /api/admin/returns/:id/notes  body { message, isInternal? }  (returns.manage)
 * An internal note never reaches the customer's tracking view (D11).
 */
export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const values = await parseJsonBody(req, returnNoteSchema);
    const result = await addReturnNote({ returnRequestId: params.id, values, actor, ip });
    return apiCreated(result);
  },
  { permission: "returns.manage" },
);
