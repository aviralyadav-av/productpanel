import { apiOk, parseFormBody, withAdminApi } from "@/lib/api/admin";

import { replaceFormSchema } from "@/features/media/schemas";
import { replaceMedia } from "@/features/media/service";

/**
 * POST /api/admin/media/:id/replace  (multipart `file`; permission media.upload)
 *
 * Swaps the bytes behind an existing asset, keeping its id, folder, alt and
 * visibility. The new file must be the same KIND (image for image, ...); the
 * storage key and public URL change. Returns the updated asset.
 */
export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const { file } = await parseFormBody(req, replaceFormSchema);
    const asset = await replaceMedia(
      params.id,
      { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name, mimeType: file.type || null },
      actor,
      { ip, userAgent: req.headers.get("user-agent") },
    );
    return apiOk(asset);
  },
  { permission: "media.upload", rateLimit: { limit: 300, windowMs: 60 * 60_000, keyBy: "actor" } },
);
