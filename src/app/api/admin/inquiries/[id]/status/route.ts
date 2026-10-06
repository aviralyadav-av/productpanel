import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { setInquiryStatusSchema } from "@/features/inquiries/schemas";
import { setInquiryStatus } from "@/features/inquiries/service";

/** PUT /api/admin/inquiries/:id/status { status: NEW|OPEN|REPLIED|RESOLVED|SPAM } (inquiries.manage) */
const bodySchema = setInquiryStatusSchema.omit({ id: true });

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const body = await parseJsonBody(req, bodySchema);
    const inquiry = await setInquiryStatus(params.id, body.status, actor, { ip });
    return apiOk({ id: inquiry.id, status: inquiry.status, resolvedAt: inquiry.resolvedAt });
  },
  { permission: "inquiries.manage" },
);
