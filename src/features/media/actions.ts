"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";

import type { MediaAssetDto } from "@/features/media/dto";
import {
  bulkDeleteSchema,
  bulkMoveSchema,
  createFolderSchema,
  mediaIdSchema,
  moveFolderSchema,
  renameFolderSchema,
  updateMediaSchema,
} from "@/features/media/schemas";
import {
  bulkDeleteMedia,
  createFolder,
  deleteFolder,
  deleteMedia,
  moveFolder,
  moveMedia,
  renameFolder,
  updateMedia,
  type BulkDeleteResult,
  type DeleteMediaResult,
} from "@/features/media/service";
import type { MediaUsage } from "@/features/media/usage";

/**
 * Server Actions behind the /admin/media page. Uploads and replacements do
 * NOT go through here - they stream to the REST routes so the browser can
 * show per-file progress - but every metadata change does, so the page can
 * use the shared `useActionToast` flow and `revalidatePath` refreshes the
 * Server Component underneath.
 */

const MEDIA_PATH = "/admin/media";

function revalidate(): void {
  revalidatePath(MEDIA_PATH);
}

export type UpdateMediaActionInput = {
  alt?: string | null;
  folderId?: string | null;
  filename?: string;
};

export async function updateMediaAction(id: string, input: UpdateMediaActionInput): Promise<ActionResult<MediaAssetDto>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("media.upload");
    const parsedId = mediaIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid media id.");
    const parsed = updateMediaSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const asset = await updateMedia(parsedId.data, parsed.data, actor);
    revalidate();
    return ok(asset, "Media details saved.");
  });
}

export type DeleteMediaActionData =
  | { deleted: true }
  | { deleted: false; inUse: true; usages: MediaUsage[] };

export async function deleteMediaAction(id: string): Promise<ActionResult<DeleteMediaActionData>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("media.delete");
    const parsedId = mediaIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid media id.");

    const result: DeleteMediaResult = await deleteMedia(parsedId.data, actor);
    if (!result.deleted) {
      return fail(`"${result.filename}" is still in use and cannot be deleted.`);
    }
    revalidate();
    return ok({ deleted: true }, `Deleted "${result.filename}".`);
  });
}

export async function bulkDeleteMediaAction(ids: string[]): Promise<ActionResult<BulkDeleteResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("media.delete");
    const parsed = bulkDeleteSchema.safeParse({ ids });
    if (!parsed.success) return zodFail(parsed.error);

    const result = await bulkDeleteMedia(parsed.data.ids, actor);
    revalidate();

    const parts = [`${result.deleted.length} deleted`];
    if (result.blocked.length > 0) parts.push(`${result.blocked.length} still in use`);
    if (result.missing.length > 0) parts.push(`${result.missing.length} already gone`);
    return ok(result, parts.join(", ") + ".");
  });
}

export async function bulkMoveMediaAction(ids: string[], folderId: string | null): Promise<ActionResult<{ moved: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("media.upload");
    const parsed = bulkMoveSchema.safeParse({ ids, folderId });
    if (!parsed.success) return zodFail(parsed.error);

    const result = await moveMedia(parsed.data.ids, parsed.data.folderId, actor);
    revalidate();
    return ok(result, `Moved ${result.moved} file${result.moved === 1 ? "" : "s"}.`);
  });
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export type FolderActionData = { id: string; name: string; path: string; parentId: string | null };

export async function createFolderAction(input: { name: string; parentId?: string | null }): Promise<ActionResult<FolderActionData>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("media.upload");
    const parsed = createFolderSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const folder = await createFolder(parsed.data, actor);
    revalidate();
    return ok(
      { id: folder.id, name: folder.name, path: folder.path, parentId: folder.parentId },
      `Created folder "${folder.name}".`,
    );
  });
}

export async function renameFolderAction(id: string, input: { name: string }): Promise<ActionResult<FolderActionData>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("media.upload");
    const parsedId = mediaIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid folder id.");
    const parsed = renameFolderSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const folder = await renameFolder(parsedId.data, parsed.data.name, actor);
    revalidate();
    return ok({ id: folder.id, name: folder.name, path: folder.path, parentId: folder.parentId }, `Renamed to "${folder.name}".`);
  });
}

export async function moveFolderAction(id: string, input: { parentId: string | null }): Promise<ActionResult<FolderActionData>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("media.upload");
    const parsedId = mediaIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid folder id.");
    const parsed = moveFolderSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const folder = await moveFolder(parsedId.data, parsed.data.parentId, actor);
    revalidate();
    return ok({ id: folder.id, name: folder.name, path: folder.path, parentId: folder.parentId }, `Moved "${folder.name}".`);
  });
}

export async function deleteFolderAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("media.delete");
    const parsedId = mediaIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid folder id.");

    await deleteFolder(parsedId.data, actor);
    revalidate();
    return ok({ id: parsedId.data }, "Folder deleted.");
  });
}
