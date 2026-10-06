"use client";

import * as React from "react";
import { FolderInput, Images, Trash2, X } from "lucide-react";

import { BulkActionBar } from "@/components/shared/bulk-action-bar";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/list-controls";
import { usePermission } from "@/components/shared/permission-gate";
import { useRowSelection } from "@/components/shared/row-selection";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQueryNav } from "@/hooks/use-query-nav";
import type { PageMeta } from "@/lib/list-params";

import { bulkDeleteMediaAction, bulkMoveMediaAction } from "@/features/media/actions";
import { FolderPickerSelect } from "@/features/media/components/folder-dialogs";
import { MediaDetailSheet } from "@/features/media/components/media-detail-sheet";
import { MediaFolderTree } from "@/features/media/components/media-folder-tree";
import { MediaGrid } from "@/features/media/components/media-grid";
import { MediaListTable } from "@/features/media/components/media-list-table";
import { MediaToolbar } from "@/features/media/components/media-toolbar";
import { MediaUploadZone } from "@/features/media/components/media-upload-zone";
import { useUploadQueue } from "@/features/media/components/upload-queue";
import type { MediaAssetDto } from "@/features/media/dto";
import type { MediaDetail, MediaFolderTree as FolderTreeData, MediaKindCounts } from "@/features/media/queries";
import type { MediaSort, MediaView } from "@/features/media/schemas";
import type { BulkDeleteResult } from "@/features/media/service";

/**
 * The library screen below the page header. Data arrives from the Server
 * Component page; this component owns only what is genuinely client state:
 * row selection, the bulk-move dialog and the "blocked" report after a bulk
 * delete. Everything else (folder, filters, page, open asset) is in the URL.
 */
export function MediaLibrary({
  rows,
  meta,
  counts,
  tree,
  activeFolderId,
  sort,
  order,
  view,
  detail,
  hasFilters,
}: {
  rows: MediaAssetDto[];
  meta: PageMeta;
  counts: MediaKindCounts;
  tree: FolderTreeData;
  /** undefined = all, "root" = unfiled, else a folder id. */
  activeFolderId: string | undefined;
  sort: MediaSort;
  order: "asc" | "desc";
  view: MediaView;
  detail: MediaDetail | null;
  hasFilters: boolean;
}) {
  const { navigate } = useQueryNav();
  const { run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const queue = useUploadQueue();
  const canUpload = usePermission("media.upload");
  const canDelete = usePermission("media.delete");

  const selection = useRowSelection(rows.map((row) => row.id));
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [moveTarget, setMoveTarget] = React.useState<string | null>(null);
  const [blocked, setBlocked] = React.useState<BulkDeleteResult["blocked"]>([]);

  const openAsset = React.useCallback((asset: MediaAssetDto) => navigate({ asset: asset.id }), [navigate]);
  const closeAsset = React.useCallback(() => navigate({ asset: null }), [navigate]);

  async function bulkDelete() {
    const ids = selection.selectedIds;
    const result = await confirm({
      title: `Delete ${ids.length} file${ids.length === 1 ? "" : "s"}?`,
      description: "Files still referenced by a product, banner, category or page are skipped and listed afterwards.",
      confirmLabel: "Delete",
      destructive: true,
      requireTypedText: ids.length >= 10 ? "DELETE" : undefined,
    });
    if (!result.ok) return;
    const outcome = await run(() => bulkDeleteMediaAction(ids));
    if (outcome.ok) {
      setBlocked(outcome.data.blocked);
      selection.clear();
    }
  }

  async function bulkMove() {
    const outcome = await run(() => bulkMoveMediaAction(selection.selectedIds, moveTarget));
    if (outcome.ok) {
      setMoveOpen(false);
      selection.clear();
    }
  }

  const folderPanel = <MediaFolderTree tree={tree} activeFolderId={activeFolderId} />;

  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Folders: a static column on desktop, a collapsible strip above the grid on mobile. */}
      <details className="surface px-2 py-1.5 lg:hidden">
        <summary className="cursor-pointer px-1 py-1 text-xs font-medium">Folders</summary>
        <div className="pt-1">{folderPanel}</div>
      </details>
      <aside className="surface hidden self-start p-2 lg:block lg:sticky lg:top-16">{folderPanel}</aside>

      <div className="min-w-0 space-y-3">
        <MediaToolbar counts={counts} sort={sort} order={order} view={view} />
        <MediaUploadZone />

        {blocked.length > 0 ? (
          <div className="border-warning/30 bg-warning-muted/40 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium">
                {blocked.length} file{blocked.length === 1 ? " was" : "s were"} not deleted because {blocked.length === 1 ? "it is" : "they are"} still in use:
              </p>
              <ul className="text-muted-foreground list-inside list-disc">
                {blocked.map((entry) => (
                  <li key={entry.id}>
                    <button type="button" className="text-foreground hover:underline" onClick={() => navigate({ asset: entry.id })}>
                      {entry.filename}
                    </button>{" "}
                    - {entry.usages.map((usage) => `${usage.type} ×${usage.count}`).join(", ")}
                  </li>
                ))}
              </ul>
            </div>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => setBlocked([])}>
              <X />
            </Button>
          </div>
        ) : null}

        <div className="surface overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState
              icon={Images}
              title={hasFilters ? "No files match these filters" : activeFolderId ? "This folder is empty" : "No media yet"}
              description={
                hasFilters
                  ? "Try a different search, kind or visibility."
                  : canUpload
                    ? "Drop files above or use Upload. Images are optimised and thumbnailed automatically."
                    : "Nothing has been uploaded here yet."
              }
              action={
                hasFilters ? (
                  <Button variant="outline" size="sm" onClick={() => navigate({ q: null, kind: null, visibility: null, from: null, to: null })}>
                    Clear filters
                  </Button>
                ) : canUpload ? (
                  <Button size="sm" onClick={queue.openPicker}>
                    Upload files
                  </Button>
                ) : undefined
              }
            />
          ) : view === "list" ? (
            <MediaListTable rows={rows} selection={selection} onOpen={openAsset} />
          ) : (
            <MediaGrid rows={rows} selection={selection} onOpen={openAsset} />
          )}
          {meta.total > 0 ? <PaginationBar meta={meta} itemLabel="files" /> : null}
        </div>
      </div>

      <BulkActionBar
        count={selection.count}
        onClear={selection.clear}
        itemLabel="selected"
        actions={[
          ...(canUpload
            ? [
                {
                  label: "Move to folder",
                  icon: FolderInput,
                  onSelect: () => {
                    setMoveTarget(activeFolderId && activeFolderId !== "root" ? activeFolderId : null);
                    setMoveOpen(true);
                  },
                },
              ]
            : []),
          ...(canDelete ? [{ label: "Delete", icon: Trash2, destructive: true, onSelect: bulkDelete }] : []),
        ]}
      />

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Move {selection.count} file{selection.count === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription className="text-xs">Files keep their URLs; only their folder changes.</DialogDescription>
          </DialogHeader>
          <FolderPickerSelect folders={tree.folders} value={moveTarget} onChange={setMoveTarget} />
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setMoveOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={bulkMove}>
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MediaDetailSheet detail={detail} folders={tree.folders} onClose={closeAsset} />
      {confirmDialog}
    </div>
  );
}
