"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Package, PackageCheck, Printer, ShoppingCart } from "lucide-react";

import {
  ORDER_SOURCE_META,
  ORDER_STATUS_META,
  PAYMENT_METHOD_META,
  PAYMENT_STATUS_META,
  SHIPMENT_STATUS_META,
  type OrderSource,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type ShipmentStatus,
} from "@/lib/enums";
import { formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import type { PageMeta } from "@/lib/list-params";
import { BulkActionBar } from "@/components/shared/bulk-action-bar";
import { ColumnVisibilityMenu, useColumnVisibility } from "@/components/shared/column-visibility";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { RowCheckbox, useRowSelection } from "@/components/shared/row-selection";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { bulkOrdersAction } from "../actions";
import { ORDER_COLUMNS, type BulkOrderOp } from "../schemas";
import type { OrderListRow } from "../queries";

/**
 * The order list. Rows are dense on purpose - an operations shift scans this
 * screen dozens of times a day - so the two things that decide what to do
 * next (order status, payment status) always sit in the same columns, and the
 * shipping status (§14.C8) sits beside them rather than hiding in the detail.
 */

function orderHref(id: string): Route {
  return `/admin/orders/${id}` as Route;
}

function ItemThumbs({ row }: { row: OrderListRow }) {
  return (
    <div className="flex items-center gap-1">
      <div className="flex -space-x-1.5">
        {row.itemThumbs.map((thumb, index) =>
          thumb.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- order snapshots store an absolute URL, not a Next image source.
            <img
              key={`${thumb.title}-${index}`}
              src={thumb.url}
              alt=""
              className="bg-muted size-6 rounded border object-cover"
              loading="lazy"
            />
          ) : (
            <span key={`${thumb.title}-${index}`} className="bg-muted text-muted-foreground flex size-6 items-center justify-center rounded border text-[9px]">
              {thumb.title.slice(0, 2).toUpperCase()}
            </span>
          ),
        )}
      </div>
      <span data-numeric className="text-muted-foreground text-xs">
        {row.itemCount}
      </span>
    </div>
  );
}

function ShippingCell({ row }: { row: OrderListRow }) {
  if (!row.shippingStatus) return <span className="text-muted-foreground">—</span>;
  const meta = SHIPMENT_STATUS_META[row.shippingStatus as ShipmentStatus];
  return (
    <div className="flex flex-col gap-0.5">
      <StatusPill label={meta?.label ?? row.shippingStatus} tone={meta?.tone ?? "neutral"} />
      {row.trackingNumber ? <span className="text-muted-foreground font-mono text-[10px]">{row.trackingNumber}</span> : null}
    </div>
  );
}

export function OrdersTable({
  rows,
  meta,
  sort,
  order,
  canUpdate,
  hasFilters,
}: {
  rows: OrderListRow[];
  meta: PageMeta;
  sort: string;
  order: "asc" | "desc";
  canUpdate: boolean;
  hasFilters: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selection = useRowSelection(rows.map((row) => row.id));
  const columns = useColumnVisibility("orders", ORDER_COLUMNS);
  const { run, pending } = useActionToast();

  const bulk = async (op: BulkOrderOp): Promise<void> => {
    await run(() => bulkOrdersAction({ ids: selection.selectedIds, op }), { onSuccess: () => selection.clear() });
  };

  // Packing slips open in a printable view rather than downloading a file:
  // the sandboxed print sheet is what a warehouse actually uses.
  const printSlips = () => {
    const params = new URLSearchParams();
    for (const id of selection.selectedIds) params.append("ids", id);
    router.push(`/admin/orders/print?${params.toString()}` as Route);
  };

  const exportSelected = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.set("format", "csv");
    // A temporary anchor rather than a navigation: the API route streams a
    // file attachment, so the current page must stay where it is.
    const link = document.createElement("a");
    link.href = `/api/admin/orders/export?${params.toString()}`;
    link.rel = "noopener";
    link.click();
  };

  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState
          icon={ShoppingCart}
          title={hasFilters ? "No orders match these filters" : "No orders yet"}
          description={
            hasFilters
              ? "Try clearing the search, the date range or the status tab."
              : "Orders arrive from the storefront checkout, or you can key one by hand from the New order button."
          }
        />
      </div>
    );
  }

  const table = (
    <DataTable>
      <DataTableHead>
        {canUpdate ? (
          <Th width="2rem">
            <RowCheckbox {...selection.headerProps} label="Select all orders on this page" />
          </Th>
        ) : null}
        <SortableTh column="number" label="Order" currentSort={sort} currentOrder={order} defaultOrder="desc" />
        {columns.isVisible("placed") ? <SortableTh column="placed" label="Placed" currentSort={sort} currentOrder={order} /> : null}
        {columns.isVisible("customer") ? <SortableTh column="customer" label="Customer" currentSort={sort} currentOrder={order} defaultOrder="asc" /> : null}
        {columns.isVisible("items") ? <Th>Items</Th> : null}
        {columns.isVisible("sellers") ? <Th>Sellers</Th> : null}
        <SortableTh column="total" label="Total" currentSort={sort} currentOrder={order} align="right" />
        {columns.isVisible("payment") ? <SortableTh column="payment" label="Payment" currentSort={sort} currentOrder={order} /> : null}
        <SortableTh column="status" label="Status" currentSort={sort} currentOrder={order} />
        {columns.isVisible("shipping") ? <Th>Shipping</Th> : null}
        {columns.isVisible("source") ? <Th>Source</Th> : null}
        {columns.isVisible("updated") ? <SortableTh column="updated" label="Updated" currentSort={sort} currentOrder={order} /> : null}
        <Th width="3rem" align="right">
          <ColumnVisibilityMenu {...columns.menuProps} />
        </Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id} selected={selection.isSelected(row.id)}>
            {canUpdate ? (
              <Td>
                <RowCheckbox {...selection.rowProps(row.id)} label={`Select ${row.orderNumber}`} />
              </Td>
            ) : null}
            <Td>
              <Link href={orderHref(row.id)} className="font-mono text-xs font-semibold hover:underline">
                {row.orderNumber}
              </Link>
              {row.returnCount > 0 ? <span className="text-warning ml-1.5 text-[10px]">{row.returnCount} RMA</span> : null}
            </Td>
            {columns.isVisible("placed") ? <Td className="whitespace-nowrap text-xs">{formatIstDateTime(row.placedAt)}</Td> : null}
            {columns.isVisible("customer") ? (
              <Td className="max-w-56">
                <div className="flex flex-col">
                  <span className="line-clamp-1">
                    {row.customerName}
                    {row.isGuest ? <span className="text-muted-foreground ml-1.5 text-[10px] uppercase">guest</span> : null}
                  </span>
                  <span className="text-muted-foreground line-clamp-1 text-[11px]">{row.customerEmail || "—"}</span>
                </div>
              </Td>
            ) : null}
            {columns.isVisible("items") ? (
              <Td>
                <ItemThumbs row={row} />
              </Td>
            ) : null}
            {columns.isVisible("sellers") ? (
              <Td className="max-w-40">
                <span className="text-muted-foreground line-clamp-1 text-xs">{row.sellerNames.join(", ") || "—"}</span>
              </Td>
            ) : null}
            <Td numeric align="right">
              <div className="flex flex-col items-end">
                <span>{formatPaise(row.totalPaise)}</span>
                {row.refundedPaise > 0 ? <span className="text-muted-foreground text-[10px]">−{formatPaise(row.refundedPaise)}</span> : null}
              </div>
            </Td>
            {columns.isVisible("payment") ? (
              <Td>
                <StatusPill
                  label={`${PAYMENT_METHOD_META[row.paymentMethod as PaymentMethod]?.label ?? row.paymentMethod} · ${
                    PAYMENT_STATUS_META[row.paymentStatus as PaymentStatus]?.label ?? row.paymentStatus
                  }`}
                  tone={PAYMENT_STATUS_META[row.paymentStatus as PaymentStatus]?.tone ?? "neutral"}
                />
              </Td>
            ) : null}
            <Td>
              <StatusPill
                label={ORDER_STATUS_META[row.status as OrderStatus]?.label ?? row.status}
                tone={ORDER_STATUS_META[row.status as OrderStatus]?.tone ?? "neutral"}
              />
            </Td>
            {columns.isVisible("shipping") ? (
              <Td>
                <ShippingCell row={row} />
              </Td>
            ) : null}
            {columns.isVisible("source") ? (
              <Td className="text-muted-foreground text-xs">{ORDER_SOURCE_META[row.source as OrderSource]?.label ?? row.source}</Td>
            ) : null}
            {columns.isVisible("updated") ? <Td className="whitespace-nowrap text-xs">{formatIstDateTime(row.updatedAt)}</Td> : null}
            <Td align="right">
              <Link href={orderHref(row.id)} className="text-brand text-xs hover:underline">
                Open
              </Link>
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = (
    <div className="space-y-2">
      {rows.map((row) => (
        <MobileCard
          key={row.id}
          title={<span className="font-mono">{row.orderNumber}</span>}
          subtitle={`${row.customerName}${row.isGuest ? " (guest)" : ""}`}
          meta={
            <StatusPill
              label={ORDER_STATUS_META[row.status as OrderStatus]?.label ?? row.status}
              tone={ORDER_STATUS_META[row.status as OrderStatus]?.tone ?? "neutral"}
            />
          }
          href={orderHref(row.id)}
        >
          <MobileCardField label="Placed">{formatIstDateTime(row.placedAt)}</MobileCardField>
          <MobileCardField label="Total" numeric>
            {formatPaise(row.totalPaise)}
          </MobileCardField>
          <MobileCardField label="Payment">
            {PAYMENT_METHOD_META[row.paymentMethod as PaymentMethod]?.label ?? row.paymentMethod} ·{" "}
            {PAYMENT_STATUS_META[row.paymentStatus as PaymentStatus]?.label ?? row.paymentStatus}
          </MobileCardField>
          <MobileCardField label="Items" numeric>
            {row.itemCount}
          </MobileCardField>
          <MobileCardField label="Shipping">
            {row.shippingStatus ? SHIPMENT_STATUS_META[row.shippingStatus as ShipmentStatus]?.label ?? row.shippingStatus : "—"}
          </MobileCardField>
        </MobileCard>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      {canUpdate ? (
        <BulkActionBar
          count={selection.count}
          itemLabel="orders selected"
          onClear={selection.clear}
          actions={[
            { label: "Confirm", icon: CheckCircle2, onSelect: () => bulk("CONFIRM"), disabled: pending },
            { label: "Mark processing", icon: Package, onSelect: () => bulk("PROCESSING"), disabled: pending },
            { label: "Mark packed", icon: PackageCheck, onSelect: () => bulk("PACKED"), disabled: pending },
            { label: "Print packing slips", icon: Printer, onSelect: printSlips },
            { label: "Export", icon: Printer, onSelect: exportSelected },
          ]}
        />
      ) : null}
      <div className="surface overflow-hidden">
        <ResponsiveTable table={table} cards={cards} />
      </div>
      <p className="text-muted-foreground text-xs">
        Showing {meta.from}–{meta.to} of {meta.total}
      </p>
    </div>
  );
}
