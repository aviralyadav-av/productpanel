import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { MediaKind } from "@/lib/enums";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";

import { toMediaAssetDto, type MediaAssetDto, type MediaFolderDto } from "@/features/media/dto";
import { resolveMediaSort, type MediaListFilters, type MediaSort } from "@/features/media/schemas";
import { getMediaUsage, type MediaUsage } from "@/features/media/usage";

/**
 * Read side of the media library. Server Components and the REST list route
 * both call these; list state arrives already parsed from the URL
 * (`parseMediaListFilters`) so the same filter vocabulary drives the page,
 * the picker dialog and `GET /api/admin/media`.
 */

export type MediaKindCounts = Record<"all" | MediaKind, number>;

export type MediaListResult = {
  rows: MediaAssetDto[];
  meta: PageMeta;
  /** Per-kind totals for the SAME filters minus `kind`, so the tabs show what each would reveal. */
  counts: MediaKindCounts;
};

const SORT_COLUMN: Record<MediaSort, keyof Prisma.MediaAssetOrderByWithRelationInput> = {
  createdAt: "createdAt",
  updatedAt: "updatedAt",
  filename: "filename",
  sizeBytes: "sizeBytes",
};

export function buildMediaWhere(filters: MediaListFilters, options: { includeKind?: boolean } = {}): Prisma.MediaAssetWhereInput {
  const clauses: Prisma.MediaAssetWhereInput[] = [];

  if ((options.includeKind ?? true) && filters.kind) clauses.push({ kind: filters.kind });
  if (filters.visibility) clauses.push({ visibility: filters.visibility });
  if (filters.folderId === "root") clauses.push({ folderId: null });
  else if (filters.folderId) clauses.push({ folderId: filters.folderId });
  if (filters.uploadedById) clauses.push({ uploadedById: filters.uploadedById });

  if (filters.from || filters.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.from) createdAt.gte = new Date(filters.from);
    if (filters.to) {
      const to = new Date(filters.to);
      // A bare day means "through the end of that day".
      if (/^\d{4}-\d{2}-\d{2}$/.test(filters.to)) to.setUTCHours(23, 59, 59, 999);
      createdAt.lte = to;
    }
    clauses.push({ createdAt });
  }

  if (filters.q) {
    clauses.push({
      OR: [
        { filename: { contains: filters.q, mode: "insensitive" } },
        { alt: { contains: filters.q, mode: "insensitive" } },
        { id: filters.q },
        { storageKey: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }

  return clauses.length > 0 ? { AND: clauses } : {};
}

export async function listMedia(params: ListParams, filters: MediaListFilters): Promise<MediaListResult> {
  const where = buildMediaWhere(filters);
  const kindless = buildMediaWhere(filters, { includeKind: false });
  const sort = resolveMediaSort(params.sort);

  const [rows, total, kindGroups] = await Promise.all([
    db.mediaAsset.findMany({
      where,
      orderBy: [{ [SORT_COLUMN[sort]]: params.order }, { id: params.order }],
      skip: params.skip,
      take: params.pageSize,
    }),
    db.mediaAsset.count({ where }),
    db.mediaAsset.groupBy({ by: ["kind"], where: kindless, _count: { _all: true } }),
  ]);

  const counts: MediaKindCounts = { all: 0, image: 0, video: 0, document: 0 };
  for (const group of kindGroups) {
    const n = group._count._all;
    counts.all += n;
    if (group.kind === "image" || group.kind === "video" || group.kind === "document") counts[group.kind] += n;
  }

  return { rows: rows.map(toMediaAssetDto), meta: buildPageMeta(total, params), counts };
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export type MediaFolderTree = {
  folders: MediaFolderDto[];
  /** Assets with no folder. */
  rootCount: number;
  /** Every asset in the library. */
  totalCount: number;
};

/**
 * Flat, path-sorted list with depth - the tree component nests it. Two
 * counts per folder: direct assets (what clicking it lists) and the subtree
 * total (what deleting it would need moved).
 */
export async function getFolderTree(): Promise<MediaFolderTree> {
  const [folders, groups, rootCount, totalCount] = await Promise.all([
    db.mediaFolder.findMany({ orderBy: { path: "asc" } }),
    db.mediaAsset.groupBy({ by: ["folderId"], where: { folderId: { not: null } }, _count: { _all: true } }),
    db.mediaAsset.count({ where: { folderId: null } }),
    db.mediaAsset.count(),
  ]);

  const direct = new Map<string, number>();
  for (const group of groups) if (group.folderId) direct.set(group.folderId, group._count._all);

  const dtos: MediaFolderDto[] = folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    path: folder.path,
    parentId: folder.parentId,
    depth: folder.path.split("/").length - 1,
    assetCount: direct.get(folder.id) ?? 0,
    totalCount: 0,
    createdAt: folder.createdAt.toISOString(),
  }));

  // Subtree totals: sum direct counts over every folder whose path is under this one.
  for (const folder of dtos) {
    let sum = 0;
    for (const other of dtos) {
      if (other.path === folder.path || other.path.startsWith(`${folder.path}/`)) sum += other.assetCount;
    }
    folder.totalCount = sum;
  }

  return { folders: dtos, rootCount, totalCount };
}

export async function getFolder(id: string): Promise<MediaFolderDto | null> {
  const [folder, assetCount] = await Promise.all([
    db.mediaFolder.findUnique({ where: { id } }),
    db.mediaAsset.count({ where: { folderId: id } }),
  ]);
  if (!folder) return null;
  return {
    id: folder.id,
    name: folder.name,
    path: folder.path,
    parentId: folder.parentId,
    depth: folder.path.split("/").length - 1,
    assetCount,
    totalCount: assetCount,
    createdAt: folder.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type MediaDetail = MediaAssetDto & {
  folder: { id: string; name: string; path: string } | null;
  uploadedBy: { id: string; name: string | null; email: string } | null;
  usages: MediaUsage[];
  usageCount: number;
};

export async function getMediaDetail(id: string): Promise<MediaDetail | null> {
  const [row, usages] = await Promise.all([
    db.mediaAsset.findUnique({
      where: { id },
      include: {
        folder: { select: { id: true, name: true, path: true } },
        uploadedBy: { select: { id: true, name: true, email: true } },
      },
    }),
    getMediaUsage(id),
  ]);
  if (!row) return null;

  return {
    ...toMediaAssetDto(row),
    folder: row.folder,
    uploadedBy: row.uploadedBy,
    usages,
    usageCount: usages.reduce((sum, usage) => sum + usage.count, 0),
  };
}

export async function getMediaAsset(id: string): Promise<MediaAssetDto | null> {
  const row = await db.mediaAsset.findUnique({ where: { id } });
  return row ? toMediaAssetDto(row) : null;
}

/** Several assets by id, in the order asked for (for pickers restoring a saved selection). */
export async function getMediaAssets(ids: readonly string[]): Promise<MediaAssetDto[]> {
  if (ids.length === 0) return [];
  const rows = await db.mediaAsset.findMany({ where: { id: { in: [...ids] } } });
  const byId = new Map(rows.map((row) => [row.id, toMediaAssetDto(row)]));
  return ids.map((id) => byId.get(id)).filter((row): row is MediaAssetDto => Boolean(row));
}
