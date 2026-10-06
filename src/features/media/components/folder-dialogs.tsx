"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldError } from "@/components/shared/form-layout";
import { useActionToast } from "@/components/shared/use-action-toast";

import { createFolderAction, moveFolderAction, renameFolderAction } from "@/features/media/actions";
import type { MediaFolderDto } from "@/features/media/dto";

/**
 * The three small folder dialogs plus the folder <Select> every "move to"
 * control uses. Kept together because they share the one rule that matters:
 * a folder can never be offered as its own destination.
 */

export const ROOT_VALUE = "__root__";

/** Select listing folders indented by depth. `value` null = root. */
export function FolderPickerSelect({
  folders,
  value,
  onChange,
  excludeSubtreeOf,
  disabled,
  id,
  className,
  rootLabel = "Library root (no folder)",
  placeholder = "Choose a folder",
}: {
  folders: MediaFolderDto[];
  value: string | null;
  onChange(next: string | null): void;
  /** Hide this folder and everything under it (moving a folder into itself). */
  excludeSubtreeOf?: string | null;
  disabled?: boolean;
  id?: string;
  className?: string;
  rootLabel?: string;
  placeholder?: string;
}) {
  const excluded = React.useMemo(() => {
    if (!excludeSubtreeOf) return new Set<string>();
    const root = folders.find((folder) => folder.id === excludeSubtreeOf);
    if (!root) return new Set<string>([excludeSubtreeOf]);
    return new Set(
      folders.filter((folder) => folder.path === root.path || folder.path.startsWith(`${root.path}/`)).map((folder) => folder.id),
    );
  }, [folders, excludeSubtreeOf]);

  return (
    <Select value={value ?? ROOT_VALUE} onValueChange={(next) => onChange(next === ROOT_VALUE ? null : next)} disabled={disabled}>
      <SelectTrigger id={id} size="sm" className={className ?? "w-full"} aria-label="Folder">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ROOT_VALUE}>{rootLabel}</SelectItem>
        {folders
          .filter((folder) => !excluded.has(folder.id))
          .map((folder) => (
            <SelectItem key={folder.id} value={folder.id}>
              <span style={{ paddingLeft: folder.depth * 12 }}>{folder.name}</span>
              <span className="text-muted-foreground ml-1 text-[10px]">/{folder.path}</span>
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

export type FolderDialogState =
  | { mode: "create"; parentId: string | null }
  | { mode: "rename"; folder: MediaFolderDto }
  | { mode: "move"; folder: MediaFolderDto }
  | null;

/**
 * Create / rename / move, driven by a single discriminated state so the tree
 * needs one `setDialog` rather than three booleans.
 */
export function FolderDialog({
  state,
  folders,
  onClose,
}: {
  state: FolderDialogState;
  folders: MediaFolderDto[];
  onClose(): void;
}) {
  const { pending, run } = useActionToast();
  const [name, setName] = React.useState("");
  const [parentId, setParentId] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const nameId = React.useId();
  const parentSelectId = React.useId();

  // Re-seed the fields for each opening.
  React.useEffect(() => {
    if (!state) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeding form state from the dialog request is the intended behaviour
    setErrors({});
    if (state.mode === "create") {
      setName("");
      setParentId(state.parentId);
    } else if (state.mode === "rename") {
      setName(state.folder.name);
    } else {
      setParentId(state.folder.parentId);
    }
  }, [state]);

  const parentOf = (id: string | null) => (id ? folders.find((folder) => folder.id === id) : null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!state) return;

    const result =
      state.mode === "create"
        ? await run(() => createFolderAction({ name, parentId }))
        : state.mode === "rename"
          ? await run(() => renameFolderAction(state.folder.id, { name }))
          : await run(() => moveFolderAction(state.folder.id, { parentId }));

    if (result.ok) onClose();
    else if (result.fieldErrors) setErrors(result.fieldErrors);
  }

  const title =
    state?.mode === "create"
      ? state.parentId
        ? `New folder in "${parentOf(state.parentId)?.name ?? "folder"}"`
        : "New folder"
      : state?.mode === "rename"
        ? `Rename "${state.folder.name}"`
        : state?.mode === "move"
          ? `Move "${state.folder.name}"`
          : "";

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="text-sm">{title}</DialogTitle>
            <DialogDescription className="text-xs">
              {state?.mode === "move"
                ? "Files inside keep their URLs; only the folder path changes."
                : "The folder name becomes part of the storage path for new uploads."}
            </DialogDescription>
          </DialogHeader>

          {state?.mode === "create" || state?.mode === "rename" ? (
            <div className="space-y-1.5">
              <Label htmlFor={nameId} className="text-xs">
                Folder name
              </Label>
              <Input
                id={nameId}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                maxLength={80}
                required
                disabled={pending}
                aria-invalid={Boolean(errors.name) || undefined}
                className="h-8 text-xs"
                placeholder="e.g. Banners"
              />
              {errors.name ? <FieldError>{errors.name}</FieldError> : null}
            </div>
          ) : null}

          {state?.mode === "move" ? (
            <div className="space-y-1.5">
              <Label htmlFor={parentSelectId} className="text-xs">
                Move into
              </Label>
              <FolderPickerSelect
                id={parentSelectId}
                folders={folders}
                value={parentId}
                onChange={setParentId}
                excludeSubtreeOf={state.folder.id}
                disabled={pending}
                rootLabel="Top level"
              />
              {errors.parentId ? <FieldError>{errors.parentId}</FieldError> : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || ((state?.mode === "create" || state?.mode === "rename") && !name.trim())}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              {state?.mode === "create" ? "Create" : state?.mode === "rename" ? "Rename" : "Move"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
