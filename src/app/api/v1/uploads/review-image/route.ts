import { badRequest } from "@/lib/api/errors";
import { handleOptions, privateJson, withPublicApi } from "@/lib/api/public";

import { REVIEW_IMAGE_MAX_BYTES } from "@/features/reviews/schemas";
import { createPendingReviewUpload } from "@/features/reviews/service";

/**
 * POST /api/v1/uploads/review-image  multipart/form-data { file }   (blueprint D6, D9)
 *
 * A shopper's photo for a product review. Magic-byte checked (jpeg/png/webp),
 * re-encoded through sharp (EXIF stripped, 5000px cap), stored PUBLIC under
 * `reviews/pending/yyyy/mm/` and returned as an opaque upload token that
 * POST /api/v1/products/:slug/reviews exchanges. Unused tokens are purged
 * after 24 h. 20 uploads per hour per IP.
 *
 * -> 201 { uploadToken, expiresAt, filename }
 */
export const POST = withPublicApi(
  async ({ req, ip }) => {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) throw badRequest("Send the image as multipart/form-data.");

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > REVIEW_IMAGE_MAX_BYTES + 64 * 1024) throw badRequest("The image must be 5 MB or smaller.", { file: "Too large." });

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw badRequest("Malformed upload.");
    }
    const file = form.get("file") ?? form.get("image") ?? form.get("photo");
    if (!(file instanceof File)) throw badRequest("Attach the image as the `file` field.", { file: "Missing." });
    if (file.size > REVIEW_IMAGE_MAX_BYTES) throw badRequest("The image must be 5 MB or smaller.", { file: "Too large." });

    const result = await createPendingReviewUpload({ buffer: Buffer.from(await file.arrayBuffer()), filename: file.name, ip });
    return privateJson({ uploadToken: result.uploadToken, expiresAt: result.expiresAt.toISOString(), filename: result.filename }, { status: 201, req });
  },
  { rateLimit: { limit: 20, windowMs: 60 * 60 * 1000 } },
);

export const OPTIONS = handleOptions;
