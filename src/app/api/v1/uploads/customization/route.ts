import { badRequest } from "@/lib/api/errors";
import { handleOptions, privateJson, withPublicApi } from "@/lib/api/public";
import { randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ImageProcessingError, processImageUpload } from "@/lib/images";
import { buildStorageKey, getStorage, sniffMime } from "@/lib/storage";

/**
 * POST /api/v1/uploads/customization  multipart/form-data { file }   (blueprint D6, PUBLIC_API §6)
 *
 * The shopper's photo for a PHOTO/IMAGE customisation option. The bytes are
 * type-checked by magic number (jpeg/png/webp only), re-encoded through sharp
 * (EXIF stripped, 5000px cap, 50 MP input limit) and stored PRIVATE under
 * `customizations/pending/yyyy/mm/<random>.<ext>` - never under public/.
 * The response carries only an opaque token; POST /orders exchanges it via
 * consumeUploadTokens() and the `uploads.purge_pending` job deletes anything
 * unused after 24 h. 20 uploads per hour per IP.
 *
 * → 201 { uploadToken, expiresAt, filename }
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const TTL_MS = 24 * 60 * 60 * 1000;

export const POST = withPublicApi(
  async ({ req, ip }) => {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) throw badRequest("Send the image as multipart/form-data.");

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES + 64 * 1024) throw badRequest("The image must be 5 MB or smaller.", { file: "Too large." });

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw badRequest("Malformed upload.");
    }
    const file = form.get("file") ?? form.get("image") ?? form.get("photo");
    if (!(file instanceof File)) throw badRequest("Attach the image as the `file` field.", { file: "Missing." });
    if (file.size === 0) throw badRequest("The file is empty.", { file: "Empty." });
    if (file.size > MAX_BYTES) throw badRequest("The image must be 5 MB or smaller.", { file: "Too large." });

    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = sniffMime(buffer);
    if (!detected || !ALLOWED.has(detected)) {
      throw badRequest("Only JPEG, PNG and WebP photos are accepted.", { file: "Unsupported type." });
    }

    let processed;
    try {
      processed = await processImageUpload(buffer, { thumbnail: false });
    } catch (error) {
      if (error instanceof ImageProcessingError) throw badRequest(error.message, { file: error.code });
      throw error;
    }
    if (!ALLOWED.has(processed.mimeType)) throw badRequest("Only JPEG, PNG and WebP photos are accepted.", { file: "Unsupported type." });

    const storage = await getStorage();
    const storageKey = buildStorageKey({ folder: "customizations/pending", ext: processed.ext });
    await storage.put({ key: storageKey, body: processed.buffer, contentType: processed.mimeType, visibility: "PRIVATE" });

    const expiresAt = new Date(Date.now() + TTL_MS);
    const pending = await db.pendingUpload.create({
      data: {
        token: randomToken(32),
        storageKey,
        mimeType: processed.mimeType,
        sizeBytes: processed.buffer.byteLength,
        ip,
        expiresAt,
      },
      select: { token: true },
    });

    return privateJson(
      { uploadToken: pending.token, expiresAt: expiresAt.toISOString(), filename: file.name.slice(0, 120) },
      { status: 201, req },
    );
  },
  { rateLimit: { limit: 20, windowMs: 60 * 60 * 1000 } },
);

export const OPTIONS = handleOptions;
