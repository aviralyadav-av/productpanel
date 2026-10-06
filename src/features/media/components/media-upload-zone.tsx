"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Loader2, RotateCcw, Upload, X } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePermission } from "@/components/shared/permission-gate";

import { useUploadQueue, type UploadAccept } from "@/features/media/components/upload-queue";
import { formatBytes } from "@/features/media/format";
import type { UploadItem } from "@/features/media/upload-client";

const LIMITS: Record<UploadAccept, string> = {
  all: "Images to 10 MB, video to 100 MB, PDF to 20 MB.",
  image: "JPEG, PNG, WebP, GIF, AVIF or SVG up to 10 MB.",
  video: "MP4 or WebM up to 100 MB.",
  document: "PDF up to 20 MB.",
};

/**
 * Drag-and-drop target plus the live queue. Compact when idle (one line) so it
 * does not push the grid down; the queue expands beneath it while files are
 * in flight and can be dismissed once they land.
 */
export function MediaUploadZone({ className }: { className?: string }) {
  const canUpload = usePermission("media.upload");
  const queue = useUploadQueue();
  const [dragging, setDragging] = React.useState(false);
  const dragDepth = React.useRef(0);

  if (!canUpload) return null;

  function onDragEnter(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }
  function onDragLeave(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }
  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (event.dataTransfer.files?.length) queue.add(event.dataTransfer.files);
  }

  const finished = queue.items.filter((item) => item.status === "done" || item.status === "error").length;

  return (
    <div className={cn("space-y-2", className)}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload files: drop here or press Enter to choose"
        onClick={queue.openPicker}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            queue.openPicker();
          }
        }}
        onDragEnter={onDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3 text-xs transition-colors outline-none",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3",
          dragging
            ? "border-brand bg-brand-muted/40 text-foreground"
            : "border-border text-muted-foreground hover:border-foreground/30 hover:bg-muted/40",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Upload className="size-4 shrink-0" />
          <p className="truncate">
            <span className="text-foreground font-medium">Drop files here</span> or click to choose. {LIMITS[queue.accept]}
          </p>
        </div>

        {queue.visibilityLocked ? null : (
          <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <span className="text-muted-foreground hidden sm:inline">Upload as</span>
            <Select value={queue.visibility} onValueChange={(value) => queue.setVisibility(value === "PRIVATE" ? "PRIVATE" : "PUBLIC")}>
              <SelectTrigger size="sm" className="w-28" aria-label="Upload visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PUBLIC">Public</SelectItem>
                <SelectItem value="PRIVATE">Private</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {queue.items.length > 0 ? (
        <div className="surface divide-y">
          {queue.items.map((item) => (
            <UploadRow key={item.key} item={item} onRetry={() => queue.retry(item.key)} onRemove={() => queue.remove(item.key)} />
          ))}
          {finished > 0 ? (
            <div className="flex justify-end px-3 py-1.5">
              <Button type="button" variant="ghost" size="xs" onClick={queue.clearFinished}>
                Clear finished
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function UploadRow({ item, onRetry, onRemove }: { item: UploadItem; onRetry(): void; onRemove(): void }) {
  const busy = item.status === "uploading" || item.status === "processing" || item.status === "queued";

  return (
    <div className="flex items-center gap-3 px-3 py-2 text-xs">
      <div className="shrink-0">
        {item.status === "done" ? (
          <CheckCircle2 className="text-success size-4" />
        ) : item.status === "error" ? (
          <AlertCircle className="text-destructive size-4" />
        ) : (
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate font-medium">{item.file.name}</p>
          <p data-numeric className="text-muted-foreground shrink-0">
            {formatBytes(item.file.size)}
          </p>
        </div>
        {item.status === "error" ? (
          <p className="text-destructive">{item.error}</p>
        ) : item.status === "done" ? (
          <p className="text-muted-foreground">
            Uploaded{item.asset ? ` as ${item.asset.filename}` : ""}.
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <Progress value={item.progress} className="h-1 flex-1" aria-label={`${item.file.name} upload progress`} />
            <span data-numeric className="text-muted-foreground w-16 shrink-0 text-right">
              {item.status === "queued" ? "Queued" : item.status === "processing" ? "Processing" : `${item.progress}%`}
            </span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {item.status === "error" ? (
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Retry upload" onClick={onRetry}>
            <RotateCcw />
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove from list" disabled={busy} onClick={onRemove}>
          <X />
        </Button>
      </div>
    </div>
  );
}
