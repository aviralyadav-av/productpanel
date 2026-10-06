import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { assignInquirySchema } from "@/features/inquiries/schemas";
import { assignInquiry } from "@/features/inquiries/service";

/** PUT /api/admin/inquiries/:id/assign { assignedToId: string | null } (inquiries.manage) - an active admin user, or null to unassign. */
const bodySchema = assignInquirySchema.omit({ id: true });

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const body = await parseJsonBody(req, bodySchema);
    const inquiry = await assignInquiry(params.id, body.assignedToId, actor, { ip });
    return apiOk({ id: inquiry.id, assignedToId: inquiry.assignedToId, status: inquiry.status });
  },
  { permission: "inquiries.manage" },
);
