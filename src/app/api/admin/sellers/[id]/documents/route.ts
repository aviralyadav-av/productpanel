import { apiCreated, apiOk, withAdminApi } from "@/lib/api/admin";
import { badRequest, validationError, zodDetails } from "@/lib/api/errors";

import { listSellerDocuments } from "@/features/sellers/detail-queries";
import { SELLER_DOCUMENT_MAX_BYTES, documentMetaSchema } from "@/features/sellers/schemas";
import { uploadSellerDocument } from "@/features/sellers/service";

/**
 * GET  /api/admin/sellers/:id/documents                                (sellers.view)
 * POST /api/admin/sellers/:id/documents  multipart { file, type, label? }  (sellers.edit)
 *
 * Upload on the seller's behalf: PDF/JPEG/PNG ≤ 5 MB, stored PRIVATE in the
 * media folder `sellers/<slug>`, attached as a PENDING SellerDocument.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => apiOk(await listSellerDocuments(params.id)),
  { permission: "sellers.view" },
);

export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw badRequest("Send multipart/form-data with a `file` field.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw validationError({ file: "Choose a file." });
    if (file.size > SELLER_DOCUMENT_MAX_BYTES) throw validationError({ file: "Too large (max 5 MB)." });

    const meta = documentMetaSchema.safeParse({ type: form.get("type"), label: form.get("label") ?? undefined });
    if (!meta.success) throw validationError(zodDetails(meta.error));

    const document = await uploadSellerDocument({
      sellerId: params.id,
      file: { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name, mimeType: file.type || null },
      type: meta.data.type,
      label: meta.data.label,
      actor,
      ip,
      userAgent: req.headers.get("user-agent"),
    });
    return apiCreated(document);
  },
  { permission: "sellers.edit", rateLimit: { limit: 60, windowMs: 60 * 60_000 } },
);
