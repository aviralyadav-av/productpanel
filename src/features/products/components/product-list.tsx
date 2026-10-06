"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  Archive,
  Copy,
  Eye,
  EyeOff,
  Flame,
  MoreHorizontal,
  Package,
  Pencil,
  Sparkles,
  Star,
  Tag,
  Trash2,
  TrendingUp,
  Wand2,
} from "lucide-react";

import { BulkActionBar, type BulkAction } from "@/components/shared/bulk-action-bar";
import { ColumnVisibilityMenu, useColumnVisibility } from "@/components/shared/column-visibility";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import type { EntityRef } from "@/components/shared/entity-picker";
import { ExportButton } from "@/components/shared/export-button";
import { FilterTabs, PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { PriceText } from "@/components/shared/price-text";
import { ProductThumb } from "@/components/shared/product-thumb";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { RowCheckbox, useRowSelection } from "@/components/shared/row-selection";
import { SortableTh } from "@/components/shared/sortable-th";
import { ProductStatusBadge, StockBadge } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatIstDate } from "@/lib/dates";
import { PRODUCT_STATUS_META, PRODUCT_STATUSES, type ProductStatus } from "@/lib/enums";
import type { PageMeta } from "@/lib/list-params";
import { formatNumber } from "@/lib/money";

import {
  bulkProductsAction,
  deleteProductAction,
  duplicateProductAction,
  previewLinkAction,
  setProductStatusAction,
} from "@/features/products/actions";
import { AttributeCsvDialog } from "@/features/products/components/attribute-csv-dialog";
import { BulkOpDialog, type BulkDialogKind } from "@/features/products/components/bulk-dialogs";
import { ProductFilters } from "@/features/products/components/product-toolbar";
import { PRODUCT_COLUMNS, hasActiveFilters, type ProductListFilters } from "@/features/products/filters";
import type { AttributeCatalogEntry, CategoryOption, ProductRow, StatusCounts } from "@/features/products/queries";
import { BULK_OP_PERMISSION, type BulkOperation } from "@/features/products/schemas";

/**
 * Toolbar + table + bulk bar for /admin/products. One client component so the
 * column-visibility state is shared between the menu in the toolbar and the
 * cells in the table. Everything else (filters, sort, page) lives in the URL
 * and the Server Component page re-queries.
 */
export function ProductList({
  rows,
  meta,
  filters,
  statusCounts,
  sort,
  order,
  categories,
  attributes,
  seller,
  permissions,
  exportQuery,
}: {
  rows: ProductRow[];
  meta: PageMeta;
  filters: ProductListFilters;
  statusCounts: StatusCounts;
  sort: string;
  order: "asc" | "desc";
  categories: CategoryOption[];
  attributes: AttributeCatalogEntry[];
  seller: EntityRef | null;
  permissions: string[];
  /** The current query string, so the export link reproduces the visible filter. */
  exportQuery: string;
}) {
  const router = useRouter();
  const { run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const columns = useColumnVisibility("products", [...PRODUCT_COLUMNS]);
  const selection = useRowSelection(rows.map((row) => row.id));
  const [bulkDialog, setBulkDialog] = React.useState<BulkDialogKind | null>(null);
  const permitted = new Set(permissions);
  const can = (code: string) => permitted.has("*") || permitted.has(code);

  const runBulk = async (op: BulkOperation) => {
    const result = await run(() => bulkProductsAction({ ids: selection.selectedIds, ...op }));
    if (result.ok) {
      selection.clear();
      setBulkDialog(null);
      router.refresh();
    }
  };

  const confirmedBulk = async (op: BulkOperation, title: string, description: string, destructive = false) => {
    const answer = await confirm({ title, description, destructive, confirmLabel: title, requireReason: destructive ? { label: "Reason" } : undefined });
    if (answer.ok) await runBulk(op);
  };

  const count = selection.count;
  const bulkActions: BulkAction[] = [
    { label: "Publish", icon: Eye, permission: BULK_OP_PERMISSION.PUBLISH, onSelect: () => confirmedBulk({ op: "PUBLISH" }, "Publish", `Publish ${count} product(s)? Products that fail the publish checklist are skipped and reported.`) },
    { label: "Unpublish", icon: EyeOff, permission: BULK_OP_PERMISSION.UNPUBLISH, onSelect: () => confirmedBulk({ op: "UNPUBLISH" }, "Unpublish", `Move ${count} product(s) back to draft?`) },
    { label: "Archive", icon: Archive, permission: BULK_OP_PERMISSION.ARCHIVE, onSelect: () => confirmedBulk({ op: "ARCHIVE" }, "Archive", `Archive ${count} product(s)? They stay in order history but leave the storefront.`) },
    { label: "Set category", icon: Tag, permission: BULK_OP_PERMISSION.SET_CATEGORY, onSelect: () => setBulkDialog("SET_CATEGORY") },
    { label: "Adjust price", icon: TrendingUp, permission: BULK_OP_PERMISSION.ADJUST_PRICE, onSelect: () => setBulkDialog("ADJUST_PRICE") },
    { label: "Set stock", icon: Package, permission: BULK_OP_PERMISSION.SET_STOCK, onSelect: () => setBulkDialog("SET_STOCK") },
    { label: "Set flags", icon: Star, permission: BULK_OP_PERMISSION.SET_FLAGS, onSelect: () => setBulkDialog("SET_FLAGS") },
    { label: "Set attribute", icon: Wand2, permission: BULK_OP_PERMISSION.SET_ATTRIBUTE, onSelect: () => setBulkDialog("SET_ATTRIBUTE") },
    { label: "Delete", icon: Trash2, destructive: true, permission: BULK_OP_PERMISSION.DELETE, onSelect: () => confirmedBulk({ op: "DELETE" }, "Delete", `Delete ${count} product(s)? Order history is preserved; slugs are freed.`, true) },
  ];

  const statusOptions = PRODUCT_STATUSES.map((status: ProductStatus) => ({ value: status, label: PRODUCT_STATUS_META[status].label, count: statusCounts[status] }));
  // Before localStorage has hydrated every column renders, so SSR and the first
  // client paint agree; hidden columns disappear on the next tick.
  const visible = (key: string) => !columns.hydrated || columns.isVisible(key);

  return (
    <div className="surface overflow-hidden">
      <DataTableToolbar
        search={<SearchInput placeholder="Search title, slug or SKU" />}
        filters={<FilterTabs paramKey="status" options={statusOptions} allLabel={`All ${statusCounts.all}`} />}
        actions={
          <>
            <ColumnVisibilityMenu {...columns.menuProps} />
            {can("products.bulk") ? <AttributeCsvDialog categories={categories} /> : null}
            <ExportButton formats={["csv", "xlsx"]} hrefFor={(format) => `/api/admin/products/export?${exportQuery}${exportQuery ? "&" : ""}format=${format}`} />
          </>
        }
      />
      <div className="border-b px-4 py-2">
        <ProductFilters filters={filters} categories={categories} attributes={attributes} seller={seller} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Package}
          title={hasActiveFilters(filters) ? "No products match these filters" : "No products yet"}
          description={
            hasActiveFilters(filters)
              ? "Try clearing a filter or widening the price range."
              : "Create your first product; it starts as a draft and appears on the storefront once published."
          }
          action={
            can("products.create") && !hasActiveFilters(filters) ? (
              <Button asChild size="sm">
                <Link href={"/admin/products/new" as Route}>New product</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <ResponsiveTable
          table={
            <DataTable>
              <DataTableHead>
                <Th width="2.5rem">
                  <RowCheckbox {...selection.headerProps} label="Select all on this page" />
                </Th>
                <Th width="3rem" />
                <SortableTh column="title" label="Product" currentSort={sort} currentOrder={order} defaultOrder="asc" />
                {visible("category") ? <SortableTh column="category" label="Category" currentSort={sort} currentOrder={order} defaultOrder="asc" /> : null}
                {visible("seller") ? <SortableTh column="seller" label="Seller" currentSort={sort} currentOrder={order} defaultOrder="asc" /> : null}
                {visible("price") ? <SortableTh column="price" label="Price" currentSort={sort} currentOrder={order} align="right" /> : null}
                {visible("stock") ? <SortableTh column="stock" label="Stock" currentSort={sort} currentOrder={order} align="right" /> : null}
                {visible("status") ? <SortableTh column="status" label="Status" currentSort={sort} currentOrder={order} defaultOrder="asc" /> : null}
                {visible("flags") ? <Th>Flags</Th> : null}
                {visible("updatedAt") ? <SortableTh column="updatedAt" label="Updated" currentSort={sort} currentOrder={order} /> : null}
                {visible("createdAt") ? <SortableTh column="createdAt" label="Created" currentSort={sort} currentOrder={order} /> : null}
                <Th width="2.5rem" />
              </DataTableHead>
              <DataTableBody>
                {rows.map((row) => (
                  <Tr key={row.id} selected={selection.isSelected(row.id)}>
                    <Td>
                      <RowCheckbox {...selection.rowProps(row.id)} label={`Select ${row.title}`} />
                    </Td>
                    <Td>
                      <ProductThumb src={row.thumbnailUrl} alt={row.title} size={36} />
                    </Td>
                    <Td>
                      <Link href={`/admin/products/${row.id}` as Route} className="font-medium hover:underline">
                        {row.title}
                      </Link>
                      <div className="text-muted-foreground truncate font-mono text-[11px]">
                        /{row.slug}
                        {row.baseSku ? ` · ${row.baseSku}` : ""}
                        {row.variantCount > 1 ? ` · ${row.variantCount} variants` : ""}
                      </div>
                    </Td>
                    {visible("category") ? <Td className="text-muted-foreground max-w-48 truncate text-xs">{row.categoryPath ?? "—"}</Td> : null}
                    {visible("seller") ? <Td className="text-xs">{row.sellerName ?? <span className="text-muted-foreground">Platform</span>}</Td> : null}
                    {visible("price") ? (
                      <Td align="right" numeric>
                        <PriceText paise={row.effectivePricePaise} comparePaise={row.pricePaise} />
                        {row.minVariantPricePaise !== row.maxVariantPricePaise && row.maxVariantPricePaise > 0 ? (
                          <div className="text-muted-foreground text-[11px]">
                            <PriceText paise={row.minVariantPricePaise} /> – <PriceText paise={row.maxVariantPricePaise} />
                          </div>
                        ) : null}
                      </Td>
                    ) : null}
                    {visible("stock") ? (
                      <Td align="right">
                        <div className="flex flex-col items-end gap-0.5">
                          <StockBadge state={row.stockState} />
                          <span data-numeric className="text-muted-foreground text-[11px]">
                            {formatNumber(row.available)} available
                          </span>
                        </div>
                      </Td>
                    ) : null}
                    {visible("status") ? (
                      <Td>
                        <ProductStatusBadge status={row.status} />
                      </Td>
                    ) : null}
                    {visible("flags") ? (
                      <Td>
                        <FlagIcons row={row} />
                      </Td>
                    ) : null}
                    {visible("updatedAt") ? <Td className="text-muted-foreground text-xs whitespace-nowrap">{formatIstDate(row.updatedAt)}</Td> : null}
                    {visible("createdAt") ? <Td className="text-muted-foreground text-xs whitespace-nowrap">{formatIstDate(row.createdAt)}</Td> : null}
                    <Td>
                      <RowActions row={row} can={can} />
                    </Td>
                  </Tr>
                ))}
              </DataTableBody>
            </DataTable>
          }
          cards={rows.map((row) => (
            <MobileCard
              key={row.id}
              href={`/admin/products/${row.id}`}
              title={
                <span className="flex items-center gap-2">
                  <ProductThumb src={row.thumbnailUrl} alt={row.title} size={32} />
                  {row.title}
                </span>
              }
              subtitle={row.categoryPath ?? "Uncategorised"}
              meta={<ProductStatusBadge status={row.status} />}
            >
              <MobileCardField label="Price" numeric>
                <PriceText paise={row.effectivePricePaise} comparePaise={row.pricePaise} />
              </MobileCardField>
              <MobileCardField label="Stock">
                <StockBadge state={row.stockState} />
              </MobileCardField>
              <MobileCardField label="Seller">{row.sellerName ?? "Platform"}</MobileCardField>
            </MobileCard>
          ))}
        />
      )}

      {meta.total > 0 ? <PaginationBar meta={meta} itemLabel="products" /> : null}

      <BulkActionBar count={selection.count} actions={bulkActions} onClear={selection.clear} permissions={permitted.has("*") ? undefined : permitted} itemLabel="selected" />
      <BulkOpDialog kind={bulkDialog} count={selection.count} categories={categories} attributes={attributes} onClose={() => setBulkDialog(null)} onConfirm={runBulk} />
      {confirmDialog}
    </div>
  );
}

function FlagIcons({ row }: { row: ProductRow }) {
  const flags: Array<{ on: boolean; label: string; Icon: typeof Star }> = [
    { on: row.isFeatured, label: "Featured", Icon: Star },
    { on: row.isNewArrival, label: "New arrival", Icon: Sparkles },
    { on: row.isBestseller, label: "Bestseller", Icon: Flame },
    { on: row.isTrending, label: "Trending", Icon: TrendingUp },
    { on: row.isCustomizable, label: "Customisable", Icon: Wand2 },
  ];
  const active = flags.filter((flag) => flag.on);
  if (active.length === 0) return <span className="text-muted-foreground/60">—</span>;
  return (
    <span className="flex items-center gap-1">
      {active.map(({ label, Icon }) => (
        <Tooltip key={label}>
          <TooltipTrigger asChild>
            <span aria-label={label} className="text-muted-foreground">
              <Icon className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
}

function RowActions({ row, can }: { row: ProductRow; can: (code: string) => boolean }) {
  const router = useRouter();
  const { run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();

  const setStatus = async (status: ProductStatus) => {
    if (status === "ARCHIVED") {
      const answer = await confirm({ title: "Archive product", description: `Archive "${row.title}"? It leaves the storefront but keeps its history.`, confirmLabel: "Archive" });
      if (!answer.ok) return;
    }
    await run(() => setProductStatusAction(row.id, status), { onSuccess: () => router.refresh() });
  };

  const remove = async () => {
    const answer = await confirm({
      title: "Delete product",
      description: `Delete "${row.title}"? Order history is preserved and the slug is freed.`,
      destructive: true,
      confirmLabel: "Delete",
      requireReason: { label: "Reason", placeholder: "Why is this product being deleted?" },
    });
    if (!answer.ok) return;
    await run(() => deleteProductAction(row.id, answer.reason), { onSuccess: () => router.refresh() });
  };

  const preview = async () => {
    await run(() => previewLinkAction(row.id), { silent: true, onSuccess: (data) => window.open(data.url, "_blank", "noopener") });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.title}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/admin/products/${row.id}` as Route}>
              <Pencil /> Edit
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void preview()}>
            <Eye /> Preview on storefront
          </DropdownMenuItem>
          {can("products.create") ? (
            <DropdownMenuItem onSelect={() => void run(() => duplicateProductAction(row.id), { onSuccess: (copy) => router.push(`/admin/products/${copy.id}` as Route) })}>
              <Copy /> Duplicate
            </DropdownMenuItem>
          ) : null}
          {can("products.publish") ? (
            <>
              <DropdownMenuSeparator />
              {row.status === "PUBLISHED" ? (
                <DropdownMenuItem onSelect={() => void setStatus("DRAFT")}>
                  <EyeOff /> Unpublish
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => void setStatus("PUBLISHED")}>
                  <Eye /> Publish
                </DropdownMenuItem>
              )}
              {row.status !== "ARCHIVED" ? (
                <DropdownMenuItem onSelect={() => void setStatus("ARCHIVED")}>
                  <Archive /> Archive
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          {can("products.delete") ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmDialog}
    </>
  );
}
