import { apiCreated, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { refundNoteSchema } from "@/features/refunds/schemas";
import { addRefundNote } from "@/features/refunds/service";

/** POST /api/admin/refunds/:id/notes  body { message }  (refunds.process) */
export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const values = await parseJsonBody(req, refundNoteSchema);
    const result = await addRefundNote({ refundId: params.id, message: values.message, actor, ip });
    return apiCreated(result);
  },
  { permission: "refunds.process" },
);
