"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import type { MediaAssetDto } from "@/features/media/dto";
import {
  ACCEPT_ATTRIBUTE,
  UploadError,
  nextUploadKey,
  precheckFile,
  uploadFile,
  type UploadItem,
} from "@/features/media/upload-client";

/**
 * One upload queue for a screen. On /admin/media the header's "Upload"
 * button, the drop zone and the empty state all feed the same list, and the
 * list is rendered in exactly one place (the drop zone), so the operator
 * never sees two progress bars for one file. The MediaPicker mounts its own
 * provider for its Upload tab.
 *
 * Files upload with bounded concurrency (3) - enough to keep the connection
 * busy, few enough that a 20-file drop does not open 20 sockets. Each
 * completion schedules one `router.refresh()` (debounced) unless the host
 * opts out, so a Server Component grid picks up new rows without a reload.
 */

export type UploadAccept = "image" | "video" | "document" | "all";

type QueueContextValue = {
  items: UploadItem[];
  accept: UploadAccept;
  visibility: "PUBLIC" | "PRIVATE";
  visibilityLocked: boolean;
  setVisibility(next: "PUBLIC" | "PRIVATE"): void;
  folderId: string | null;
  add(files: Iterable<File>): void;
  retry(key: string): void;
  remove(key: string): void;
  clearFinished(): void;
  openPicker(): void;
  isUploading: boolean;
};

const QueueContext = React.createContext<QueueContextValue | null>(null);

const CONCURRENCY = 3;

export function UploadQueueProvider({
  folderId,
  accept = "all",
  initialVisibility = "PUBLIC",
  lockVisibility = false,
  refreshOnComplete = true,
  onUploaded,
  children,
}: {
  /** Destination for new uploads; null = library root. */
  folderId: string | null;
  /** Client-side kind filter (the server re-validates by magic bytes). */
  accept?: UploadAccept;
  initialVisibility?: "PUBLIC" | "PRIVATE";
  /** Hide the Public/Private switch (pickers for public content lock PUBLIC). */
  lockVisibility?: boolean;
  /** Call router.refresh() after uploads land (off inside dialogs). */
  refreshOnComplete?: boolean;
  onUploaded?(asset: MediaAssetDto): void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [items, setItems] = React.useState<UploadItem[]>([]);
  const [visibility, setVisibility] = React.useState<"PUBLIC" | "PRIVATE">(initialVisibility);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const activeRef = React.useRef(0);
  const refreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest callback without re-running the pump effect when the host re-renders.
  const onUploadedRef = React.useRef(onUploaded);
  React.useEffect(() => {
    onUploadedRef.current = onUploaded;
  }, [onUploaded]);

  const patch = React.useCallback((key: string, changes: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...changes } : item)));
  }, []);

  const scheduleRefresh = React.useCallback(() => {
    if (!refreshOnComplete) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 400);
  }, [router, refreshOnComplete]);

  // The pump: start queued items while there is capacity. Runs whenever the
  // list changes, and each finished upload changes the list.
  React.useEffect(() => {
    const queued = items.filter((item) => item.status === "queued");
    if (queued.length === 0 || activeRef.current >= CONCURRENCY) return;

    const start = queued.slice(0, CONCURRENCY - activeRef.current);
    for (const item of start) {
      activeRef.current += 1;
      patch(item.key, { status: "uploading", progress: 0, error: null });

      uploadFile(item.file, {
        folderId,
        visibility,
        onProgress: (percent) => patch(item.key, { progress: percent, status: percent >= 100 ? "processing" : "uploading" }),
      })
        .then((asset) => {
          patch(item.key, { status: "done", progress: 100, asset });
          onUploadedRef.current?.(asset);
          scheduleRefresh();
        })
        .catch((error: unknown) => {
          const message = error instanceof UploadError ? error.message : "Upload failed.";
          patch(item.key, { status: "error", error: message });
          if (error instanceof UploadError && (error.status === 401 || error.status === 403)) {
            toast.error(error.status === 401 ? "Your session expired. Sign in again." : "You do not have permission to upload media.");
          }
        })
        .finally(() => {
          activeRef.current -= 1;
          // Nudge the effect so the next queued item starts.
          setItems((current) => [...current]);
        });
    }
    // `visibility`/`folderId` are read when each file STARTS on purpose: the
    // operator's current choice applies to what they drop next, and changing
    // the switch must not restart in-flight uploads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, patch, scheduleRefresh]);

  const add = React.useCallback(
    (files: Iterable<File>) => {
      const next: UploadItem[] = [];
      for (const file of files) {
        const problem = precheckFile(file, accept);
        next.push({
          key: nextUploadKey(),
          file,
          status: problem ? "error" : "queued",
          progress: 0,
          error: problem,
          asset: null,
        });
      }
      if (next.length === 0) return;
      setItems((current) => [...current, ...next]);
    },
    [accept],
  );

  const retry = React.useCallback(
    (key: string) => {
      setItems((current) =>
        current.map((item) => {
          if (item.key !== key || item.status !== "error") return item;
          const problem = precheckFile(item.file, accept);
          return problem ? item : { ...item, status: "queued", progress: 0, error: null };
        }),
      );
    },
    [accept],
  );

  const remove = React.useCallback((key: string) => {
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  const clearFinished = React.useCallback(() => {
    setItems((current) => current.filter((item) => item.status !== "done" && item.status !== "error"));
  }, []);

  const openPicker = React.useCallback(() => inputRef.current?.click(), []);

  const isUploading = items.some((item) => item.status === "uploading" || item.status === "processing" || item.status === "queued");

  // Warn before leaving mid-upload: closing the tab cancels the transfer.
  React.useEffect(() => {
    if (!isUploading) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isUploading]);

  const value = React.useMemo<QueueContextValue>(
    () => ({
      items,
      accept,
      visibility,
      visibilityLocked: lockVisibility,
      setVisibility,
      folderId,
      add,
      retry,
      remove,
      clearFinished,
      openPicker,
      isUploading,
    }),
    [items, accept, visibility, lockVisibility, folderId, add, retry, remove, clearFinished, openPicker, isUploading],
  );

  return (
    <QueueContext.Provider value={value}>
      {children}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE[accept]}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          if (event.target.files) add(event.target.files);
          event.target.value = "";
        }}
      />
    </QueueContext.Provider>
  );
}

export function useUploadQueue(): QueueContextValue {
  const context = React.useContext(QueueContext);
  if (!context) throw new Error("useUploadQueue must be used inside <UploadQueueProvider>.");
  return context;
}
