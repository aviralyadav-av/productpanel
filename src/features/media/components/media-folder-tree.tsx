"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { ChevronRight, Folder, FolderOpen, FolderPlus, Inbox, Layers, MoreHorizontal, Pencil, Trash2, ArrowRightLeft } from "lucide-react";
import { cn } from "cn";

import { useConfirm } from "@/components/shared/confirm-dialog";
import { usePermission } from "@/components/shared/permission-gate";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQueryNav } from "@/hooks/use-query-nav";

import { deleteFolderAction } from "@/features/media/actions";
import { FolderDialog, type FolderDialogState } from "@/features/media/components/folder-dialogs";
import type { MediaFolderDto } from "@/features/media/dto";
import type { MediaFolderTree as FolderTreeData } from "@/features/media/queries";

/**
 * Left-hand folder navigation. A plain nested list rather than the drag-drop
 * TreeView: folders here are a filing system with a handful of levels, and
 * an accidental drag that silently rewrites every storage path underneath is
 * a worse failure than a two-click "Move…" dialog.
 *
 * Selection lives in the URL (`?folder=<id>`, `?folder=root` for unfiled,
 * absent for everything), so the grid re-renders on the server.
 */
export function MediaFolderTree({
  tree,
  activeFolderId,
  className,
}: {
  tree: FolderTreeData;
  /** undefined = all files, "root" = unfiled, else a folder id. */
  activeFolderId: string | undefined;
  className?: string;
}) {
  const canManage = usePermission("media.upload");
  const canDelete = usePermission("media.delete");
  const { hrefFor } = useQueryNav();
  const { run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [dialog, setDialog] = React.useState<FolderDialogState>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());

  const byParent = React.useMemo(() => {
    const map = new Map<string | null, MediaFolderDto[]>();
    for (const folder of tree.folders) {
      const list = map.get(folder.parentId) ?? [];
      list.push(folder);
      map.set(folder.parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [tree.folders]);

  // Expand the ancestors of the active folder so it is visible on arrival.
  const activePath = tree.folders.find((folder) => folder.id === activeFolderId)?.path;
  const forcedOpen = React.useMemo(() => {
    const ids = new Set<string>();
    if (!activePath) return ids;
    for (const folder of tree.folders) if (activePath.startsWith(`${folder.path}/`)) ids.add(folder.id);
    return ids;
  }, [tree.folders, activePath]);

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onDelete(folder: MediaFolderDto) {
    const result = await confirm({
      title: `Delete folder "${folder.name}"?`,
      description:
        folder.totalCount > 0
          ? `This folder still holds ${folder.totalCount} file${folder.totalCount === 1 ? "" : "s"}. Move them out first.`
          : "Only empty folders can be deleted. Files are never removed by deleting a folder.",
      confirmLabel: "Delete folder",
      destructive: true,
    });
    if (!result.ok) return;
    await run(() => deleteFolderAction(folder.id));
  }

  // Link that keeps the other filters but resets paging/selection state.
  const linkFor = (folder: string | null) => hrefFor({ folder, asset: null, page: null }) as Route;

  function renderBranch(parentId: string | null, depth: number): React.ReactNode {
    const children = byParent.get(parentId) ?? [];
    if (children.length === 0) return null;
    return (
      <ul role={depth === 0 ? "tree" : "group"} className="space-y-0.5">
        {children.map((folder) => {
          const hasChildren = (byParent.get(folder.id)?.length ?? 0) > 0;
          const isOpen = forcedOpen.has(folder.id) || !collapsed.has(folder.id);
          const isActive = folder.id === activeFolderId;
          return (
            <li key={folder.id} role="treeitem" aria-expanded={hasChildren ? isOpen : undefined} aria-selected={isActive}>
              <div
                className={cn(
                  "group/row flex items-center gap-1 rounded-md pr-1 text-xs",
                  isActive ? "bg-brand-muted/60 text-foreground" : "hover:bg-muted/60 text-muted-foreground",
                )}
                style={{ paddingLeft: depth * 12 + 4 }}
              >
                <button
                  type="button"
                  aria-label={hasChildren ? (isOpen ? "Collapse" : "Expand") : undefined}
                  tabIndex={hasChildren ? 0 : -1}
                  onClick={() => hasChildren && toggle(folder.id)}
                  className={cn("flex size-5 shrink-0 items-center justify-center rounded", !hasChildren && "invisible")}
                >
                  <ChevronRight className={cn("size-3 transition-transform", isOpen && "rotate-90")} />
                </button>

                <Link href={linkFor(folder.id)} scroll={false} className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5">
                  {isActive ? <FolderOpen className="size-3.5 shrink-0" /> : <Folder className="size-3.5 shrink-0" />}
                  <span className={cn("truncate", isActive && "font-medium")}>{folder.name}</span>
                  <span data-numeric className="text-muted-foreground/70 ml-auto shrink-0 text-[10px]">
                    {folder.assetCount}
                  </span>
                </Link>

                {canManage || canDelete ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Actions for ${folder.name}`}
                        className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {canManage ? (
                        <>
                          <DropdownMenuItem onSelect={() => setDialog({ mode: "create", parentId: folder.id })}>
                            <FolderPlus />
                            New subfolder
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setDialog({ mode: "rename", folder })}>
                            <Pencil />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setDialog({ mode: "move", folder })}>
                            <ArrowRightLeft />
                            Move…
                          </DropdownMenuItem>
                        </>
                      ) : null}
                      {canDelete ? (
                        <>
                          {canManage ? <DropdownMenuSeparator /> : null}
                          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(folder)}>
                            <Trash2 />
                            Delete
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
              {hasChildren && isOpen ? renderBranch(folder.id, depth + 1) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <nav aria-label="Media folders" className={cn("space-y-1 text-xs", className)}>
      <RootLink href={linkFor(null)} icon={Layers} label="All files" count={tree.totalCount} active={activeFolderId === undefined} />
      <RootLink href={linkFor("root")} icon={Inbox} label="Unfiled" count={tree.rootCount} active={activeFolderId === "root"} />

      <div className="flex items-center justify-between px-1 pt-2 pb-1">
        <p className="text-muted-foreground/80 text-[10px] font-medium tracking-wide uppercase">Folders</p>
        {canManage ? (
          <Button type="button" variant="ghost" size="icon-xs" aria-label="New folder" onClick={() => setDialog({ mode: "create", parentId: null })}>
            <FolderPlus />
          </Button>
        ) : null}
      </div>

      {tree.folders.length === 0 ? (
        <p className="text-muted-foreground px-2 py-3 text-[11px] leading-relaxed">
          No folders yet. Folders group uploads and become part of new files&apos; storage paths.
        </p>
      ) : (
        renderBranch(null, 0)
      )}

      <FolderDialog state={dialog} folders={tree.folders} onClose={() => setDialog(null)} />
      {confirmDialog}
    </nav>
  );
}

function RootLink({
  href,
  icon: Icon,
  label,
  count,
  active,
}: {
  href: Route;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1.5",
        active ? "bg-brand-muted/60 text-foreground font-medium" : "text-muted-foreground hover:bg-muted/60",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      <span data-numeric className="text-muted-foreground/70 ml-auto text-[10px]">
        {count}
      </span>
    </Link>
  );
}
