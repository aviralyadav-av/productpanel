"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FolderTree, ListTree, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { TreeView, type TreeMove } from "@/components/shared/tree-view";
import { useActionToast } from "@/components/shared/use-action-toast";
import { useQueryNav } from "@/hooks/use-query-nav";

import { deleteItemAction, deleteMenuAction, reorderItemsAction, setItemActiveAction } from "../actions";
import { NAV_MAX_DEPTH, type MenuSummary, type NavItemEditorData, type NavTreeRow } from "../schemas";
import { ImportCategoriesDialog, type CategoryRootOption } from "./import-categories-dialog";
import { MenuDialog, type MenuDialogTarget } from "./menu-dialog";
import { NavItemDialog, type ItemDialogTarget } from "./nav-item-dialog";
import { NavTreeRowView } from "./nav-tree-row";

/**
 * /admin/navigation. One menu at a time (`?menu=<slug>` so a link to "the
 * footer column" is shareable), rendered as a TreeView: dragging a row
 * vertically reorders it, dragging it right nests it under the row above, and
 * every drop sends ONE `{ id, parentId, position }` move to the server (G5).
 * A rejected move throws so the TreeView rolls its optimistic state back.
 *
 * The item editor is fetched lazily: the tree row already carries everything
 * needed to display, and the dialog needs hydrated picker chips, so it asks
 * the REST endpoint for the one row being opened rather than loading editor
 * payloads for a whole menu that is mostly read.
 */

export function NavigationScreen({
  menus,
  activeMenu,
  rows,
  categories,
  canManage,
  preview,
}: {
  menus: MenuSummary[];
  activeMenu: MenuSummary;
  rows: NavTreeRow[];
  categories: CategoryRootOption[];
  canManage: boolean;
  /** Server-rendered <MenuPreview>; refreshed by router.refresh() after a save. */
  preview: React.ReactNode;
}) {
  const router = useRouter();
  const { navigate } = useQueryNav();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [itemTarget, setItemTarget] = React.useState<ItemDialogTarget | null>(null);
  const [menuTarget, setMenuTarget] = React.useState<MenuDialogTarget | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [loadingItem, setLoadingItem] = React.useState<string | null>(null);

  const depthOf = React.useCallback(
    (row: NavTreeRow) => {
      let depth = 0;
      let parentId = row.parentId;
      const byId = new Map(rows.map((entry) => [entry.id, entry]));
      while (parentId) {
        depth += 1;
        parentId = byId.get(parentId)?.parentId ?? null;
      }
      return depth;
    },
    [rows],
  );

  async function handleMove(move: TreeMove) {
    const result = await run(() => reorderItemsAction({ moves: [move] }));
    if (!result.ok) throw new Error(result.error);
    router.refresh();
  }

  async function openEditor(row: NavTreeRow) {
    setLoadingItem(row.id);
    try {
      const response = await fetch(`/api/admin/navigation/items/${row.id}`, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("Could not load that link.");
      const body = (await response.json()) as { data: NavItemEditorData };
      setItemTarget({ mode: "edit", item: body.data, row, depth: depthOf(row) });
    } catch {
      // Fall back to what the tree already knows so the dialog still opens.
      setItemTarget({
        mode: "edit",
        row,
        depth: depthOf(row),
        item: {
          id: row.id,
          menuId: row.menuId,
          parentId: row.parentId,
          label: row.label,
          type: row.type,
          url: row.url,
          category: null,
          product: null,
          page: null,
          blogPost: null,
          iconName: row.iconName,
          badgeText: row.badgeText,
          openInNewTab: row.openInNewTab,
          isMegaMenu: row.isMegaMenu,
          isActive: row.isActive,
        },
      });
    } finally {
      setLoadingItem(null);
    }
  }

  async function removeItem(row: NavTreeRow) {
    const answer = await confirm({
      title: `Delete "${row.label}"?`,
      description:
        row.childCount > 0
          ? `Its ${row.childCount} child link${row.childCount === 1 ? "" : "s"} go with it. The website stops showing them on the next cache refresh.`
          : "The website stops showing this link on the next cache refresh.",
      confirmLabel: "Delete link",
      destructive: true,
    });
    if (!answer.ok) return;
    const result = await run(() => deleteItemAction(row.id));
    if (result.ok) router.refresh();
  }

  async function removeMenu() {
    const answer = await confirm({
      title: `Delete the "${activeMenu.name}" menu?`,
      description: `Its ${activeMenu.itemCount} link${activeMenu.itemCount === 1 ? "" : "s"} are deleted with it. Built-in menus cannot be deleted.`,
      confirmLabel: "Delete menu",
      destructive: true,
      requireTypedText: activeMenu.name,
    });
    if (!answer.ok) return;
    const result = await run(() => deleteMenuAction(activeMenu.id));
    if (result.ok) {
      navigate({ menu: null });
      router.refresh();
    }
  }

  const broken = rows.filter((row) => !row.available);

  return (
    <div className="space-y-4">
      {/* Menu switcher */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Menus">
          {menus.map((menu) => {
            const isActive = menu.id === activeMenu.id;
            return (
              <button
                key={menu.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => navigate({ menu: menu.slug })}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                  isActive ? "bg-brand/10 border-brand/40 text-foreground" : "hover:bg-muted text-muted-foreground",
                )}
              >
                <span className="font-medium">{menu.name}</span>
                <span className="opacity-70" data-numeric>
                  {menu.itemCount}
                </span>
                {menu.brokenCount > 0 ? <AlertTriangle className="text-warning size-3" /> : null}
              </button>
            );
          })}
        </div>
        {canManage ? (
          <Button size="xs" variant="outline" onClick={() => setMenuTarget({ mode: "create" })}>
            <Plus /> New menu
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {activeMenu.name} <code className="text-muted-foreground font-mono text-[11px]">{activeMenu.slug}</code>
              </p>
              <p className="text-muted-foreground text-xs">
                {activeMenu.description ??
                  `${activeMenu.itemCount} link${activeMenu.itemCount === 1 ? "" : "s"}, ${activeMenu.activeCount} visible. Drag to reorder; drag right to nest (up to ${NAV_MAX_DEPTH + 1} levels).`}
              </p>
            </div>
            {canManage ? (
              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="xs" variant="outline" onClick={() => setImporting(true)}>
                  <FolderTree /> Import categories
                </Button>
                <Button size="xs" variant="outline" onClick={() => setMenuTarget({ mode: "edit", menu: activeMenu })}>
                  <Pencil /> Rename
                </Button>
                {!activeMenu.isSystem ? (
                  <Button size="xs" variant="outline" onClick={removeMenu} disabled={pending}>
                    <Trash2 className="text-destructive" /> Delete menu
                  </Button>
                ) : null}
                <Button size="xs" onClick={() => setItemTarget({ mode: "create", menuId: activeMenu.id, parentId: null, parentLabel: null })}>
                  <Plus /> Add link
                </Button>
              </div>
            ) : null}
          </div>

          {broken.length > 0 ? (
            <p className="text-warning bg-warning/10 border-warning/30 rounded-md border px-3 py-2 text-xs">
              <AlertTriangle className="mr-1 inline size-3" />
              {broken.length} link{broken.length === 1 ? "" : "s"} point at a target that is missing, unpublished or disabled. The website renders them
              inactive (§11.25) — fix or hide them.
            </p>
          ) : null}

          <div className="surface overflow-hidden p-1">
            <TreeView
              items={rows}
              maxDepth={NAV_MAX_DEPTH}
              disabled={!canManage || pending}
              getLabel={(row) => row.label}
              onMove={handleMove}
              emptyState={
                <EmptyState
                  icon={ListTree}
                  title="This menu is empty"
                  description="Menu items become the storefront's navigation: GET /api/v1/navigation/{slug} returns them nested, in this order, with each link resolved to a storefront URL."
                  action={
                    canManage ? (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => setItemTarget({ mode: "create", menuId: activeMenu.id, parentId: null, parentLabel: null })}>
                          <Plus /> Add a link
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
                          <FolderTree /> Import categories
                        </Button>
                      </div>
                    ) : undefined
                  }
                />
              }
              renderRow={(row, { depth }) => (
                <NavTreeRowView
                  row={row}
                  depth={depth}
                  canManage={canManage}
                  pending={pending || loadingItem === row.id}
                  onEdit={openEditor}
                  onAddChild={(parent) =>
                    setItemTarget({ mode: "create", menuId: activeMenu.id, parentId: parent.id, parentLabel: parent.label })
                  }
                  onToggle={(target, isActive) =>
                    run(() => setItemActiveAction({ id: target.id, isActive })).then((result) => result.ok && router.refresh())
                  }
                  onDelete={removeItem}
                />
              )}
            />
          </div>
        </section>

        <aside className="space-y-2">{preview}</aside>
      </div>

      <NavItemDialog target={itemTarget} onOpenChange={(open) => !open && setItemTarget(null)} canManage={canManage} />
      <MenuDialog target={menuTarget} onOpenChange={(open) => !open && setMenuTarget(null)} />
      <ImportCategoriesDialog
        open={importing}
        onOpenChange={setImporting}
        menuId={activeMenu.id}
        menuName={activeMenu.name}
        categories={categories}
      />
      {confirmDialog}
    </div>
  );
}
