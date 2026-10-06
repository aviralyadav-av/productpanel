"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronsDownUp, ChevronsUpDown, FolderTree, Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { TreeView } from "@/components/shared/tree-view";
import { useActionToast } from "@/components/shared/use-action-toast";

import { reorderCategoriesAction } from "../actions";
import type { CategoryKpis, CategoryTreeRow } from "../queries";
import { MAX_CATEGORY_DEPTH } from "../schemas";
import { searchTree } from "../tree-helpers";
import { CategoryTreeRowView } from "./category-tree-row";
import { DeleteCategoryDialog, type DeleteCategoryTarget } from "./delete-category-dialog";

/**
 * /admin/categories. The whole tree is one payload (a few hundred rows at
 * most), so search is client-side: it narrows the visible rows to the
 * matches and their ancestors and re-mounts the TreeView expanded, which is
 * how "type a name, see where it sits in the tree" works without a round
 * trip. Drag-and-drop reorder/re-parent goes to `reorderCategoriesAction`
 * one move at a time (G5); a rejected move throws so TreeView rolls back.
 */
export function CategoriesScreen({
  rows,
  kpis,
  canManage,
}: {
  rows: CategoryTreeRow[];
  kpis: CategoryKpis;
  canManage: boolean;
}) {
  const router = useRouter();
  const { run } = useActionToast();
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState(true);
  const [deleteTarget, setDeleteTarget] = React.useState<DeleteCategoryTarget | null>(null);

  const search = React.useMemo(() => searchTree(rows, query), [rows, query]);
  const visible = React.useMemo(
    () => (query.trim() ? rows.filter((row) => search.visibleIds.has(row.id)) : rows),
    [rows, query, search],
  );
  const searching = query.trim().length > 0;

  async function handleMove(move: { id: string; parentId: string | null; position: number }) {
    const result = await run(() => reorderCategoriesAction({ moves: [move] }));
    if (!result.ok) throw new Error(result.error);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Categories"
        description="The category tree: unlimited depth, drag to reorder or re-parent, per-category filter attributes inherited down the tree."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setExpanded((value) => !value)}
              disabled={searching}
              title={searching ? "Search results are always expanded" : undefined}
            >
              {expanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
              {expanded ? "Collapse all" : "Expand all"}
            </Button>
            <ExportButton formats={["csv", "xlsx"]} hrefFor={(format) => `/api/admin/categories/export?format=${format}`} />
            {canManage ? (
              <Button asChild size="sm">
                <Link href="/admin/categories/new">
                  <Plus /> New category
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Categories" value={String(kpis.total)} hint={`${kpis.total - kpis.active} disabled`} />
        <StatCard label="Active" value={String(kpis.active)} hint="Visible on the storefront" />
        <StatCard label="Featured" value={String(kpis.featured)} hint="Shown in featured slots" />
        <StatCard
          label="Uncategorised products"
          value={String(kpis.uncategorisedProducts)}
          hint={kpis.uncategorisedProducts > 0 ? "Not reachable from any category filter" : "Every product has a category"}
        />
      </div>

      <div className="surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <div className="relative w-full max-w-xs">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by name or slug"
              aria-label="Filter categories"
              className="h-8 pr-8 pl-8"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear filter"
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
          <p className="text-muted-foreground text-[11px]" data-numeric>
            {searching
              ? `${search.matchIds.size} match${search.matchIds.size === 1 ? "" : "es"} · showing ${visible.length} of ${rows.length}`
              : `${rows.length} categor${rows.length === 1 ? "y" : "ies"} · up to ${MAX_CATEGORY_DEPTH + 1} levels`}
          </p>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={FolderTree}
            title="No categories yet"
            description="Create the first top-level category; sub-categories can be nested underneath it, and attributes assigned to a parent apply to everything below."
            action={
              canManage ? (
                <Button asChild size="sm">
                  <Link href="/admin/categories/new">
                    <Plus /> New category
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState compact icon={Search} title={`Nothing matches “${query}”`} description="Try part of the name or the slug." />
        ) : (
          <TreeView
            // Re-mount on mode change so `defaultCollapsed` takes effect; a
            // search always shows its results expanded.
            key={searching ? `search:${query}` : expanded ? "expanded" : "collapsed"}
            items={visible}
            defaultCollapsed={!searching && !expanded}
            maxDepth={MAX_CATEGORY_DEPTH}
            disabled={!canManage || searching}
            getLabel={(row) => row.name}
            onMove={handleMove}
            renderRow={(row) => (
              <CategoryTreeRowView
                row={row}
                query={query}
                isMatch={search.matchIds.has(row.id)}
                canManage={canManage}
                onDelete={setDeleteTarget}
              />
            )}
          />
        )}
      </div>

      <DeleteCategoryDialog
        target={deleteTarget}
        categories={rows}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onDeleted={() => router.refresh()}
      />
    </div>
  );
}
