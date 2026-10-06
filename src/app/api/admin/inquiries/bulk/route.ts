import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { bulkInquirySchema } from "@/features/inquiries/schemas";
import { bulkInquiries } from "@/features/inquiries/service";

/**
 * POST /api/admin/inquiries/bulk { ids: string[] (≤500), op: resolve|spam|reopen|assign, assignedToId? } (inquiries.manage)
 * One transaction; audited with the id count (D13).
 */
export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const body = await parseJsonBody(req, bulkInquirySchema);
    return apiOk(await bulkInquiries(body, actor, { ip }));
  },
  { permission: "inquiries.manage" },
);
