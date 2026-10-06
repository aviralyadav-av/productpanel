"use client";

import * as React from "react";
import { FolderPlus, Upload } from "lucide-react";

import { PermissionGate } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";

import { FolderDialog, type FolderDialogState } from "@/features/media/components/folder-dialogs";
import { useUploadQueue } from "@/features/media/components/upload-queue";
import type { MediaFolderDto } from "@/features/media/dto";

/**
 * Header buttons. "Upload" opens the same hidden file input the drop zone
 * uses, so both paths share one queue; "New folder" creates inside the folder
 * currently being viewed.
 */
export function MediaHeaderActions({ folders, currentFolderId }: { folders: MediaFolderDto[]; currentFolderId: string | null }) {
  const queue = useUploadQueue();
  const [dialog, setDialog] = React.useState<FolderDialogState>(null);

  return (
    <PermissionGate require="media.upload">
      <Button type="button" variant="outline" size="sm" onClick={() => setDialog({ mode: "create", parentId: currentFolderId })}>
        <FolderPlus />
        New folder
      </Button>
      <Button type="button" size="sm" onClick={queue.openPicker}>
        <Upload />
        Upload
      </Button>
      <FolderDialog state={dialog} folders={folders} onClose={() => setDialog(null)} />
    </PermissionGate>
  );
}
