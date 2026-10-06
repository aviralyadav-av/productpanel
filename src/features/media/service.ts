import type { MediaAsset, MediaFolder, Prisma } from "@prisma/client";

import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";
import type { MediaKind, MediaVisibility } from "@/lib/enums";
import {
  ImageProcessingError,
  icoDimensions,
  looksLikeSvg,
  processImageUpload,
  rasterizeSvgThumbnail,
  sanitizeSvg,
  sha256,
  type Thumbnail,
} from "@/lib/images";
import {
  buildStorageKey,
  extensionForMime,
  getStorage,
  isAllowedMime,
  kindForMime,
  sniffMime,
  type StorageAdapter,
} from "@/lib/storage";
import { slugify } from "@/lib/validation";

import { toMediaAssetDto, type MediaAssetDto } from "@/features/media/dto";
import {
  MAX_UPLOAD_BYTES,
  sanitizeFilename,
  type CreateFolderInput,
  type UpdateFolderInput,
  type UpdateMediaInput,
  type UploadFile,
} from "@/features/media/schemas";
import { getMediaUsage, type MediaUsage } from "@/features/media/usage";

/**
 * Media library mutations (blueprint §1 Media, §11.20, §11.22, §14.D6, D13).
 *
 * The rules, in one place so routes and actions cannot drift:
 *
 *  - The browser's Content-Type and filename are claims, not facts. The type
 *    is decided by magic bytes (`sniffMime`), the claim must at least agree on
 *    the KIND, and the filename is reduced to display text with the detected
 *    extension.
 *  - Raster images are re-encoded (EXIF gone, orientation applied, bounded),
 *    SVGs are allowlist-sanitised or refused, everything else is stored as-is
 *    after the size cap.
 *  - Storage keys are random (`buildStorageKey`); the thumbnail lives beside
 *    the original as `<key>.thumb.webp`. PRIVATE assets get no thumbnail and no
 *    public URL - they are reachable only through the audited admin file route.
 *  - Bytes are written BEFORE the row and removed AFTER the row is gone, so a
 *    crash can leave an orphan file (harmless, sweepable) but never a row
 *    pointing at nothing.
 *  - Deleting an asset that anything references is refused with the usage
 *    list; the FK `Restrict` in the schema is the backstop for races.
 *
 * No `server-only` / `next/*` imports: the seed and the check script call
 * this as plain tsx (G3).
 */

export type MediaActor = AuditActor;

export type ClientInfo = { ip?: string | null; userAgent?: string | null };

export type UploadMediaInput = ClientInfo & {
  file: UploadFile;
  folderId?: string | null;
  visibility?: MediaVisibility;
  alt?: string | null;
  actor: MediaActor;
};

export type DeleteMediaResult =
  | { deleted: true; id: string; filename: string }
  | { deleted: false; inUse: true; id: string; filename: string; usages: MediaUsage[] };

export type BulkDeleteResult = {
  deleted: string[];
  blocked: Array<{ id: string; filename: string; usages: MediaUsage[] }>;
  missing: string[];
};

export const PRIVATE_FILE_ROUTE = (id: string) => `/api/admin/media/${id}/file`;
export const THUMBNAIL_SUFFIX = ".thumb.webp";
export const MAX_FOLDER_DEPTH = 6;

// ---------------------------------------------------------------------------
// Type detection and processing
// ---------------------------------------------------------------------------

type PreparedUpload = {
  kind: MediaKind;
  mimeType: string;
  ext: string;
  body: Buffer;
  width: number | null;
  height: number | null;
  checksum: string;
  thumbnail: Thumbnail | null;
};

function isPrismaCode(error: unknown, code: string): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === code &&
    "clientVersion" in error
  );
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Detect the real type. `sniffMime` knows every binary type we accept; SVG is
 * text and is recognised by its root element instead.
 */
export function detectMimeType(buffer: Buffer): string | null {
  const sniffed = sniffMime(buffer);
  if (sniffed) return sniffed;
  if (buffer.byteLength <= 2 * 1024 * 1024 && looksLikeSvg(buffer.toString("utf8", 0, Math.min(buffer.byteLength, 4096)))) {
    return "image/svg+xml";
  }
  return null;
}

/** Validate and normalise the bytes for one upload. Throws ApiError (400) on refusal. */
export async function prepareUpload(file: UploadFile, visibility: MediaVisibility): Promise<PreparedUpload> {
  if (!file.buffer || file.buffer.byteLength === 0) throw badRequest("The file is empty.");

  const detected = detectMimeType(file.buffer);
  if (!detected || !isAllowedMime(detected)) {
    throw badRequest(
      "Unsupported file type. Accepted: JPEG, PNG, WebP, GIF, AVIF, SVG, ICO images; MP4/WebM video; PDF documents.",
      { file: "Unsupported file type." },
    );
  }

  // A declared type we recognise must agree on the kind: "video/mp4" bytes
  // sent as "image/png" is either a broken client or an attempt to sneak a
  // non-image into an image slot.
  const declared = file.mimeType?.toLowerCase() ?? null;
  if (declared && isAllowedMime(declared) && kindForMime(declared) !== kindForMime(detected)) {
    throw badRequest("The file's content does not match its declared type.", {
      file: `Declared ${declared}, detected ${detected}.`,
    });
  }

  const kind = kindForMime(detected);
  const cap = MAX_UPLOAD_BYTES[kind];
  if (file.buffer.byteLength > cap) {
    throw badRequest(`${kind === "image" ? "Images" : kind === "video" ? "Videos" : "Documents"} must be under ${formatMb(cap)}.`, {
      file: `Too large (${formatMb(file.buffer.byteLength)}).`,
    });
  }

  const wantThumbnail = visibility === "PUBLIC";

  if (detected === "image/svg+xml") {
    const result = sanitizeSvg(file.buffer.toString("utf8"));
    if (!result.ok) throw badRequest(result.reason, { file: result.reason });
    const body = Buffer.from(result.svg, "utf8");
    return {
      kind,
      mimeType: detected,
      ext: "svg",
      body,
      width: result.width,
      height: result.height,
      checksum: sha256(body),
      thumbnail: wantThumbnail ? await rasterizeSvgThumbnail(result.svg) : null,
    };
  }

  if (detected === "image/x-icon") {
    const dims = icoDimensions(file.buffer);
    if (!dims) throw badRequest("The ICO file header is invalid.", { file: "Invalid ICO." });
    return {
      kind,
      mimeType: detected,
      ext: "ico",
      body: file.buffer,
      width: dims.width,
      height: dims.height,
      checksum: sha256(file.buffer),
      thumbnail: null,
    };
  }

  if (kind === "image") {
    try {
      const processed = await processImageUpload(file.buffer, { thumbnail: wantThumbnail });
      return {
        kind,
        mimeType: processed.mimeType,
        ext: processed.ext,
        body: processed.buffer,
        width: processed.width,
        height: processed.height,
        checksum: processed.checksum,
        thumbnail: processed.thumbnail,
      };
    } catch (error) {
      if (error instanceof ImageProcessingError) throw badRequest(error.message, { file: error.message });
      throw error;
    }
  }

  // Video and PDF: stored byte-for-byte. No decoder exists here that could
  // prove more than the magic bytes already did.
  return {
    kind,
    mimeType: detected,
    ext: extensionForMime(detected) ?? "bin",
    body: file.buffer,
    width: null,
    height: null,
    checksum: sha256(file.buffer),
    thumbnail: null,
  };
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

type StoredFiles = {
  key: string;
  url: string | null;
  thumbnailKey: string | null;
  thumbnailUrl: string | null;
};

async function storeFiles(
  storage: StorageAdapter,
  prepared: PreparedUpload,
  folderPath: string | null,
  visibility: MediaVisibility,
): Promise<StoredFiles> {
  const key = buildStorageKey({ folder: folderPath ?? "uploads", ext: prepared.ext });
  const original = await storage.put({ key, body: prepared.body, contentType: prepared.mimeType, visibility });

  let thumbnailKey: string | null = null;
  let thumbnailUrl: string | null = null;
  if (prepared.thumbnail && visibility === "PUBLIC") {
    thumbnailKey = `${key}${THUMBNAIL_SUFFIX}`;
    try {
      const thumb = await storage.put({
        key: thumbnailKey,
        body: prepared.thumbnail.buffer,
        contentType: prepared.thumbnail.mimeType,
        visibility,
      });
      thumbnailUrl = thumb.url;
    } catch (error) {
      await storage.delete(key, visibility).catch(() => undefined);
      throw error;
    }
  }

  return { key, url: original.url, thumbnailKey, thumbnailUrl };
}

/** Best-effort removal; a missing object is not an error. */
async function removeFiles(
  storage: StorageAdapter,
  asset: Pick<MediaAsset, "storageKey" | "storageProvider" | "visibility" | "thumbnailUrl">,
): Promise<void> {
  if (!asset.storageKey || asset.storageProvider === "external") return;
  const visibility: MediaVisibility = asset.visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC";
  const keys = [asset.storageKey];
  if (asset.thumbnailUrl) keys.push(`${asset.storageKey}${THUMBNAIL_SUFFIX}`);
  for (const key of keys) {
    try {
      await storage.delete(key, visibility);
    } catch (error) {
      console.error("MEDIA STORAGE DELETE FAILED", key, error);
    }
  }
}

async function requireFolder(id: string, client: Prisma.TransactionClient | typeof db = db): Promise<MediaFolder> {
  const folder = await client.mediaFolder.findUnique({ where: { id } });
  if (!folder) throw notFound("Folder");
  return folder;
}

async function requireAsset(id: string, client: Prisma.TransactionClient | typeof db = db): Promise<MediaAsset> {
  const asset = await client.mediaAsset.findUnique({ where: { id } });
  if (!asset) throw notFound("Media asset");
  return asset;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export async function uploadMedia(input: UploadMediaInput): Promise<MediaAssetDto> {
  const visibility: MediaVisibility = input.visibility ?? "PUBLIC";
  const folder = input.folderId ? await requireFolder(input.folderId) : null;
  const prepared = await prepareUpload(input.file, visibility);
  const filename = sanitizeFilename(input.file.filename, prepared.mimeType);

  const storage = await getStorage();
  const stored = await storeFiles(storage, prepared, folder?.path ?? null, visibility);

  try {
    const row = await db.$transaction(async (tx) => {
      const created = await tx.mediaAsset.create({
        data: {
          // PRIVATE assets have no storage URL; the admin route is keyed by
          // id, which does not exist until this insert returns. `url` is
          // unique, so the interim value is the (already unique) key.
          url: stored.url ?? `pending:${stored.key}`,
          storageKey: stored.key,
          storageProvider: storage.driver,
          visibility,
          filename,
          kind: prepared.kind,
          mimeType: prepared.mimeType,
          width: prepared.width,
          height: prepared.height,
          sizeBytes: prepared.body.byteLength,
          checksum: prepared.checksum,
          alt: input.alt ?? null,
          folderId: folder?.id ?? null,
          thumbnailUrl: stored.thumbnailUrl,
          uploadedById: input.actor.id === "system" ? null : input.actor.id,
        },
      });

      const asset =
        stored.url === null
          ? await tx.mediaAsset.update({ where: { id: created.id }, data: { url: PRIVATE_FILE_ROUTE(created.id) } })
          : created;

      await writeAudit(tx, {
        actor: input.actor,
        action: "media.upload",
        entityType: "MediaAsset",
        entityId: asset.id,
        entityLabel: asset.filename,
        summary: `Uploaded ${asset.kind} "${asset.filename}" (${formatMb(asset.sizeBytes ?? 0)}, ${visibility.toLowerCase()})${folder ? ` to ${folder.path}` : ""}.`,
        diff: {
          kind: asset.kind,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          width: asset.width,
          height: asset.height,
          visibility,
          folderId: asset.folderId,
          storageKey: asset.storageKey,
        },
        ip: input.ip,
        userAgent: input.userAgent,
      });

      return asset;
    });

    return toMediaAssetDto(row);
  } catch (error) {
    // The row never landed: do not leave its bytes behind.
    await removeFiles(storage, {
      storageKey: stored.key,
      storageProvider: storage.driver,
      visibility,
      thumbnailUrl: stored.thumbnailUrl,
    });
    throw error;
  }
}

/**
 * Swap the bytes behind an existing asset. Id, folder, alt and visibility are
 * kept so every product/banner/category pointing at it picks up the new file;
 * the storage key (and therefore the public URL) changes because keys are
 * immutable-cached for a year.
 */
export async function replaceMedia(
  id: string,
  file: UploadFile,
  actor: MediaActor,
  client: ClientInfo = {},
): Promise<MediaAssetDto> {
  const existing = await requireAsset(id);
  if (existing.storageProvider === "external") {
    throw conflict("This asset points at an external URL and has no stored file to replace.");
  }
  const visibility: MediaVisibility = existing.visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC";
  const prepared = await prepareUpload(file, visibility);
  if (prepared.kind !== existing.kind) {
    throw conflict(`Replace a ${existing.kind} with another ${existing.kind}; upload a new asset to change the kind.`);
  }

  const folder = existing.folderId ? await db.mediaFolder.findUnique({ where: { id: existing.folderId } }) : null;
  const storage = await getStorage();
  const stored = await storeFiles(storage, prepared, folder?.path ?? null, visibility);
  const filename = sanitizeFilename(file.filename, prepared.mimeType);

  let updated: MediaAsset;
  try {
    updated = await db.$transaction(async (tx) => {
      const row = await tx.mediaAsset.update({
        where: { id },
        data: {
          url: stored.url ?? PRIVATE_FILE_ROUTE(id),
          storageKey: stored.key,
          storageProvider: storage.driver,
          filename,
          mimeType: prepared.mimeType,
          width: prepared.width,
          height: prepared.height,
          sizeBytes: prepared.body.byteLength,
          checksum: prepared.checksum,
          thumbnailUrl: stored.thumbnailUrl,
        },
      });
      await writeAudit(tx, {
        actor,
        action: "media.replace",
        entityType: "MediaAsset",
        entityId: id,
        entityLabel: row.filename,
        summary: `Replaced file behind "${existing.filename}" with "${row.filename}" (${formatMb(row.sizeBytes ?? 0)}).`,
        diff: diffOf(
          { filename: existing.filename, mimeType: existing.mimeType, sizeBytes: existing.sizeBytes, width: existing.width, height: existing.height, storageKey: existing.storageKey },
          { filename: row.filename, mimeType: row.mimeType, sizeBytes: row.sizeBytes, width: row.width, height: row.height, storageKey: row.storageKey },
        ),
        ip: client.ip,
        userAgent: client.userAgent,
      });
      return row;
    });
  } catch (error) {
    await removeFiles(storage, {
      storageKey: stored.key,
      storageProvider: storage.driver,
      visibility,
      thumbnailUrl: stored.thumbnailUrl,
    });
    throw error;
  }

  // Committed: the old bytes are unreachable from any row now.
  await removeFiles(storage, existing);
  return toMediaAssetDto(updated);
}

export async function updateMedia(
  id: string,
  patch: UpdateMediaInput,
  actor: MediaActor,
  client: ClientInfo = {},
): Promise<MediaAssetDto> {
  const existing = await requireAsset(id);
  if (patch.folderId) await requireFolder(patch.folderId);

  const data: Prisma.MediaAssetUpdateInput = {};
  if (patch.alt !== undefined) data.alt = patch.alt;
  if (patch.folderId !== undefined) {
    data.folder = patch.folderId ? { connect: { id: patch.folderId } } : { disconnect: true };
  }
  if (patch.filename !== undefined) {
    data.filename = existing.mimeType ? sanitizeFilename(patch.filename, existing.mimeType) : patch.filename.trim();
  }

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.mediaAsset.update({ where: { id }, data });
    await writeAudit(tx, {
      actor,
      action: "media.update",
      entityType: "MediaAsset",
      entityId: id,
      entityLabel: row.filename,
      summary: `Updated media "${row.filename}".`,
      diff: diffOf(
        { alt: existing.alt, folderId: existing.folderId, filename: existing.filename },
        { alt: row.alt, folderId: row.folderId, filename: row.filename },
      ),
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return row;
  });

  return toMediaAssetDto(updated);
}

/**
 * Refuses while anything references the asset (§11.22). The result is a value,
 * not an exception, because "in use" is an expected outcome the UI renders
 * (the usage list with links), not an error.
 */
export async function deleteMedia(id: string, actor: MediaActor, client: ClientInfo = {}): Promise<DeleteMediaResult> {
  const existing = await requireAsset(id);

  const usages = await getMediaUsage(id);
  if (usages.length > 0) {
    return { deleted: false, inUse: true, id, filename: existing.filename, usages };
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.mediaAsset.delete({ where: { id } });
      await writeAudit(tx, {
        actor,
        action: "media.delete",
        entityType: "MediaAsset",
        entityId: id,
        entityLabel: existing.filename,
        summary: `Deleted ${existing.kind} "${existing.filename}".`,
        diff: {
          kind: existing.kind,
          mimeType: existing.mimeType,
          sizeBytes: existing.sizeBytes,
          storageKey: existing.storageKey,
          visibility: existing.visibility,
          folderId: existing.folderId,
        },
        ip: client.ip,
        userAgent: client.userAgent,
      });
    });
  } catch (error) {
    // A reference appeared between the usage check and the delete: the FK
    // Restrict caught it. Report it the same way as the pre-check would have.
    if (isPrismaCode(error, "P2003")) {
      return { deleted: false, inUse: true, id, filename: existing.filename, usages: await getMediaUsage(id) };
    }
    throw error;
  }

  const storage = await getStorage();
  await removeFiles(storage, existing);
  return { deleted: true, id, filename: existing.filename };
}

export async function bulkDeleteMedia(ids: readonly string[], actor: MediaActor, client: ClientInfo = {}): Promise<BulkDeleteResult> {
  const result: BulkDeleteResult = { deleted: [], blocked: [], missing: [] };

  for (const id of new Set(ids)) {
    const asset = await db.mediaAsset.findUnique({ where: { id }, select: { id: true } });
    if (!asset) {
      result.missing.push(id);
      continue;
    }
    const outcome = await deleteMedia(id, actor, client);
    if (outcome.deleted) result.deleted.push(id);
    else result.blocked.push({ id, filename: outcome.filename, usages: outcome.usages });
  }

  if (ids.length > 1) {
    await writeAudit({
      actor,
      action: "media.bulk_delete",
      entityType: "MediaAsset",
      summary: `Bulk delete: ${result.deleted.length} deleted, ${result.blocked.length} in use, ${result.missing.length} missing (${ids.length} selected).`,
      diff: { deleted: result.deleted.length, blocked: result.blocked.length, missing: result.missing.length },
      ip: client.ip,
      userAgent: client.userAgent,
    });
  }

  return result;
}

export async function moveMedia(
  ids: readonly string[],
  folderId: string | null,
  actor: MediaActor,
  client: ClientInfo = {},
): Promise<{ moved: number }> {
  const folder = folderId ? await requireFolder(folderId) : null;
  const unique = [...new Set(ids)];

  const moved = await db.$transaction(async (tx) => {
    const { count } = await tx.mediaAsset.updateMany({ where: { id: { in: unique } }, data: { folderId: folder?.id ?? null } });
    await writeAudit(tx, {
      actor,
      action: "media.move",
      entityType: "MediaAsset",
      entityId: unique.length === 1 ? unique[0] : null,
      entityLabel: folder?.path ?? "(root)",
      summary: `Moved ${count} file${count === 1 ? "" : "s"} to ${folder ? `folder "${folder.path}"` : "the library root"}.`,
      diff: { count, folderId: folder?.id ?? null },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return count;
  });

  return { moved };
}

/** Where the asset is referenced. Re-exported so callers need one import. */
export { getMediaUsage as getUsage };

/**
 * D6/D13: every read of a PRIVATE file is recorded. Best-effort (the file is
 * already being streamed; failing the download because the log write failed
 * would help nobody), but never silent.
 */
export async function auditPrivateRead(
  asset: Pick<MediaAsset, "id" | "filename" | "kind" | "sizeBytes">,
  actor: MediaActor,
  client: ClientInfo = {},
): Promise<void> {
  await writeAudit({
    actor,
    action: "media.private_read",
    entityType: "MediaAsset",
    entityId: asset.id,
    entityLabel: asset.filename,
    summary: `Read private ${asset.kind} "${asset.filename}".`,
    diff: { sizeBytes: asset.sizeBytes },
    ip: client.ip,
    userAgent: client.userAgent,
  });
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

function folderSlug(name: string): string {
  return slugify(name).slice(0, 60) || "folder";
}

function depthOf(path: string): number {
  return path.split("/").length - 1;
}

function lastSegment(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Rewrite this folder's path and every descendant's in one transaction so the
 * tree never has a moment where a child's path disagrees with its parent's.
 * Paths are unique, so a collision surfaces as P2002 → 409.
 */
async function rewritePaths(
  tx: Prisma.TransactionClient,
  folder: MediaFolder,
  newPath: string,
  extra: Prisma.MediaFolderUpdateInput = {},
): Promise<{ folders: number }> {
  const descendants = await tx.mediaFolder.findMany({
    where: { path: { startsWith: `${folder.path}/` } },
    select: { id: true, path: true },
  });

  await tx.mediaFolder.update({ where: { id: folder.id }, data: { ...extra, path: newPath } });
  for (const child of descendants) {
    await tx.mediaFolder.update({
      where: { id: child.id },
      data: { path: `${newPath}${child.path.slice(folder.path.length)}` },
    });
  }
  return { folders: descendants.length + 1 };
}

export async function createFolder(input: CreateFolderInput, actor: MediaActor, client: ClientInfo = {}): Promise<MediaFolder> {
  const parent = input.parentId ? await requireFolder(input.parentId) : null;
  const path = parent ? `${parent.path}/${folderSlug(input.name)}` : folderSlug(input.name);

  if (depthOf(path) >= MAX_FOLDER_DEPTH) {
    throw conflict(`Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep.`);
  }

  try {
    return await db.$transaction(async (tx) => {
      const folder = await tx.mediaFolder.create({
        data: { name: input.name, path, parentId: parent?.id ?? null },
      });
      await writeAudit(tx, {
        actor,
        action: "media.folder.create",
        entityType: "MediaFolder",
        entityId: folder.id,
        entityLabel: folder.path,
        summary: `Created media folder "${folder.path}".`,
        diff: { name: folder.name, path: folder.path, parentId: folder.parentId },
        ip: client.ip,
        userAgent: client.userAgent,
      });
      return folder;
    });
  } catch (error) {
    if (isPrismaCode(error, "P2002")) {
      throw conflict("A folder with that name already exists here.", { name: "Already in use." });
    }
    throw error;
  }
}

export async function renameFolder(id: string, name: string, actor: MediaActor, client: ClientInfo = {}): Promise<MediaFolder> {
  const folder = await requireFolder(id);
  const parentPath = folder.path.includes("/") ? folder.path.slice(0, folder.path.lastIndexOf("/")) : null;
  const newPath = parentPath ? `${parentPath}/${folderSlug(name)}` : folderSlug(name);

  try {
    return await db.$transaction(async (tx) => {
      const { folders } = await rewritePaths(tx, folder, newPath, { name });
      const updated = await tx.mediaFolder.findUniqueOrThrow({ where: { id } });
      await writeAudit(tx, {
        actor,
        action: "media.folder.rename",
        entityType: "MediaFolder",
        entityId: id,
        entityLabel: updated.path,
        summary: `Renamed media folder "${folder.path}" to "${updated.path}" (${folders} path${folders === 1 ? "" : "s"} rewritten).`,
        diff: diffOf({ name: folder.name, path: folder.path }, { name: updated.name, path: updated.path }),
        ip: client.ip,
        userAgent: client.userAgent,
      });
      return updated;
    });
  } catch (error) {
    if (isPrismaCode(error, "P2002")) {
      throw conflict("A folder with that name already exists here.", { name: "Already in use." });
    }
    throw error;
  }
}

export async function moveFolder(
  id: string,
  parentId: string | null,
  actor: MediaActor,
  client: ClientInfo = {},
): Promise<MediaFolder> {
  const folder = await requireFolder(id);
  if (parentId === folder.parentId) return folder;

  const parent = parentId ? await requireFolder(parentId) : null;
  if (parent && (parent.id === folder.id || parent.path === folder.path || parent.path.startsWith(`${folder.path}/`))) {
    throw conflict("A folder cannot be moved into itself or one of its own subfolders.");
  }

  const newPath = parent ? `${parent.path}/${lastSegment(folder.path)}` : lastSegment(folder.path);

  // The deepest descendant must still fit under MAX_FOLDER_DEPTH after the move.
  const deepest = await db.mediaFolder.findFirst({
    where: { path: { startsWith: `${folder.path}/` } },
    orderBy: { path: "desc" },
    select: { path: true },
  });
  const subtreeDepth = deepest ? depthOf(deepest.path) - depthOf(folder.path) : 0;
  if (depthOf(newPath) + subtreeDepth >= MAX_FOLDER_DEPTH) {
    throw conflict(`That move would nest folders more than ${MAX_FOLDER_DEPTH} levels deep.`);
  }

  try {
    return await db.$transaction(async (tx) => {
      const { folders } = await rewritePaths(tx, folder, newPath, {
        parent: parent ? { connect: { id: parent.id } } : { disconnect: true },
      });
      const updated = await tx.mediaFolder.findUniqueOrThrow({ where: { id } });
      await writeAudit(tx, {
        actor,
        action: "media.folder.move",
        entityType: "MediaFolder",
        entityId: id,
        entityLabel: updated.path,
        summary: `Moved media folder "${folder.path}" to "${updated.path}" (${folders} path${folders === 1 ? "" : "s"} rewritten).`,
        diff: diffOf({ path: folder.path, parentId: folder.parentId }, { path: updated.path, parentId: updated.parentId }),
        ip: client.ip,
        userAgent: client.userAgent,
      });
      return updated;
    });
  } catch (error) {
    if (isPrismaCode(error, "P2002")) {
      throw conflict("A folder with the same name already exists at the destination.", { parentId: "Name clash." });
    }
    throw error;
  }
}

/** PUT /folders/:id - rename and/or move in one call. */
export async function updateFolder(id: string, patch: UpdateFolderInput, actor: MediaActor, client: ClientInfo = {}): Promise<MediaFolder> {
  let folder = await requireFolder(id);
  if (patch.name !== undefined && patch.name !== folder.name) folder = await renameFolder(id, patch.name, actor, client);
  if (patch.parentId !== undefined && patch.parentId !== folder.parentId) folder = await moveFolder(id, patch.parentId, actor, client);
  return folder;
}

/** Only an empty folder (no assets, no subfolders) can go: nothing is ever orphaned implicitly. */
export async function deleteFolder(id: string, actor: MediaActor, client: ClientInfo = {}): Promise<void> {
  const folder = await requireFolder(id);
  const [assets, children] = await Promise.all([
    db.mediaAsset.count({ where: { folderId: id } }),
    db.mediaFolder.count({ where: { parentId: id } }),
  ]);
  if (assets > 0 || children > 0) {
    const parts = [
      assets > 0 ? `${assets} file${assets === 1 ? "" : "s"}` : null,
      children > 0 ? `${children} subfolder${children === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    throw conflict(`Move or delete the ${parts.join(" and ")} inside "${folder.name}" first.`);
  }

  await db.$transaction(async (tx) => {
    await tx.mediaFolder.delete({ where: { id } });
    await writeAudit(tx, {
      actor,
      action: "media.folder.delete",
      entityType: "MediaFolder",
      entityId: id,
      entityLabel: folder.path,
      summary: `Deleted empty media folder "${folder.path}".`,
      diff: { name: folder.name, path: folder.path, parentId: folder.parentId },
      ip: client.ip,
      userAgent: client.userAgent,
    });
  });
}
