"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Boxes, Download, History, MoreHorizontal, PackagePlus, SlidersHorizontal } from "lucide-react";
import { cn } from "cn";

import { AdjustDialog, toAdjustTarget, type AdjustTarget } from "@/features/inventory/components/adjust-dialog";
import { InventoryToolbar } from "@/features/inventory/components/inventory-toolbar";
import { ThresholdDialog } from "@/features/inventory/components/threshold-dialog";
import { MovementTypeBadge, SignedDelta } from "@/features/inventory/components/movement-cells";
import { inventoryHref, productHref, relativeTime } from "@/features/inventory/format";
import type { CategoryOption, InventoryRow } from "@/features/inventory/queries";
import type { InventorySort } from "@/features/inventory/schemas";
import { BulkActionBar } from "@/components/shared/bulk-action-bar";
import { ColumnVisibilityMenu, useColumnVisibility, type ColumnDef } from "@/components/shared/column-visibility";
import { CopyButton } from "@/components/shared/copy-button";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import type { EntityRef } from "@/components/shared/entity-picker";
import { PaginationBar } from "@/components/shared/list-controls";
import { ProductThumb } from "@/components/shared/product-thumb";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { RowCheckbox, useRowSelection } from "@/components/shared/row-selection";
import { SortableTh } from "@/components/shared/sortable-th";
import { StockBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQueryNav } from "@/hooks/use-query-nav";
import { formatIstDateTime } from "@/lib/dates";
import type { PageMeta } from "@/lib/list-params";
import { formatNumber, formatPaise } from "@/lib/money";
import type { StockState } from "@/lib/enums";

const COLUMNS: ColumnDef[] = [
  { key: "product", label: "Product", locked: true },
  { key: "sku", label: "SKU" },
  { key: "seller", label: "Seller" },
  { key: "category", label: "Category", defaultHidden: true },
  { key: "onHand", label: "On hand" },
  { key: "reserved", label: "Reserved" },
  { key: "available", label: "Available" },
  { key: "threshold", label: "Threshold" },
  { key: "state", label: "State" },
  { key: "value", label: "Value at cost", defaultHidden: true },
  { key: "lastMovement", label: "Last movement" },
  { key: "actions", label: "Actions", locked: true },
];

type DialogState = { kind: "adjust" | "threshold"; targets: AdjustTarget[] } | null;

/**
 * The stock table. Selection, column visibility and the two dialogs are the
 * only client state; everything that filters or sorts lives in the URL.
 *
 * Bulk actions operate on the ids selected on THIS page only (useRowSelection
 * drops ids that scroll out of view), so an operator can never adjust a row
 * they did not see.
 */
export function InventoryLevels({
  rows,
  meta,
  counts,
  sort,
  order,
  categories,
  categoryId,
  seller,
  canAdjust,
  isFiltered,
}: {
  rows: InventoryRow[];
  meta: PageMeta;
  counts: Record<"all" | StockState, number> & { untracked: number };
  sort: InventorySort;
  order: "asc" | "desc";
  categories: CategoryOption[];
  categoryId: string | undefined;
  seller: EntityRef | null;
  canAdjust: boolean;
  isFiltered: boolean;
}) {
  const router = useRouter();
  const { searchParams } = useQueryNav();
  const columns = useColumnVisibility("inventory", COLUMNS);
  const selection = useRowSelection(rows.map((row) => row.variantId));
  const [dialog, setDialog] = React.useState<DialogState>(null);

  const show = columns.isVisible;
  const selectedRows = rows.filter((row) => selection.isSelected(row.variantId));

  function openDialog(kind: "adjust" | "threshold", targets: InventoryRow[]) {
    setDialog({ kind, targets: targets.map(toAdjustTarget) });
  }

  function exportSelection() {
    const params = new URLSearchParams({ format: "csv", scope: "levels" });
    for (const id of selection.selectedIds) params.append("ids", id);
    // An anchor with download, not a navigation: the response is a file.
    const anchor = document.createElement("a");
    anchor.href = `/api/admin/inventory/export?${params.toString()}`;
    anchor.download = "";
    anchor.click();
  }

  const historyHref = (row: InventoryRow) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("variant", row.variantId);
    return `/admin/inventory?${params.toString()}`;
  };

  const sortProps = { currentSort: sort, currentOrder: order };

  return (
    <div className="space-y-3">
      <InventoryToolbar
        counts={counts}
        categories={categories}
        categoryId={categoryId}
        seller={seller}
        columnsMenu={<ColumnVisibilityMenu {...columns.menuProps} />}
      />

      {counts.untracked > 0 && !isFiltered ? (
        <p className="text-muted-foreground text-xs">
          {formatNumber(counts.untracked)} variant{counts.untracked === 1 ? " has" : "s have"} no stock record yet
          and read as zero. Adjusting one writes its opening balance.
        </p>
      ) : null}

      <div className="surface overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={isFiltered ? "No variants match these filters" : "No variants yet"}
            description={
              isFiltered
                ? "Clear the search, category or stock filter to see more."
                : "Stock appears here as soon as a product has a variant."
            }
            action={
              isFiltered ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={inventoryHref({}) as Route}>Clear filters</Link>
                </Button>
              ) : null
            }
          />
        ) : (
          <ResponsiveTable
            table={
              <DataTable>
                <DataTableHead>
                  {canAdjust ? (
                    <Th width="2rem">
                      <RowCheckbox {...selection.headerProps} label="Select all variants on this page" />
                    </Th>
                  ) : null}
                  <SortableTh column="product" label="Product" defaultOrder="asc" {...sortProps} />
                  {show("sku") ? <SortableTh column="sku" label="SKU" defaultOrder="asc" {...sortProps} /> : null}
                  {show("seller") ? <Th>Seller</Th> : null}
                  {show("category") ? <Th>Category</Th> : null}
                  {show("onHand") ? <SortableTh column="onHand" label="On hand" align="right" {...sortProps} /> : null}
                  {show("reserved") ? <SortableTh column="reserved" label="Reserved" align="right" {...sortProps} /> : null}
                  {show("available") ? <SortableTh column="available" label="Available" align="right" defaultOrder="asc" {...sortProps} /> : null}
                  {show("threshold") ? <Th align="right">Threshold</Th> : null}
                  {show("state") ? <Th>State</Th> : null}
                  {show("value") ? <Th align="right">Value</Th> : null}
                  {show("lastMovement") ? <SortableTh column="updated" label="Last movement" {...sortProps} /> : null}
                  <Th width="3rem">
                    <span className="sr-only">Actions</span>
                  </Th>
                </DataTableHead>
                <DataTableBody>
                  {rows.map((row) => (
                    <Tr key={row.variantId} selected={selection.isSelected(row.variantId)}>
                      {canAdjust ? (
                        <Td>
                          <RowCheckbox {...selection.rowProps(row.variantId)} label={`Select ${row.productTitle} ${row.variantName}`} />
                        </Td>
                      ) : null}
                      <Td className="max-w-[20rem]">
                        <ProductCell row={row} />
                      </Td>
                      {show("sku") ? (
                        <Td className="whitespace-nowrap">
                          {row.sku ? (
                            <span className="inline-flex items-center gap-1 font-mono text-xs">
                              {row.sku}
                              <CopyButton value={row.sku} label="Copy SKU" size="icon-xs" />
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </Td>
                      ) : null}
                      {show("seller") ? (
                        <Td className="text-muted-foreground max-w-[10rem] truncate">{row.sellerName ?? "Platform"}</Td>
                      ) : null}
                      {show("category") ? (
                        <Td className="text-muted-foreground max-w-[10rem] truncate">{row.categoryName ?? "—"}</Td>
                      ) : null}
                      {show("onHand") ? <Td numeric align="right">{formatNumber(row.onHand)}</Td> : null}
                      {show("reserved") ? (
                        <Td numeric align="right" className={row.reserved > 0 ? "" : "text-muted-foreground"}>
                          {formatNumber(row.reserved)}
                        </Td>
                      ) : null}
                      {show("available") ? (
                        <Td numeric align="right" className={cn("font-medium", row.available < 0 && "text-destructive")}>
                          {formatNumber(row.available)}
                        </Td>
                      ) : null}
                      {show("threshold") ? (
                        <Td numeric align="right" className="text-muted-foreground">
                          {row.lowStockThreshold}
                          {row.allowBackorder ? <span title="Backorders allowed"> · BO</span> : null}
                        </Td>
                      ) : null}
                      {show("state") ? (
                        <Td>
                          <StockBadge state={row.stockState} />
                          {!row.isTracked ? <span className="text-muted-foreground ml-1 text-[10px]">untracked</span> : null}
                        </Td>
                      ) : null}
                      {show("value") ? (
                        <Td numeric align="right" className="text-muted-foreground">
                          {row.costPaise > 0 ? formatPaise(row.valuePaise) : "—"}
                        </Td>
                      ) : null}
                      {show("lastMovement") ? (
                        <Td className="whitespace-nowrap">
                          <LastMovementCell row={row} />
                        </Td>
                      ) : null}
                      <Td align="right">
                        <RowMenu
                          row={row}
                          canAdjust={canAdjust}
                          historyHref={historyHref(row)}
                          onAdjust={() => openDialog("adjust", [row])}
                          onThreshold={() => openDialog("threshold", [row])}
                        />
                      </Td>
                    </Tr>
                  ))}
                </DataTableBody>
              </DataTable>
            }
            cards={
              <div className="divide-y">
                {rows.map((row) => (
                  <MobileCard
                    key={row.variantId}
                    title={row.productTitle}
                    subtitle={[row.variantName !== "Default" ? row.variantName : null, row.sku].filter(Boolean).join(" · ")}
                    meta={<StockBadge state={row.stockState} />}
                  >
                    <MobileCardField label="On hand" numeric>{row.onHand}</MobileCardField>
                    <MobileCardField label="Available" numeric>{row.available}</MobileCardField>
                    <MobileCardField label="Reserved" numeric>{row.reserved}</MobileCardField>
                    <MobileCardField label="Threshold" numeric>{row.lowStockThreshold}</MobileCardField>
                    <div className="col-span-2 mt-1 flex gap-2">
                      {canAdjust ? (
                        <Button size="xs" variant="outline" onClick={() => openDialog("adjust", [row])}>
                          Adjust
                        </Button>
                      ) : null}
                      <Button asChild size="xs" variant="ghost">
                        <Link href={historyHref(row) as Route} scroll={false}>
                          History
                        </Link>
                      </Button>
                    </div>
                  </MobileCard>
                ))}
              </div>
            }
          />
        )}
        <PaginationBar meta={meta} itemLabel="variants" />
      </div>

      {canAdjust ? (
        <BulkActionBar
          count={selection.count}
          onClear={selection.clear}
          itemLabel="variants"
          actions={[
            { label: "Adjust stock", icon: PackagePlus, onSelect: () => openDialog("adjust", selectedRows) },
            { label: "Set threshold", icon: SlidersHorizontal, onSelect: () => openDialog("threshold", selectedRows) },
            { label: "Export selection", icon: Download, onSelect: exportSelection },
          ]}
        />
      ) : null}

      <AdjustDialog
        open={dialog?.kind === "adjust"}
        onOpenChange={(open) => !open && setDialog(null)}
        targets={dialog?.kind === "adjust" ? dialog.targets : []}
        onDone={() => {
          selection.clear();
          router.refresh();
        }}
      />
      <ThresholdDialog
        open={dialog?.kind === "threshold"}
        onOpenChange={(open) => !open && setDialog(null)}
        targets={dialog?.kind === "threshold" ? dialog.targets : []}
        onDone={() => {
          selection.clear();
          router.refresh();
        }}
      />
    </div>
  );
}

function ProductCell({ row }: { row: InventoryRow }) {
  return (
    <div className="flex items-center gap-2.5">
      <ProductThumb src={row.imageUrl} alt="" size={32} />
      <div className="min-w-0">
        <Link href={productHref(row.productId) as Route} className="block truncate text-sm font-medium hover:underline">
          {row.productTitle}
        </Link>
        <div className="text-muted-foreground flex flex-wrap items-center gap-1 text-[11px]">
          {row.variantName !== "Default" ? <span className="truncate">{row.variantName}</span> : null}
          {row.options.map((option) => (
            <span
              key={`${option.attribute}:${option.value}`}
              className="bg-muted inline-flex items-center gap-1 rounded px-1 py-px"
              title={option.attribute}
            >
              {option.colorHex ? (
                <span aria-hidden className="size-2 rounded-full border" style={{ backgroundColor: option.colorHex }} />
              ) : null}
              {option.value}
            </span>
          ))}
          {!row.isActive ? <span className="text-warning">inactive</span> : null}
        </div>
      </div>
    </div>
  );
}

function LastMovementCell({ row }: { row: InventoryRow }) {
  if (!row.lastMovement) return <span className="text-muted-foreground text-xs">Never</span>;
  return (
    <div className="flex items-center gap-1.5 text-xs" title={formatIstDateTime(row.lastMovement.at)}>
      <MovementTypeBadge type={row.lastMovement.type} />
      <SignedDelta value={row.lastMovement.delta} />
      <span className="text-muted-foreground">{relativeTime(row.lastMovement.at)}</span>
    </div>
  );
}

function RowMenu({
  row,
  canAdjust,
  historyHref,
  onAdjust,
  onThreshold,
}: {
  row: InventoryRow;
  canAdjust: boolean;
  historyHref: string;
  onAdjust: () => void;
  onThreshold: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.productTitle} ${row.variantName}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {canAdjust ? (
          <>
            <DropdownMenuItem onSelect={onAdjust} className="text-xs">
              <PackagePlus />
              Adjust stock
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onThreshold} className="text-xs">
              <SlidersHorizontal />
              Set threshold
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem asChild className="text-xs">
          <Link href={historyHref as Route} scroll={false}>
            <History />
            History
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="text-xs">
          <Link href={productHref(row.productId) as Route}>
            <Boxes />
            View product
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
