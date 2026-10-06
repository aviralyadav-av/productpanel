import { apiCreated, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { addNoteSchema } from "@/features/orders/schemas";
import { addOrderNote } from "@/features/orders/service";

/**
 * POST /api/admin/orders/:id/notes  body { message, isInternal? }   (orders.notes)
 *
 * Internal notes never leave the admin; customer-visible ones appear on the
 * public tracking page (D11 filters by `isInternal`).
 */
export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, addNoteSchema);
    const result = await addOrderNote({ orderId: params.id, message: input.message, isInternal: input.isInternal, actor, ip });
    return apiCreated(result);
  },
  { permission: "orders.notes" },
);
