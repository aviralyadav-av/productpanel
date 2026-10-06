"use client";

import * as React from "react";
import { Check, ChevronLeft, ChevronRight, Folder, FolderOpen, ImageIcon, Inbox, Layers, Search, Upload, X } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { usePermission } from "@/components/shared/permission-gate";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

import { MediaGrid } from "@/features/media/components/media-grid";
import { MediaUploadZone } from "@/features/media/components/media-upload-zone";
import { UploadQueueProvider } from "@/features/media/components/upload-queue";
import { toPickedAsset, type MediaAssetDto, type MediaFolderDto } from "@/features/media/dto";
import { formatBytes, formatDimensions } from "@/features/media/format";

/**
 * The shape every feature receives when an operator picks something from the
 * media library. It is deliberately flat and serialisable so it can travel
 * through form state and Server Action inputs without a Prisma type leaking
 * into client bundles.
 */
export type PickedAsset = {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  alt: string | null;
  filename: string;
  kind: "image" | "video" | "document";
  width: number | null;
  height: number | null;
  mimeType: string | null;
};

export type MediaPickerProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Allow choosing more than one asset; defaults to a single pick. */
  multiple?: boolean;
  /** Restrict the library to one asset kind. */
  accept?: "image" | "video" | "document" | "all";
  /** Start browsing inside this folder; null = library root. */
  folderId?: string | null;
  onSelect(assets: PickedAsset[]): void;
  title?: string;
};

/**
 * Media library picker (blueprint §14.E6, G6).
 *
 * A Dialog with a folder rail, search, the tile grid and an Upload tab.
 * Everything it shows comes from the REST routes (`GET /api/admin/media`,
 * `GET /api/admin/media/folders`) so the dialog works on any admin page
 * without that page loading media data itself. Uploads made from the Upload
 * tab are selected automatically - the common case is "I have the photo on my
 * disk, put it in this product" - and PRIVATE is never offered here because a
 * picked asset is by definition about to be shown somewhere.
 */
export function MediaPicker(props: MediaPickerProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex h-[min(44rem,92vh)] flex-col gap-0 p-0 sm:max-w-4xl" showCloseButton>
        {props.open ? <PickerBody {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

const PAGE_SIZE = 40;

type ListResponse = {
  data: MediaAssetDto[];
  meta: { page: number; pageSize: number; total: number; totalPages: number; from: number; to: number };
  counts: Record<"all" | "image" | "video" | "document", number>;
};

type FoldersResponse = { data: { folders: MediaFolderDto[]; rootCount: number; totalCount: number } };

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

function PickerBody({ onOpenChange, multiple = false, accept = "all", folderId: initialFolderId, onSelect, title = "Media library" }: MediaPickerProps) {
  const canUpload = usePermission("media.upload");
  const [tab, setTab] = React.useState<"library" | "upload">("library");
  // undefined = everywhere, "root" = unfiled, else a folder id.
  const [folderId, setFolderId] = React.useState<string | undefined>(initialFolderId === null ? "root" : initialFolderId ?? undefined);
  const [query, setQuery] = React.useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  const [kind, setKind] = React.useState<"all" | "image" | "video" | "document">(accept);
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<Map<string, MediaAssetDto>>(() => new Map());

  const [folders, setFolders] = React.useState<FoldersResponse["data"] | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  // The request the current filters describe. Results are stored WITH the
  // key they answer, so "loading" is derived (stored key !== wanted key)
  // instead of being set in the effect - no cascading render, and a stale
  // response for an older key is ignored naturally.
  const requestParams = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort: "createdAt", order: "desc" });
  if (kind !== "all") requestParams.set("kind", kind);
  if (folderId) requestParams.set("folder", folderId);
  if (debouncedQuery) requestParams.set("q", debouncedQuery);
  // Never offer PRIVATE files: a picked asset is about to be displayed.
  requestParams.set("visibility", "PUBLIC");
  const requestKey = `${requestParams.toString()}#${reloadKey}`;

  const [result, setResult] = React.useState<{ key: string; list: ListResponse | null; error: string | null } | null>(null);
  const list = result?.list ?? null;
  const error = result?.key === requestKey ? result.error : null;
  const loading = result?.key !== requestKey;

  // Folders once per opening.
  React.useEffect(() => {
    const controller = new AbortController();
    readJson<FoldersResponse>("/api/admin/media/folders", controller.signal)
      .then((body) => setFolders(body.data))
      .catch(() => setFolders({ folders: [], rootCount: 0, totalCount: 0 }));
    return () => controller.abort();
  }, []);

  // Assets whenever the request changes.
  React.useEffect(() => {
    const controller = new AbortController();
    const [query] = requestKey.split("#");
    readJson<ListResponse>(`/api/admin/media?${query}`, controller.signal)
      .then((body) => setResult({ key: requestKey, list: body, error: null }))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setResult((current) => ({
          key: requestKey,
          // Keep the last good page visible behind the error message.
          list: current?.list ?? null,
          error: cause instanceof Error ? cause.message : "Could not load the media library.",
        }));
      });
    return () => controller.abort();
  }, [requestKey]);

  // Filter changes go back to page 1.
  const changeKind = (next: typeof kind) => {
    setKind(next);
    setPage(1);
  };
  const changeFolder = (next: string | undefined) => {
    setFolderId(next);
    setPage(1);
  };
  const changeQuery = (next: string) => {
    setQuery(next);
    setPage(1);
  };

  const toggle = React.useCallback(
    (asset: MediaAssetDto, force?: boolean) => {
      setSelected((current) => {
        const next = new Map(multiple ? current : []);
        const shouldSelect = force ?? !current.has(asset.id);
        if (shouldSelect) next.set(asset.id, asset);
        else next.delete(asset.id);
        return next;
      });
    },
    [multiple],
  );

  const selection = React.useMemo(
    () => ({
      isSelected: (id: string) => selected.has(id),
      rowProps: (id: string) => ({
        checked: selected.has(id),
        onCheckedChange: (checked: boolean | "indeterminate") => {
          const asset = list?.data.find((row) => row.id === id);
          if (asset) toggle(asset, checked === true);
        },
      }),
    }),
    [selected, list, toggle],
  );

  function confirm() {
    const assets = [...selected.values()].map(toPickedAsset);
    if (assets.length === 0) return;
    onSelect(assets);
    onOpenChange(false);
  }

  const uploadFolder = folderId && folderId !== "root" ? folderId : null;
  const kindTabs: Array<{ value: "all" | "image" | "video" | "document"; label: string }> =
    accept === "all"
      ? [
          { value: "all", label: "All" },
          { value: "image", label: "Images" },
          { value: "video", label: "Videos" },
          { value: "document", label: "Documents" },
        ]
      : [];

  return (
    <UploadQueueProvider
      folderId={uploadFolder}
      accept={accept}
      lockVisibility
      refreshOnComplete={false}
      onUploaded={(asset) => {
        toggle(asset, true);
        setReloadKey((key) => key + 1);
        setTab("library");
      }}
    >
      <DialogHeader className="border-b px-5 pt-5 pb-3">
        <DialogTitle className="text-sm">{title}</DialogTitle>
        <DialogDescription className="text-xs">
          {multiple ? "Choose one or more files" : "Choose a file"}
          {accept !== "all" ? ` (${accept}s only)` : ""}, or upload new ones.
        </DialogDescription>
      </DialogHeader>

      <Tabs value={tab} onValueChange={(value) => setTab(value === "upload" ? "upload" : "library")} className="min-h-0 flex-1 gap-0">
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2">
          <TabsList>
            <TabsTrigger value="library" className="text-xs">
              <Layers className="size-3.5" />
              Library
            </TabsTrigger>
            {canUpload ? (
              <TabsTrigger value="upload" className="text-xs">
                <Upload className="size-3.5" />
                Upload
              </TabsTrigger>
            ) : null}
          </TabsList>

          {tab === "library" ? (
            <>
              <div className="relative ml-auto w-full sm:w-56">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => changeQuery(event.target.value)}
                  placeholder="Search files…"
                  aria-label="Search media"
                  className="h-8 pl-8"
                />
              </div>
              {kindTabs.length > 0 ? (
                <div role="tablist" className="bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5">
                  {kindTabs.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="tab"
                      aria-selected={kind === option.value}
                      onClick={() => changeKind(option.value)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        kind === option.value ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option.label}
                      {list ? (
                        <span data-numeric className="text-muted-foreground/70 ml-1 text-[10px]">
                          {list.counts[option.value]}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <TabsContent value="library" className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <aside className="hidden min-h-0 overflow-y-auto border-r p-2 sm:block">
            <FolderRail folders={folders} activeFolderId={folderId} onChange={changeFolder} />
          </aside>

          <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {error ? (
                <ErrorState compact title="Could not load the library" description={error} retry={() => setReloadKey((key) => key + 1)} />
              ) : !list ? (
                <GridSkeleton />
              ) : list && list.data.length === 0 ? (
                <EmptyState
                  compact
                  icon={ImageIcon}
                  title={debouncedQuery ? "No files match" : "Nothing here yet"}
                  description={
                    debouncedQuery
                      ? "Try another search or folder."
                      : canUpload
                        ? "Upload a file from the Upload tab; it is selected for you when it lands."
                        : "No files have been uploaded to this folder."
                  }
                  action={
                    canUpload ? (
                      <Button size="sm" variant="outline" onClick={() => setTab("upload")}>
                        <Upload />
                        Upload
                      </Button>
                    ) : undefined
                  }
                />
              ) : list ? (
                <div className={cn(loading && "opacity-60 transition-opacity")}>
                  <MediaGrid rows={list.data} selection={selection} onOpen={(asset) => toggle(asset)} />
                </div>
              ) : null}
            </div>

            {list && list.meta.totalPages > 1 ? (
              <div className="text-muted-foreground flex items-center justify-between gap-3 border-t px-3 py-1.5 text-xs">
                <span data-numeric>
                  {list.meta.from}–{list.meta.to} of {list.meta.total}
                </span>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="outline" size="icon-xs" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft />
                  </Button>
                  <span data-numeric className="px-1">
                    {list.meta.page} / {list.meta.totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-xs"
                    aria-label="Next page"
                    disabled={page >= list.meta.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="upload" className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="space-y-3">
            <p className="text-muted-foreground text-xs">
              Uploading into <span className="text-foreground font-medium">{folderLabel(folders?.folders ?? [], uploadFolder)}</span>. Uploaded files
              are added to your selection automatically.
            </p>
            <MediaUploadZone />
          </div>
        </TabsContent>
      </Tabs>

      <DialogFooter className="flex-row items-center gap-2 border-t px-5 py-3 sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
          {selected.size === 0 ? (
            <span className="text-muted-foreground">Nothing selected</span>
          ) : (
            <>
              <span data-numeric className="shrink-0 font-medium">
                {selected.size} selected
              </span>
              <div className="flex min-w-0 flex-wrap gap-1">
                {[...selected.values()].slice(0, multiple ? 4 : 1).map((asset) => (
                  <span key={asset.id} className="bg-muted inline-flex max-w-48 items-center gap-1 rounded-full px-2 py-0.5">
                    <span className="truncate">{asset.filename}</span>
                    <span className="text-muted-foreground hidden truncate sm:inline">
                      {asset.width && asset.height ? formatDimensions(asset.width, asset.height) : formatBytes(asset.sizeBytes)}
                    </span>
                    <button type="button" aria-label={`Deselect ${asset.filename}`} onClick={() => toggle(asset, false)} className="hover:text-foreground text-muted-foreground">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                {selected.size > 4 && multiple ? <span className="text-muted-foreground">+{selected.size - 4} more</span> : null}
              </div>
              <Button type="button" variant="ghost" size="xs" onClick={() => setSelected(new Map())}>
                Clear
              </Button>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={selected.size === 0} onClick={confirm}>
            <Check />
            {multiple ? `Insert ${selected.size || ""}`.trim() : "Insert"}
          </Button>
        </div>
      </DialogFooter>
    </UploadQueueProvider>
  );
}

function folderLabel(folders: MediaFolderDto[], id: string | null): string {
  if (!id) return "the library root";
  return folders.find((folder) => folder.id === id)?.path ?? "the selected folder";
}

function FolderRail({
  folders,
  activeFolderId,
  onChange,
}: {
  folders: FoldersResponse["data"] | null;
  activeFolderId: string | undefined;
  onChange(next: string | undefined): void;
}) {
  if (!folders) {
    return (
      <div className="space-y-1.5 p-1">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-6 rounded-md" />
        ))}
      </div>
    );
  }

  const item = (key: string, label: string, count: number, active: boolean, depth: number, icon: React.ReactNode, onClick: () => void) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs",
        active ? "bg-brand-muted/60 text-foreground font-medium" : "text-muted-foreground hover:bg-muted/60",
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      {icon}
      <span className="truncate">{label}</span>
      <span data-numeric className="text-muted-foreground/70 ml-auto text-[10px]">
        {count}
      </span>
    </button>
  );

  return (
    <div className="space-y-0.5">
      {item("all", "All files", folders.totalCount, activeFolderId === undefined, 0, <Layers className="size-3.5 shrink-0" />, () => onChange(undefined))}
      {item("root", "Unfiled", folders.rootCount, activeFolderId === "root", 0, <Inbox className="size-3.5 shrink-0" />, () => onChange("root"))}
      {folders.folders.length > 0 ? <p className="text-muted-foreground/80 px-2 pt-2 pb-1 text-[10px] font-medium tracking-wide uppercase">Folders</p> : null}
      {folders.folders.map((folder) =>
        item(
          folder.id,
          folder.name,
          folder.assetCount,
          activeFolderId === folder.id,
          folder.depth,
          activeFolderId === folder.id ? <FolderOpen className="size-3.5 shrink-0" /> : <Folder className="size-3.5 shrink-0" />,
          () => onChange(folder.id),
        ),
      )}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 15 }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-lg border">
          <Skeleton className="aspect-square w-full rounded-none" />
          <div className="space-y-1.5 border-t px-2 py-2">
            <Skeleton className="h-2.5 w-4/5" />
            <Skeleton className="h-2 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

/**
 * Convenience trigger: a button that owns the dialog's open state so simple
 * callers ("Add image") do not have to wire `useState` themselves.
 */
export function MediaPickerButton({
  onSelect,
  multiple,
  accept,
  folderId,
  title,
  children,
  variant = "outline",
  size = "sm",
  className,
  disabled,
}: Pick<MediaPickerProps, "onSelect" | "multiple" | "accept" | "folderId" | "title"> & {
  children?: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <ImageIcon className="size-4" />
        {children ?? "Choose media"}
      </Button>
      <MediaPicker
        open={open}
        onOpenChange={setOpen}
        multiple={multiple}
        accept={accept}
        folderId={folderId}
        title={title}
        onSelect={(assets) => {
          onSelect(assets);
          setOpen(false);
        }}
      />
    </>
  );
}

export type MediaPickerOpenOptions = Pick<MediaPickerProps, "multiple" | "accept" | "folderId" | "title">;

/**
 * Imperative picker for event handlers and editor callbacks. Render `element`
 * once anywhere in the component; `open()` resolves with the chosen assets or
 * null when the dialog is dismissed. `pickImage` adapts it to
 * `RichTextEditor`'s `onPickImage(): Promise<{ url, alt? } | null>`.
 *
 * @example
 *   const picker = useMediaPicker();
 *   <RichTextEditor value={html} onChange={setHtml} onPickImage={picker.pickImage} />
 *   {picker.element}
 */
export function useMediaPicker(): {
  open(options?: MediaPickerOpenOptions): Promise<PickedAsset[] | null>;
  pickImage(): Promise<{ url: string; alt?: string } | null>;
  element: React.ReactNode;
} {
  const [state, setState] = React.useState<{ options: MediaPickerOpenOptions; resolve: (result: PickedAsset[] | null) => void } | null>(null);

  const open = React.useCallback(
    (options: MediaPickerOpenOptions = {}) =>
      new Promise<PickedAsset[] | null>((resolve) => {
        setState((current) => {
          // A second open() while one is pending cancels the first.
          current?.resolve(null);
          return { options, resolve };
        });
      }),
    [],
  );

  const pickImage = React.useCallback(async () => {
    const picked = await open({ accept: "image", multiple: false, title: "Insert image" });
    const first = picked?.[0];
    return first ? { url: first.url, alt: first.alt ?? undefined } : null;
  }, [open]);

  const element = state ? (
    <MediaPicker
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          state.resolve(null);
          setState(null);
        }
      }}
      {...state.options}
      onSelect={(assets) => {
        state.resolve(assets);
        setState(null);
      }}
    />
  ) : null;

  return { open, pickImage, element };
}
