import { parseFormBody, withAdminApi } from "@/lib/api/admin";
import { normalizeError } from "@/lib/api/errors";

import type { MediaAssetDto } from "@/features/media/dto";
import { uploadFormSchema } from "@/features/media/schemas";
import { uploadMedia } from "@/features/media/service";

/**
 * POST /api/admin/media/upload  (multipart; permission media.upload)
 *
 * Fields: `file` or `files[]` (one or many), `folderId?`, `visibility?`
 * (PUBLIC|PRIVATE, default PUBLIC), `alt?`.
 *
 * Response 201 `{ data: MediaAssetDto[], errors: [{ filename, message }] }`.
 * With several files each is processed independently: one corrupt image does
 * not fail the batch, it lands in `errors` and the rest are created. A single
 * bad file, however, is a plain 4xx so simple clients get a normal error.
 *
 * Rate limit is per actor: an operator dropping a folder of product photos is
 * the normal case, a script uploading thousands is not.
 */
export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseFormBody(req, uploadFormSchema);
    const userAgent = req.headers.get("user-agent");

    const created: MediaAssetDto[] = [];
    const errors: Array<{ filename: string; message: string; details?: Record<string, string> }> = [];

    for (const file of input.files) {
      try {
        const asset = await uploadMedia({
          file: { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name, mimeType: file.type || null },
          folderId: input.folderId,
          visibility: input.visibility,
          alt: input.alt,
          actor,
          ip,
          userAgent,
        });
        created.push(asset);
      } catch (error) {
        if (input.files.length === 1) throw error;
        const apiError = normalizeError(error);
        errors.push({ filename: file.name, message: apiError.message, details: apiError.details });
      }
    }

    return Response.json({ data: created, errors }, { status: 201, headers: { "Cache-Control": "no-store" } });
  },
  { permission: "media.upload", rateLimit: { limit: 600, windowMs: 60 * 60_000, keyBy: "actor" } },
);
