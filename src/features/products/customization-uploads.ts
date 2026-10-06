import type { Prisma } from "@prisma/client";

import { badRequest } from "@/lib/api/errors";
import { kindForMime } from "@/lib/storage";
import { PRIVATE_FILE_ROUTE } from "@/features/media/service";

/**
 * Exchange PendingUpload tokens for MediaAsset rows (blueprint §14.D6).
 *
 * `POST /api/v1/uploads/customization` stores the bytes PRIVATE under the
 * PendingUpload's storageKey and hands the customer an opaque token. When the
 * order is placed, the ORDERS module calls this inside its transaction: each
 * token becomes a PRIVATE MediaAsset pointing at the already-stored object,
 * and the PendingUpload row is deleted so the purge job never removes a file
 * an order now references. Expired or unknown tokens abort the whole order -
 * a line with a missing photo must not be accepted silently.
 *
 * No `server-only` / `next/*` imports (the orders service and tests run as
 * plain tsx).
 */

type Db = Prisma.TransactionClient;

export type ConsumedUpload = { token: string; mediaAssetId: string; url: string; mimeType: string; sizeBytes: number };

export type ConsumeUploadOptions = {
  visibility?: "PRIVATE";
  /** Media folder path to file the assets under, created when missing. */
  folderPath?: string;
  /** Display filename prefix; the token suffix keeps names unique. */
  filenamePrefix?: string;
  uploadedById?: string | null;
  now?: Date;
};

async function ensureFolder(tx: Db, folderPath: string): Promise<string> {
  const segments = folderPath.split("/").map((segment) => segment.trim()).filter(Boolean);
  let parentId: string | null = null;
  let path = "";
  for (const segment of segments) {
    path = path ? `${path}/${segment}` : segment;
    const existing = await tx.mediaFolder.findUnique({ where: { path }, select: { id: true } });
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const created: { id: string } = await tx.mediaFolder.create({ data: { path, name: segment, parentId }, select: { id: true } });
    parentId = created.id;
  }
  if (!parentId) throw new Error("folderPath must have at least one segment.");
  return parentId;
}

export async function consumeUploadTokens(
  tx: Db,
  tokens: readonly string[],
  options: ConsumeUploadOptions = {},
): Promise<ConsumedUpload[]> {
  const unique = [...new Set(tokens.filter((token) => typeof token === "string" && token.length > 0))];
  if (unique.length === 0) return [];

  const now = options.now ?? new Date();
  const rows = await tx.pendingUpload.findMany({ where: { token: { in: unique } } });
  const byToken = new Map(rows.map((row) => [row.token, row]));

  const missing = unique.filter((token) => !byToken.has(token));
  if (missing.length > 0) {
    throw badRequest("One of the uploaded files is no longer available. Please upload it again.", {
      uploadTokens: `${missing.length} unknown token${missing.length === 1 ? "" : "s"}`,
    });
  }
  const expired = rows.filter((row) => row.expiresAt <= now);
  if (expired.length > 0) {
    throw badRequest("One of the uploaded files has expired. Please upload it again.", {
      uploadTokens: `${expired.length} expired token${expired.length === 1 ? "" : "s"}`,
    });
  }

  const folderId = await ensureFolder(tx, options.folderPath ?? "customizations");
  const prefix = options.filenamePrefix ?? "customization";
  const results: ConsumedUpload[] = [];

  for (const token of unique) {
    const pending = byToken.get(token)!;
    const ext = pending.storageKey.split(".").pop() ?? "bin";
    const created: { id: string } = await tx.mediaAsset.create({
      data: {
        url: `pending:${pending.storageKey}`,
        storageKey: pending.storageKey,
        storageProvider: "local",
        visibility: "PRIVATE",
        filename: `${prefix}-${token.slice(0, 8)}.${ext}`,
        kind: kindForMime(pending.mimeType),
        mimeType: pending.mimeType,
        sizeBytes: pending.sizeBytes,
        folderId,
        uploadedById: options.uploadedById ?? null,
      },
      select: { id: true },
    });
    const asset = await tx.mediaAsset.update({
      where: { id: created.id },
      data: { url: PRIVATE_FILE_ROUTE(created.id) },
      select: { id: true, url: true },
    });
    await tx.pendingUpload.delete({ where: { id: pending.id } });
    results.push({ token, mediaAssetId: asset.id, url: asset.url, mimeType: pending.mimeType, sizeBytes: pending.sizeBytes });
  }

  // The storage driver in use is recorded on the asset so the private file
  // route reads from the right adapter; fix up when not local.
  const driver = process.env.STORAGE_DRIVER === "s3" ? "s3" : "local";
  if (driver !== "local") {
    await tx.mediaAsset.updateMany({
      where: { id: { in: results.map((row) => row.mediaAssetId) } },
      data: { storageProvider: driver },
    });
  }

  return results;
}

/** Mime types keyed by token, for validateCustomizationAnswers' file check. */
export async function pendingUploadMimeTypes(tx: Db, tokens: readonly string[]): Promise<Record<string, string>> {
  const unique = [...new Set(tokens)];
  if (unique.length === 0) return {};
  const rows = await tx.pendingUpload.findMany({ where: { token: { in: unique } }, select: { token: true, mimeType: true } });
  return Object.fromEntries(rows.map((row) => [row.token, row.mimeType]));
}
