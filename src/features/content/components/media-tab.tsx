"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ImageOff, Images, Link2, Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "cn";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { StatusPill } from "@/components/shared/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatIstDateTime } from "@/lib/dates";
import { formatBytes, isVideoUrl, resolveAssetUrl } from "@/lib/media";
import { formatNumber } from "@/lib/money";
import type { PageMeta } from "@/lib/list-params";
import { addMediaByUrl, deleteMedia, updateMediaAlt } from "../actions";
import type { Facet, MediaRow } from "../queries";
import { useActionToast } from "./section-editor";

const SOURCE_TONE = {
  legacy: "neutral",
  external: "info",
  upload: "brand",
} as const;

/**
 * The media library.
 *
 * Every asset here is a REFERENCE, not a file this admin holds: the legacy ones
 * live in the storefront's own /public, the rest are Unsplash and Pexels URLs.
 * That is why there is no dropzone - see the line at the top of the toolbar.
 */
export function MediaTab({
  rows,
  meta,
  kinds,
  folders,
  total,
}: {
  rows: MediaRow[];
  meta: PageMeta;
  kinds: Facet[];
  folders: Facet[];
  total: number;
}) {
  const [selected, setSelected] = React.useState<MediaRow | null>(null);
  const [adding, setAdding] = React.useState(false);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <SearchInput placeholder="Search filenames…" className="w-56" />
        {kinds.length > 1 ? (
          <FilterTabs paramKey="kind" options={kinds} allLabel="All types" />
        ) : null}
        <FolderFilter folders={folders} />
        <div className="ml-auto flex items-center gap-2">
          <span data-numeric className="text-muted-foreground text-[11px]">
            {formatNumber(total)} assets
          </span>
          <Button type="button" size="xs" onClick={() => setAdding(true)}>
            <Plus />
            Add by URL
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground border-b px-4 py-1.5 text-[11px] leading-relaxed">
        No storage provider is configured, so there is nothing to upload into —
        assets are registered by URL and served from wherever they already live.
      </p>

      {rows.length === 0 ? (
        <EmptyState
          icon={Images}
          title="No assets match"
          description="Clear the search and filters, or register a new asset by pasting its URL."
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => setSelected(row)}
                className="surface hover:bg-accent/40 focus-visible:ring-ring/50 block w-full overflow-hidden text-left transition-colors focus-visible:ring-3 focus-visible:outline-none"
              >
                <Preview url={row.url} alt={row.alt || row.filename} />
                <div className="space-y-1 border-t p-2">
                  <p className="truncate text-[11px] font-medium">
                    {row.filename}
                  </p>
                  <p className="text-muted-foreground truncate text-[11px]">
                    {row.folder}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <StatusPill
                      label={row.source}
                      tone={
                        SOURCE_TONE[row.source as keyof typeof SOURCE_TONE] ??
                        "neutral"
                      }
                      dot={false}
                    />
                    <span
                      data-numeric
                      className={cn(
                        "text-[11px]",
                        row.usageCount > 0
                          ? "text-muted-foreground"
                          : "text-warning",
                      )}
                    >
                      {row.usageCount > 0
                        ? `used ${row.usageCount}×`
                        : "unused"}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <PaginationBar meta={meta} itemLabel="assets" />

      {selected ? (
        <MediaSheet
          key={selected.id}
          asset={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}

      <AddMediaDialog
        open={adding}
        onOpenChange={setAdding}
        folders={folders}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Preview({ url, alt }: { url: string; alt: string }) {
  const resolved = resolveAssetUrl(url);

  if (!resolved) {
    return (
      <div className="bg-muted text-muted-foreground/60 flex aspect-4/3 items-center justify-center">
        <ImageOff className="size-5" />
      </div>
    );
  }

  if (isVideoUrl(url)) {
    return (
      <video
        src={resolved}
        muted
        playsInline
        preload="metadata"
        aria-label={alt}
        className="bg-muted aspect-4/3 w-full object-cover"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolved}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="bg-muted aspect-4/3 w-full object-cover"
    />
  );
}

// ---------------------------------------------------------------------------

function FolderFilter({ folders }: { folders: Facet[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = searchParams.get("folder") ?? "__all";

  function change(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "__all") params.delete("folder");
    else params.set("folder", next);
    params.delete("page");
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}` as never, {
      scroll: false,
    });
  }

  if (folders.length <= 1) return null;

  return (
    <Select value={value} onValueChange={change}>
      <SelectTrigger size="sm" className="w-48" aria-label="Filter by folder">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">All folders</SelectItem>
        {folders.map((folder) => (
          <SelectItem key={folder.value} value={folder.value}>
            {folder.label} ({folder.count})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------

function MediaSheet({
  asset,
  onClose,
}: {
  asset: MediaRow;
  onClose: () => void;
}) {
  const [alt, setAlt] = React.useState(asset.alt);
  const { pending, run } = useActionToast();

  const usage: string[] = [];
  if (asset.productImageCount) {
    usage.push(
      `${asset.productImageCount} product image${asset.productImageCount === 1 ? "" : "s"}`,
    );
  }
  if (asset.contentBlockCount) {
    usage.push(
      `${asset.contentBlockCount} content item${asset.contentBlockCount === 1 ? "" : "s"}`,
    );
  }
  if (asset.categoryCount) {
    usage.push(
      `${asset.categoryCount} categor${asset.categoryCount === 1 ? "y" : "ies"}`,
    );
  }

  return (
    <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent className="w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="truncate text-sm">{asset.filename}</SheetTitle>
          <SheetDescription className="text-xs">
            {asset.kind === "video" ? "Video" : "Image"} · {asset.folder} ·{" "}
            {asset.source}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-1">
          <div className="surface overflow-hidden">
            <Preview url={asset.url} alt={asset.alt || asset.filename} />
          </div>

          <dl className="divide-y text-[11px]">
            <Detail label="URL">
              <span className="font-mono break-all">{asset.url}</span>
            </Detail>
            <Detail label="Dimensions">
              {asset.width && asset.height
                ? `${asset.width} × ${asset.height}`
                : "Not recorded — the bytes are never fetched by this admin."}
            </Detail>
            <Detail label="Size">{formatBytes(asset.sizeBytes)}</Detail>
            <Detail label="Added">{formatIstDateTime(asset.createdAt)}</Detail>
            <Detail label="Used by">
              {usage.length ? usage.join(", ") : "Nothing references this yet."}
            </Detail>
          </dl>

          <div className="space-y-1.5">
            <Label htmlFor="media-alt" className="text-xs">
              Alt text
            </Label>
            <Input
              id="media-alt"
              value={alt}
              disabled={pending}
              placeholder="Describe the image for screen readers"
              onChange={(event) => setAlt(event.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>

        <SheetFooter className="border-t">
          <div className="flex items-center justify-between gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={pending || asset.usageCount > 0}
                >
                  <Trash2 />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {asset.filename}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The record is removed from the library. The file itself
                    lives outside this admin and is not touched.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      run(() => deleteMedia({ id: asset.id }), {
                        onSuccess: onClose,
                      })
                    }
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              type="button"
              size="sm"
              disabled={pending || alt === asset.alt}
              onClick={() =>
                run(() => updateMediaAlt({ id: asset.id, alt }), {
                  onSuccess: onClose,
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save alt text
            </Button>
          </div>

          {asset.usageCount > 0 ? (
            <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
              Deletion is blocked: {usage.join(" and ")} still point here.
              Replace it there first.
            </p>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 py-1.5">
      <dt className="text-muted-foreground w-24 shrink-0">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AddMediaDialog({
  open,
  onOpenChange,
  folders,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: Facet[];
}) {
  const [url, setUrl] = React.useState("");
  const [folder, setFolder] = React.useState("uncategorised");
  const [alt, setAlt] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useActionToast();

  React.useEffect(() => {
    if (!open) return;
    setUrl("");
    setAlt("");
    setFolder("uncategorised");
    setErrors({});
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    run(async () => {
      const result = await addMediaByUrl({
        url,
        alt,
        folder,
        // Left undefined so the server decides from the file extension.
        kind: undefined,
      });
      if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
      if (result.ok) onOpenChange(false);
      return result;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-sm">Add an asset by URL</DialogTitle>
            <DialogDescription className="text-xs">
              Registers a reference. Paste a full https:// URL or a storefront
              path such as /products/bags/example.jpg.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-3">
            <div className="space-y-1.5">
              <Label htmlFor="media-url" className="text-xs">
                URL or path
              </Label>
              <div className="flex items-center gap-2">
                <Link2 className="text-muted-foreground size-3.5 shrink-0" />
                <Input
                  id="media-url"
                  value={url}
                  disabled={pending}
                  autoFocus
                  aria-invalid={errors.url ? true : undefined}
                  onChange={(event) => setUrl(event.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              {errors.url ? (
                <p className="text-destructive text-[11px]">{errors.url}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="media-folder" className="text-xs">
                Folder
              </Label>
              <Input
                id="media-folder"
                list="media-folders"
                value={folder}
                disabled={pending}
                aria-invalid={errors.folder ? true : undefined}
                onChange={(event) => setFolder(event.target.value)}
                className="h-8 text-xs"
              />
              <datalist id="media-folders">
                {folders.map((entry) => (
                  <option key={entry.value} value={entry.value} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="media-new-alt" className="text-xs">
                Alt text
              </Label>
              <Input
                id="media-new-alt"
                value={alt}
                disabled={pending}
                onChange={(event) => setAlt(event.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !url.trim()}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Add asset
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
