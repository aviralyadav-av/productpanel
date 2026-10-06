import type { MediaKind, MediaVisibility } from "@/lib/enums";
import type { PickedAsset } from "@/components/shared/media-picker";

/**
 * Wire shapes for the media library. Client components, the picker dialog and
 * the REST responses all speak these; nothing here imports Prisma so the types
 * can travel into client bundles.
 */

export type MediaAssetDto = {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  filename: string;
  kind: MediaKind;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  checksum: string | null;
  alt: string | null;
  folderId: string | null;
  visibility: MediaVisibility;
  storageProvider: string;
  storageKey: string | null;
  uploadedById: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MediaFolderDto = {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  /** 0 for a root folder. */
  depth: number;
  /** Assets directly inside this folder. */
  assetCount: number;
  /** Assets in this folder and every descendant. */
  totalCount: number;
  createdAt: string;
};

/** The columns the mapper needs; a full Prisma MediaAsset satisfies it. */
export type MediaAssetLike = {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  filename: string;
  kind: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  checksum: string | null;
  alt: string | null;
  folderId: string | null;
  visibility: string;
  storageProvider: string;
  storageKey: string | null;
  uploadedById: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function iso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function asKind(value: string): MediaKind {
  return value === "video" || value === "document" ? value : "image";
}

function asVisibility(value: string): MediaVisibility {
  return value === "PRIVATE" ? "PRIVATE" : "PUBLIC";
}

export function toMediaAssetDto(row: MediaAssetLike): MediaAssetDto {
  return {
    id: row.id,
    url: row.url,
    thumbnailUrl: row.thumbnailUrl,
    filename: row.filename,
    kind: asKind(row.kind),
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
    alt: row.alt,
    folderId: row.folderId,
    visibility: asVisibility(row.visibility),
    storageProvider: row.storageProvider,
    storageKey: row.storageKey,
    uploadedById: row.uploadedById,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** The flat shape feature editors receive from the picker (media-picker.tsx). */
export function toPickedAsset(asset: MediaAssetDto): PickedAsset {
  return {
    id: asset.id,
    url: asset.url,
    thumbnailUrl: asset.thumbnailUrl,
    alt: asset.alt,
    filename: asset.filename,
    kind: asset.kind,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType,
  };
}
