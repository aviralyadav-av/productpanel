import { z } from "zod";

import { apiCreated, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { inquiryReplySchema } from "@/features/inquiries/schemas";
import { addInquiryNote, addInquiryReply } from "@/features/inquiries/service";

/**
 * POST /api/admin/inquiries/:id/replies { message, isInternal? } (inquiries.manage)
 * isInternal=false (default): emailed to the inquirer with the store signature; status -> REPLIED.
 * isInternal=true: staff-only note, never emailed.
 */
const bodySchema = inquiryReplySchema.omit({ inquiryId: true }).extend({ isInternal: z.boolean().default(false) });

export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const body = await parseJsonBody(req, bodySchema);
    const result = body.isInternal
      ? await addInquiryNote({ inquiryId: params.id, message: body.message, actor, ip })
      : await addInquiryReply({ inquiryId: params.id, message: body.message, actor, ip });
    return apiCreated(result);
  },
  { permission: "inquiries.manage" },
);
