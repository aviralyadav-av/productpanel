import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getMediaDetail } from "@/features/media/queries";
import { updateMediaSchema } from "@/features/media/schemas";
import { deleteMedia, updateMedia } from "@/features/media/service";

/**
 * GET    /api/admin/media/:id                 detail incl. folder, uploader, usages   (media.view)
 * PUT    /api/admin/media/:id { alt?, folderId?, filename? }                          (media.upload)
 * DELETE /api/admin/media/:id                 204, or 409 with `usages` when in use   (media.delete)
 *
 * The 409 body keeps the standard error envelope and adds `usages` so a client
 * can render "used by 3 products" with links rather than a bare refusal.
 */

export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const detail = await getMediaDetail(params.id);
    if (!detail) throw notFound("Media asset");
    return apiOk(detail);
  },
  { permission: "media.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const patch = await parseJsonBody(req, updateMediaSchema);
    const asset = await updateMedia(params.id, patch, actor, { ip, userAgent: req.headers.get("user-agent") });
    return apiOk(asset);
  },
  { permission: "media.upload" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const result = await deleteMedia(params.id, actor, { ip, userAgent: req.headers.get("user-agent") });
    if (!result.deleted) {
      return Response.json(
        {
          error: {
            code: "CONFLICT",
            message: `"${result.filename}" is in use and cannot be deleted.`,
            details: Object.fromEntries(result.usages.map((usage) => [usage.relation, `${usage.type} × ${usage.count}`])),
          },
          inUse: true,
          usages: result.usages,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    return apiNoContent();
  },
  { permission: "media.delete" },
);
