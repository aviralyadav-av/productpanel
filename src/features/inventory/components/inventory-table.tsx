"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Boxes, ChevronsUpDown, History } from "lucide-react";
import { cn } from "cn";

import {
  AdjustStockDialog,
  type AdjustTarget,
} from "@/features/inventory/components/adjust-stock-dialog";
import type { InventoryRow } from "@/features/inventory/queries";
import {
  DataTable,
  DataTableBody,
  DataTableHead,
  Td,
  Th,
  Tr,
} from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ProductThumb } from "@/components/shared/product-thumb";
import { StockBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mergeQuery } from "@/lib/list-params";

/** Must match the defaults the page passes to parseListParams. */
const DEFAULT_SORT = "available";
const DEFAULT_ORDER = "asc";

function toTarget(row: InventoryRow): AdjustTarget {
  return {
    variantId: row.variantId,
    productTitle: row.productTitle,
    variantName: row.variantName,
    sku: row.sku,
    onHand: row.onHand,
    reserved: row.reserved,
    lowStockThreshold: row.lowStockThreshold,
  };
}

export function InventoryTable({ rows }: { rows: InventoryRow[] }) {
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [targets, setTargets] = React.useState<AdjustTarget[]>([]);
  // Bumped on every open so the dialog remounts with an empty form.
  const [dialogKey, setDialogKey] = React.useState(0);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // The selection is scoped to what is on screen, derived rather than reset:
  // a page or filter change drops the ids that are no longer visible, so a
  // bulk adjustment can never touch a row the operator cannot see.
  const visibleIds = new Set(rows.map((row) => row.variantId));
  const selectedSet = new Set(
    selectedIds.filter((id) => visibleIds.has(id)),
  );
  const selectedCount = selectedSet.size;
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const headerState: boolean | "indeterminate" = allSelected
    ? true
    : selectedCount > 0
      ? "indeterminate"
      : false;

  function toggleRow(variantId: string, checked: boolean) {
    setSelectedIds((current) =>
      checked
        ? [...current, variantId]
        : current.filter((id) => id !== variantId),
    );
  }

  function openAdjust(next: AdjustTarget[]) {
    setTargets(next);
    setDialogKey((key) => key + 1);
    setDialogOpen(true);
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Boxes}
        title="No variants match these filters"
        description="Clear the search or the stock filter to see the rest of the catalogue. Every product variant appears here, whether or not it has ever been counted."
      />
    );
  }

  return (
    <>
      {selectedCount > 0 ? (
        <div className="bg-muted/50 flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
          <span data-numeric className="font-medium">
            {selectedCount} selected
          </span>
          <span className="text-muted-foreground">
            The same change is applied to each.
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setSelectedIds([])}
            >
              Clear
            </Button>
            <Button
              size="xs"
              onClick={() =>
                openAdjust(
                  rows
                    .filter((row) => selectedSet.has(row.variantId))
                    .map(toTarget),
                )
              }
            >
              Adjust selected
            </Button>
          </div>
        </div>
      ) : null}

      <DataTable>
        <DataTableHead>
          <Th width="2.25rem">
            <Checkbox
              checked={headerState}
              onCheckedChange={(checked) =>
                setSelectedIds(
                  checked === true ? rows.map((row) => row.variantId) : [],
                )
              }
              aria-label="Select all variants on this page"
            />
          </Th>
          <Th>
            <SortHeader column="title" label="Product" />
          </Th>
          <Th>Variant</Th>
          <Th>SKU</Th>
          <Th align="right">
            <SortHeader column="onHand" label="On hand" align="right" />
          </Th>
          <Th align="right">Reserved</Th>
          <Th align="right">
            <SortHeader column="available" label="Available" align="right" />
          </Th>
          <Th align="right">Low at</Th>
          <Th>Status</Th>
          <Th align="right">Actions</Th>
        </DataTableHead>

        <DataTableBody>
          {rows.map((row) => {
            const isSelected = selectedSet.has(row.variantId);
            return (
              <Tr
                key={row.variantId}
                className={cn(isSelected && "bg-accent/40")}
              >
                <Td>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked) =>
                      toggleRow(row.variantId, checked === true)
                    }
                    aria-label={`Select ${row.productTitle} ${row.variantName}`}
                  />
                </Td>

                <Td className="max-w-[18rem]">
                  <div className="flex items-center gap-2">
                    <ProductThumb
                      src={row.imageUrl}
                      alt={row.productTitle}
                      size={28}
                    />
                    <div className="min-w-0">
                      <Link
                        href={`/products/${row.productId}` as never}
                        className="block truncate font-medium hover:underline"
                      >
                        {row.productTitle}
                      </Link>
                      <p className="text-muted-foreground truncate text-[11px]">
                        {row.categoryName}
                        {row.isActive ? "" : " · variant inactive"}
                      </p>
                    </div>
                  </div>
                </Td>

                <Td className="whitespace-nowrap">{row.variantName}</Td>

                <Td className="text-muted-foreground font-mono text-[11px]">
                  {row.sku ?? "—"}
                </Td>

                <Td numeric align="right">
                  {row.onHand}
                </Td>

                <Td numeric align="right" className="text-muted-foreground">
                  {row.reserved}
                </Td>

                <Td
                  numeric
                  align="right"
                  className={cn(
                    "font-medium",
                    row.available <= 0 && "text-destructive",
                  )}
                >
                  {row.available}
                </Td>

                <Td numeric align="right" className="text-muted-foreground">
                  {row.lowStockThreshold}
                </Td>

                <Td>
                  <StockBadge state={row.state} />
                </Td>

                <Td align="right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      asChild
                      variant="ghost"
                      size="icon-xs"
                      title="Movement history for this variant"
                    >
                      <Link
                        href={
                          `/inventory?tab=movements&variant=${row.variantId}` as never
                        }
                        aria-label={`Movement history for ${row.productTitle} ${row.variantName}`}
                      >
                        <History />
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => openAdjust([toTarget(row)])}
                    >
                      Adjust
                    </Button>
                  </div>
                </Td>
              </Tr>
            );
          })}
        </DataTableBody>
      </DataTable>

      {dialogOpen && targets.length > 0 ? (
        <AdjustStockDialog
          key={dialogKey}
          targets={targets}
          open
          onOpenChange={setDialogOpen}
        />
      ) : null}
    </>
  );
}

/**
 * Sorting is a link, not a click handler: the sort lives in the URL like every
 * other piece of list state, so a sorted view can be shared or bookmarked.
 */
function SortHeader({
  column,
  label,
  align = "left",
}: {
  column: string;
  label: string;
  align?: "left" | "right";
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeSort = searchParams.get("sort") ?? DEFAULT_SORT;
  const activeOrder = searchParams.get("order") === "desc" ? "desc" : "asc";
  const isActive = activeSort === column;
  const nextOrder = isActive && activeOrder === DEFAULT_ORDER ? "desc" : "asc";

  const href = `${pathname}${mergeQuery(searchParams.toString(), {
    sort: column,
    order: nextOrder,
  })}`;

  const Icon = !isActive ? ChevronsUpDown : activeOrder === "asc" ? ArrowUp : ArrowDown;

  return (
    <Link
      href={href as never}
      scroll={false}
      className={cn(
        "inline-flex items-center gap-1 transition-colors hover:text-foreground",
        align === "right" && "flex-row-reverse",
        isActive && "text-foreground",
      )}
    >
      {label}
      <Icon className={cn("size-3", !isActive && "opacity-40")} />
    </Link>
  );
}

/**
 * The category filter writes ?category= and nothing else. Radix rejects an
 * empty string as an item value, so "all" is the sentinel that clears it.
 */
export function CategoryFilter({
  options,
}: {
  options: Array<{ id: string; name: string; count: number }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const value = searchParams.get("category") ?? "all";

  if (options.length === 0) return null;

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const query = mergeQuery(searchParams.toString(), {
          category: next === "all" ? null : next,
        });
        router.replace(`${pathname}${query}` as never, { scroll: false });
      }}
    >
      <SelectTrigger
        size="sm"
        className="h-8 w-44 text-xs"
        aria-label="Filter by category"
      >
        <SelectValue placeholder="All categories" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all" className="text-xs">
          All categories
        </SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id} className="text-xs">
            {option.name} ({option.count})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
