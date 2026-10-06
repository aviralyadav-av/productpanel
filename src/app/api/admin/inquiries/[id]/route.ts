import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getInquiryDetail } from "@/features/inquiries/queries";
import { inquiryPatchSchema } from "@/features/inquiries/schemas";
import { updateInquiry } from "@/features/inquiries/service";

/**
 * GET /api/admin/inquiries/:id                       (inquiries.view)   `{ data: InquiryDetail }` incl. replies + activity
 * PUT /api/admin/inquiries/:id { type?, priority?, subject? } (inquiries.manage)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const inquiry = await getInquiryDetail(params.id);
    if (!inquiry) throw notFound("Inquiry");
    return apiOk(inquiry);
  },
  { permission: "inquiries.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const patch = await parseJsonBody(req, inquiryPatchSchema);
    return apiOk(await updateInquiry(params.id, patch, actor, { ip }));
  },
  { permission: "inquiries.manage" },
);
