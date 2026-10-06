"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { ExternalLink, Link2, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { CopyButton } from "@/components/shared/copy-button";
import { FieldError, FieldHint } from "@/components/shared/form-layout";
import { KeyValueList } from "@/components/shared/key-value-list";
import { PermissionGate } from "@/components/shared/permission-gate";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatIstDateTime } from "@/lib/dates";
import { MEDIA_KIND_META, MEDIA_VISIBILITY_META } from "@/lib/enums";

import { deleteMediaAction, updateMediaAction } from "@/features/media/actions";
import { FolderPickerSelect } from "@/features/media/components/folder-dialogs";
import { MediaPreview } from "@/features/media/components/media-preview";
import type { MediaFolderDto } from "@/features/media/dto";
import { formatBytes, formatDimensions } from "@/features/media/format";
import type { MediaDetail } from "@/features/media/queries";
import { ACCEPT_ATTRIBUTE, UploadError, replaceFile } from "@/features/media/upload-client";

/**
 * Asset detail as a side sheet driven by `?asset=<id>`: the grid stays where
 * it was and the URL of an open asset is shareable. The page loads the detail
 * on the server (including usage), so this component only mutates.
 */
export function MediaDetailSheet({
  detail,
  folders,
  onClose,
}: {
  detail: MediaDetail | null;
  folders: MediaFolderDto[];
  onClose(): void;
}) {
  return (
    <Sheet open={detail !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {detail ? <DetailBody key={detail.id} detail={detail} folders={folders} onClose={onClose} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({ detail, folders, onClose }: { detail: MediaDetail; folders: MediaFolderDto[]; onClose(): void }) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [alt, setAlt] = React.useState(detail.alt ?? "");
  const [filename, setFilename] = React.useState(detail.filename);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [replacing, setReplacing] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const replaceInput = React.useRef<HTMLInputElement>(null);
  const altId = React.useId();
  const filenameId = React.useId();
  const folderId = React.useId();

  const dirty = alt !== (detail.alt ?? "") || filename !== detail.filename;
  const inUse = detail.usageCount > 0;
  const absoluteUrl = typeof window !== "undefined" ? new URL(detail.url, window.location.origin).toString() : detail.url;

  async function saveMeta(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    const result = await run(() => updateMediaAction(detail.id, { alt: alt.trim() || null, filename: filename.trim() }));
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  async function moveTo(next: string | null) {
    if (next === detail.folderId) return;
    await run(() => updateMediaAction(detail.id, { folderId: next }), { successMessage: "Moved." });
  }

  async function onReplace(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReplacing(true);
    try {
      const asset = await replaceFile(detail.id, file);
      toast.success(`Replaced with "${asset.filename}".`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof UploadError ? error.message : "Replace failed.");
    } finally {
      setReplacing(false);
    }
  }

  async function onDelete() {
    const result = await run(() => deleteMediaAction(detail.id));
    if (result.ok) {
      onClose();
      router.refresh();
    } else {
      // The confirm dialog closes on resolve; a failure is already toasted.
      throw new Error(result.error);
    }
  }

  const visibilityMeta = MEDIA_VISIBILITY_META[detail.visibility];

  return (
    <div className="space-y-5 pb-6">
      <SheetHeader className="pr-8">
        <SheetTitle className="truncate text-sm" title={detail.filename}>
          {detail.filename}
        </SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-1.5 text-xs">
          <StatusPill label={MEDIA_KIND_META[detail.kind].label} tone={MEDIA_KIND_META[detail.kind].tone} dot={false} />
          <StatusPill label={visibilityMeta.label} tone={visibilityMeta.tone} />
          {inUse ? <StatusPill label={`Used ${detail.usageCount}×`} tone="info" dot={false} /> : <StatusPill label="Not in use" tone="neutral" dot={false} />}
        </SheetDescription>
      </SheetHeader>

      <div className="px-4">
        <MediaPreview asset={detail} />
      </div>

      <section className="space-y-2 px-4">
        <div className="flex items-center gap-1.5">
          <Link2 className="text-muted-foreground size-3.5 shrink-0" />
          <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 font-mono text-[11px]" title={detail.url}>
            {detail.url}
          </code>
          <CopyButton value={absoluteUrl} label="Copy URL" />
          <Button asChild variant="ghost" size="icon-xs" aria-label="Open in new tab">
            <a href={detail.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
            </a>
          </Button>
        </div>
        {detail.visibility === "PRIVATE" ? (
          <FieldHint>Private files are served only to signed-in admins through this URL, and every read is audited.</FieldHint>
        ) : null}
      </section>

      <div className="px-4">
        <KeyValueList
          dense
          columns={2}
          items={[
            { label: "Type", value: detail.mimeType },
            { label: "Size", value: formatBytes(detail.sizeBytes), numeric: true },
            { label: "Dimensions", value: formatDimensions(detail.width, detail.height), numeric: true },
            { label: "Storage", value: detail.storageProvider },
            { label: "Uploaded", value: formatIstDateTime(new Date(detail.createdAt)) },
            { label: "By", value: detail.uploadedBy?.name ?? detail.uploadedBy?.email ?? null },
            {
              label: "Id",
              value: (
                <span className="inline-flex items-center gap-1">
                  <code className="font-mono text-[11px]">{detail.id}</code>
                  <CopyButton value={detail.id} label="Copy id" />
                </span>
              ),
              wide: true,
            },
            detail.checksum ? { label: "SHA-256", value: <code className="font-mono text-[10px] break-all">{detail.checksum}</code>, wide: true } : { label: "SHA-256", value: null },
          ]}
        />
      </div>

      <Separator />

      <PermissionGate require="media.upload">
        <form onSubmit={saveMeta} className="space-y-3 px-4">
          <div className="space-y-1.5">
            <Label htmlFor={altId} className="text-xs">
              Alt text
            </Label>
            <Textarea
              id={altId}
              rows={2}
              value={alt}
              maxLength={300}
              disabled={pending}
              onChange={(event) => setAlt(event.target.value)}
              placeholder="Describe the image for screen readers and search engines"
              className="text-xs"
            />
            {errors.alt ? <FieldError>{errors.alt}</FieldError> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={filenameId} className="text-xs">
              Filename
            </Label>
            <Input
              id={filenameId}
              value={filename}
              maxLength={200}
              disabled={pending}
              onChange={(event) => setFilename(event.target.value)}
              className="h-8 text-xs"
            />
            <FieldHint>Display name only; the storage key and URL do not change.</FieldHint>
            {errors.filename ? <FieldError>{errors.filename}</FieldError> : null}
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!dirty || pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save details
            </Button>
          </div>
        </form>

        <div className="space-y-1.5 px-4">
          <Label htmlFor={folderId} className="text-xs">
            Folder
          </Label>
          <FolderPickerSelect id={folderId} folders={folders} value={detail.folderId} onChange={moveTo} disabled={pending} />
          {detail.folder ? <FieldHint>Currently in /{detail.folder.path}</FieldHint> : null}
        </div>

        <Separator />

        <div className="space-y-2 px-4">
          <p className="text-xs font-medium">Replace file</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Keeps this asset&apos;s id, folder and alt text so every product, banner or page using it shows the new file.
            {detail.visibility === "PUBLIC" ? " The public URL changes because files are cached for a year." : ""}
          </p>
          <input
            ref={replaceInput}
            type="file"
            accept={ACCEPT_ATTRIBUTE[detail.kind]}
            className="sr-only"
            tabIndex={-1}
            onChange={onReplace}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={replacing || detail.storageProvider === "external"}
            onClick={() => replaceInput.current?.click()}
          >
            {replacing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {replacing ? "Uploading…" : `Choose a ${detail.kind}…`}
          </Button>
        </div>
      </PermissionGate>

      <PermissionGate require="media.delete">
        <Separator />
        <div className="space-y-2 px-4">
          <p className="text-xs font-medium">Delete</p>
          {inUse ? (
            <div className="border-warning/30 bg-warning-muted/40 space-y-2 rounded-lg border px-3 py-2 text-xs">
              <p>This file cannot be deleted while it is in use. Remove it from these places first:</p>
              <ul className="space-y-1">
                {detail.usages.map((usage) => (
                  <li key={usage.relation} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">
                      {usage.type}
                      <span data-numeric className="text-muted-foreground font-normal">
                        {" "}
                        × {usage.count}
                      </span>
                    </span>
                    <span className="text-muted-foreground flex flex-wrap gap-x-2">
                      {usage.items.map((item) => (
                        <Link key={`${usage.relation}:${item.id}`} href={item.href as Route} className="text-brand hover:underline">
                          {item.label}
                        </Link>
                      ))}
                      {usage.count > usage.items.length ? <span>+{usage.count - usage.items.length} more</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">Removes the file and its thumbnail from storage. This cannot be undone.</p>
          )}
          <Button type="button" variant="destructive" size="sm" disabled={inUse || pending} onClick={() => setConfirmDelete(true)}>
            <Trash2 />
            Delete file
          </Button>
        </div>
      </PermissionGate>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete "${detail.filename}"?`}
        description="The file and its thumbnail are removed from storage. Anything that still linked to the URL will show a broken image."
        confirmLabel="Delete"
        destructive
        onConfirm={onDelete}
      />
    </div>
  );
}
