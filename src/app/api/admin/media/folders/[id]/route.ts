import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getFolder } from "@/features/media/queries";
import { updateFolderSchema } from "@/features/media/schemas";
import { deleteFolder, updateFolder } from "@/features/media/service";

/**
 * GET    /api/admin/media/folders/:id                       (media.view)
 * PUT    /api/admin/media/folders/:id { name?, parentId? }  rename and/or move; descendant paths are rewritten in one tx  (media.upload)
 * DELETE /api/admin/media/folders/:id                       204; 409 while it still holds files or subfolders           (media.delete)
 */

export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const folder = await getFolder(params.id);
    if (!folder) throw notFound("Folder");
    return apiOk(folder);
  },
  { permission: "media.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const patch = await parseJsonBody(req, updateFolderSchema);
    const folder = await updateFolder(params.id, patch, actor, { ip, userAgent: req.headers.get("user-agent") });
    return apiOk(folder);
  },
  { permission: "media.upload" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    await deleteFolder(params.id, actor, { ip, userAgent: req.headers.get("user-agent") });
    return apiNoContent();
  },
  { permission: "media.delete" },
);
