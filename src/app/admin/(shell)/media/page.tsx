import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/guards";
import { one, parseListParams, type SearchParams } from "@/lib/list-params";
import { PageHeader } from "@/components/shared/page-header";

import { MediaHeaderActions } from "@/features/media/components/media-header-actions";
import { MediaLibrary } from "@/features/media/components/media-library";
import { UploadQueueProvider } from "@/features/media/components/upload-queue";
import { getFolderTree, getMediaDetail, listMedia } from "@/features/media/queries";
import { parseMediaListFilters, resolveMediaSort, resolveMediaView } from "@/features/media/schemas";

export const metadata: Metadata = { title: "Media Library" };

/**
 * /admin/media (blueprint §1 Media, §14.D6, §11.22).
 *
 * Everything the screen shows is in the URL: `folder` (id | root | absent),
 * `q`, `kind`, `visibility`, `from`/`to`, `sort`, `order`, `page`, `view`
 * (grid | list) and `asset` (the open detail sheet). The three reads run in
 * parallel; the detail read only when a sheet is open.
 */
export default async function MediaPage({ searchParams }: PageProps<"/admin/media">) {
  await requirePermission("media.view");

  const params = (await searchParams) as SearchParams;
  const listParams = parseListParams(params, { defaultSort: "createdAt", defaultOrder: "desc", pageSize: 48 });
  const filters = parseMediaListFilters(params);
  const sort = resolveMediaSort(listParams.sort);
  const view = resolveMediaView(one(params, "view"));
  const assetId = one(params, "asset");

  const [list, tree, detail] = await Promise.all([
    listMedia({ ...listParams, sort }, filters),
    getFolderTree(),
    assetId ? getMediaDetail(assetId) : Promise.resolve(null),
  ]);

  const activeFolderId = filters.folderId;
  const uploadFolderId = activeFolderId && activeFolderId !== "root" ? activeFolderId : null;
  const hasFilters = Boolean(listParams.q || filters.kind || filters.visibility || filters.from || filters.to);

  return (
    <UploadQueueProvider folderId={uploadFolderId}>
      <div className="space-y-4">
        <PageHeader
          title="Media Library"
          description="Every image, video and document the storefront and admin use. Uploads are type-checked by content, images are re-encoded with EXIF stripped and thumbnailed, and a file that is still in use cannot be deleted."
          actions={<MediaHeaderActions folders={tree.folders} currentFolderId={uploadFolderId} />}
        />

        <MediaLibrary
          rows={list.rows}
          meta={list.meta}
          counts={list.counts}
          tree={tree}
          activeFolderId={activeFolderId}
          sort={sort}
          order={listParams.order}
          view={view}
          detail={detail}
          hasFilters={hasFilters}
        />
      </div>
    </UploadQueueProvider>
  );
}
