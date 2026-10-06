import { apiCreated, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { getFolderTree } from "@/features/media/queries";
import { createFolderSchema } from "@/features/media/schemas";
import { createFolder } from "@/features/media/service";

/**
 * GET  /api/admin/media/folders                         (media.view)
 *      `{ data: { folders: MediaFolderDto[] (path-sorted, with depth and counts), rootCount, totalCount } }`
 * POST /api/admin/media/folders { name, parentId? }     (media.upload) -> 201 folder
 */
export const GET = withAdminApi(async () => apiOk(await getFolderTree()), { permission: "media.view" });

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, createFolderSchema);
    const folder = await createFolder(input, actor, { ip, userAgent: req.headers.get("user-agent") });
    return apiCreated(folder);
  },
  { permission: "media.upload" },
);
