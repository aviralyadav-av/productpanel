import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { reviewDocumentBodySchema } from "@/features/sellers/schemas";
import { reviewSellerDocument } from "@/features/sellers/service";

/**
 * PUT /api/admin/sellers/:id/documents/:docId { status: VERIFIED|REJECTED, note? }   (sellers.approve)
 *
 * Verifying may complete the C5 activation conditions; the response says so.
 */
const bodySchema = reviewDocumentBodySchema;

export const PUT = withAdminApi<{ id: string; docId: string }>(
  async ({ req, params, actor }) => {
    const body = await parseJsonBody(req, bodySchema);
    const result = await reviewSellerDocument({ sellerId: params.id, documentId: params.docId, ...body, actor });
    return apiOk({ document: result.document, autoActivated: result.autoActivated });
  },
  { permission: "sellers.approve" },
);
