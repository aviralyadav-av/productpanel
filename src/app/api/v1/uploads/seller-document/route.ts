import { badRequest, validationError } from "@/lib/api/errors";
import { handleOptions, privateJson, withPublicApi } from "@/lib/api/public";

import { SELLER_DOCUMENT_MAX_BYTES } from "@/features/sellers/schemas";
import { createPendingSellerUpload } from "@/features/sellers/service";

/**
 * POST /api/v1/uploads/seller-document   multipart { file }   (blueprint §14.C6, D6, D9)
 *
 * Accepts PDF, JPEG or PNG by magic bytes (the declared type is ignored),
 * ≤ 5 MB, stores the bytes PRIVATE immediately and returns an opaque token
 * that `POST /api/v1/sellers/register` exchanges within 24 hours.
 * 200: { data: { uploadToken, expiresAt, filename } }. 20/h per IP.
 */
export const POST = withPublicApi(
  async ({ req, ip }) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw badRequest("Send multipart/form-data with a `file` field.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw validationError({ file: "Attach a file." });
    if (file.size > SELLER_DOCUMENT_MAX_BYTES) throw validationError({ file: "Too large (max 5 MB)." });

    const result = await createPendingSellerUpload({
      buffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name || null,
      ip: ip === "unknown" ? null : ip,
    });
    return privateJson({ uploadToken: result.uploadToken, expiresAt: result.expiresAt, filename: result.filename }, { req });
  },
  { rateLimit: { limit: 20, windowMs: 60 * 60_000 } },
);

export const OPTIONS = handleOptions;
