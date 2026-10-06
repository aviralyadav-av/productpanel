"use client";

import Link from "next/link";
import type { Route } from "next";
import { Eye, FolderPlus, MoreHorizontal, Pencil, Power, Trash2 } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { ProductThumb } from "@/components/shared/product-thumb";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { setCategoryFlagAction } from "../actions";
import type { CategoryTreeRow as CategoryTreeRowData } from "../queries";
import { highlightSplit } from "../tree-helpers";
import { CategoryIconPreview } from "./icon-preview";
import type { DeleteCategoryTarget } from "./delete-category-dialog";

/**
 * One row of the category tree. Counts are the rolled-up figures from the
 * query (A9); the two switches call server actions directly - an operator
 * toggling twenty categories should not have to open twenty forms.
 */
export function CategoryTreeRowView({
  row,
  query,
  isMatch,
  canManage,
  onDelete,
}: {
  row: CategoryTreeRowData;
  query: string;
  isMatch: boolean;
  canManage: boolean;
  onDelete: (target: DeleteCategoryTarget) => void;
}) {
  const { pending, run } = useActionToast();
  const editHref = `/admin/categories/${row.id}` as Route;
  const productsHref = `/admin/products?category=${encodeURIComponent(row.id)}&includeDescendants=1` as Route;
  const addChildHref = `/admin/categories/new?parent=${encodeURIComponent(row.id)}` as Route;

  const split = highlightSplit(row.name, query);

  return (
    <div className={cn("flex min-w-0 items-center gap-3", !row.isActive && "opacity-70")}>
      <Thumb row={row} />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={editHref} className={cn("truncate font-medium hover:underline", isMatch && "text-brand")}>
            {split ? (
              <>
                {split[0]}
                <mark className="bg-warning-muted text-foreground rounded-sm px-0.5">{split[1]}</mark>
                {split[2]}
              </>
            ) : (
              row.name
            )}
          </Link>
          {row.isFeatured ? <StatusPill label="Featured" tone="brand" dot={false} /> : null}
          {!row.isActive ? <StatusPill label="Disabled" tone="neutral" dot={false} /> : null}
        </div>
        <p className="text-muted-foreground truncate font-mono text-[11px]">{row.path}</p>
      </div>

      {/* Stats need ~200px; with the toggles they overflow a 768px tablet, so
          they appear from `lg`. The counts stay one click away on the row. */}
      <dl className="hidden shrink-0 items-center gap-4 text-[11px] lg:flex">
        <Count label="Products" value={row.subtreeProductCount} hint={row.productCount !== row.subtreeProductCount ? `${row.productCount} direct` : undefined} />
        <Count label="Children" value={row.childrenCount} />
        <Count label="Filters" value={row.attributeCount} />
      </dl>

      <div className="hidden shrink-0 items-center gap-3 sm:flex">
        <label className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <Switch
            size="sm"
            checked={row.isActive}
            disabled={!canManage || pending}
            onCheckedChange={(value) => run(() => setCategoryFlagAction({ id: row.id, value }, "isActive"))}
            aria-label={`${row.isActive ? "Disable" : "Enable"} ${row.name}`}
          />
          Active
        </label>
        <label className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <Switch
            size="sm"
            checked={row.isFeatured}
            disabled={!canManage || pending}
            onCheckedChange={(value) => run(() => setCategoryFlagAction({ id: row.id, value }, "isFeatured"))}
            aria-label={`${row.isFeatured ? "Unfeature" : "Feature"} ${row.name}`}
          />
          Featured
        </label>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={editHref}>
              <Pencil /> Edit
            </Link>
          </DropdownMenuItem>
          {canManage ? (
            <DropdownMenuItem asChild>
              <Link href={addChildHref}>
                <FolderPlus /> Add child category
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild>
            <Link href={productsHref}>
              <Eye /> View products ({row.subtreeProductCount})
            </Link>
          </DropdownMenuItem>
          {canManage ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={pending}
                onSelect={() => run(() => setCategoryFlagAction({ id: row.id, value: !row.isActive }, "isActive"))}
              >
                <Power /> {row.isActive ? "Disable" : "Enable"}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() =>
                  onDelete({ id: row.id, name: row.name, childrenCount: row.childrenCount, productCount: row.productCount })
                }
              >
                <Trash2 /> Delete…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Thumb({ row }: { row: CategoryTreeRowData }) {
  if (row.imageUrl) return <ProductThumb src={row.imageUrl} alt="" size={28} />;
  if (row.iconName) {
    return (
      <div className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded border">
        <CategoryIconPreview iconName={row.iconName} size={14} />
      </div>
    );
  }
  return <div className="bg-muted/60 size-7 shrink-0 rounded border border-dashed" aria-hidden />;
}

function Count({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex flex-col items-end leading-tight" title={hint}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd data-numeric className="font-medium">
        {value}
      </dd>
    </div>
  );
}
