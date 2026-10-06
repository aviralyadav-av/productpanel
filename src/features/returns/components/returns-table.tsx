"use client";

import Link from "next/link";
import type { Route } from "next";
import { CheckCircle2, PackageX, ScanEye, ThumbsDown, XCircle } from "lucide-react";

import {
  RETURN_REASON_META,
  RETURN_REQUEST_STATUS_META,
  RETURN_RESOLUTION_META,
  type ReturnReason,
  type ReturnRequestStatus,
  type ReturnResolution,
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

import { bulkReturnsAction } from "../actions";
import { RETURN_COLUMNS, type ReturnBulkOp } from "../schemas";
import type { ReturnListRow } from "../types";

/**
 * The RMA worklist. The four things that decide what an operator does next -
 * what came back, why, what the customer asked for and where the RMA stands -
 * sit in fixed columns, so the screen can be scanned rather than read.
 */

function returnHref(id: string): Route {
  return `/admin/returns/${id}` as Route;
}

function ItemCell({ row }: { row: ReturnListRow }) {
  return (
    <div className="flex items-center gap-2">
      {row.itemImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- order snapshots store an absolute URL, not a Next image source.
        <img src={row.itemImageUrl} alt="" className="bg-muted size-7 rounded border object-cover" loading="lazy" />
      ) : (
        <span className="bg-muted text-muted-foreground flex size-7 items-center justify-center rounded border text-[9px]">
          {row.itemTitle.slice(0, 2).toUpperCase()}
        </span>
      )}
      <div className="flex min-w-0 flex-col">
        <span className="line-clamp-1">{row.itemTitle}</span>
        <span className="text-muted-foreground text-[11px]">
          {row.itemVariant ? `${row.itemVariant} · ` : ""}× {row.quantity}
        </span>
      </div>
    </div>
  );
}

function ResolutionCell({ row }: { row: ReturnListRow }) {
  const value = (row.resolution ?? row.requestedResolution) as ReturnResolution | null;
  if (!value) return <span className="text-muted-foreground">—</span>;
  const meta = RETURN_RESOLUTION_META[value];
  return (
    <div className="flex flex-col gap-0.5">
      <StatusPill label={meta?.label ?? value} tone={meta?.tone ?? "neutral"} />
      {!row.resolution ? <span className="text-muted-foreground text-[10px]">requested</span> : null}
    </div>
  );
}

export function ReturnsTable({
  rows,
  meta,
  sort,
  order,
  canManage,
  hasFilters,
}: {
  rows: ReturnListRow[];
  meta: PageMeta;
  sort: string;
  order: "asc" | "desc";
  canManage: boolean;
  hasFilters: boolean;
}) {
  const selection = useRowSelection(rows.map((row) => row.id));
  const columns = useColumnVisibility("returns", RETURN_COLUMNS);
  const { run, pending } = useActionToast();

  const bulk = async (op: ReturnBulkOp): Promise<void> => {
    const reason =
      op === "REJECT" ? window.prompt("Why are these returns being rejected? The customer sees this reason.")?.trim() : undefined;
    if (op === "REJECT" && !reason) return;
    await run(() => bulkReturnsAction({ ids: selection.selectedIds, op, reason }), { onSuccess: () => selection.clear() });
  };

  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState
          icon={PackageX}
          title={hasFilters ? "No returns match these filters" : "No return requests yet"}
          description={
            hasFilters
              ? "Try clearing the search, the date range or the status tab."
              : "Return requests arrive from the storefront once an order has been delivered."
          }
        />
      </div>
    );
  }

  const table = (
    <DataTable>
      <DataTableHead>
        {canManage ? (
          <Th width="2rem">
            <RowCheckbox {...selection.headerProps} label="Select all returns on this page" />
          </Th>
        ) : null}
        <SortableTh column="rma" label="RMA" currentSort={sort} currentOrder={order} defaultOrder="desc" />
        {columns.isVisible("order") ? <SortableTh column="order" label="Order" currentSort={sort} currentOrder={order} defaultOrder="desc" /> : null}
        {columns.isVisible("customer") ? <SortableTh column="customer" label="Customer" currentSort={sort} currentOrder={order} defaultOrder="asc" /> : null}
        <Th>Item</Th>
        {columns.isVisible("seller") ? <Th>Seller</Th> : null}
        {columns.isVisible("reason") ? <Th>Reason</Th> : null}
        {columns.isVisible("resolution") ? <Th>Resolution</Th> : null}
        <SortableTh column="status" label="Status" currentSort={sort} currentOrder={order} />
        {columns.isVisible("requested") ? <SortableTh column="requested" label="Requested" currentSort={sort} currentOrder={order} /> : null}
        {columns.isVisible("handled") ? <Th>Handled by</Th> : null}
        <Th width="3rem" align="right">
          <ColumnVisibilityMenu {...columns.menuProps} />
        </Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id} selected={selection.isSelected(row.id)}>
            {canManage ? (
              <Td>
                <RowCheckbox {...selection.rowProps(row.id)} label={`Select ${row.rmaNumber}`} />
              </Td>
            ) : null}
            <Td>
              <Link href={returnHref(row.id)} className="font-mono text-xs font-semibold hover:underline">
                {row.rmaNumber}
              </Link>
              {row.refundNumber ? (
                <span className="text-muted-foreground ml-1.5 text-[10px]">
                  {row.refundNumber} · {formatPaise(row.refundAmountPaise ?? 0)}
                </span>
              ) : null}
            </Td>
            {columns.isVisible("order") ? (
              <Td>
                <Link href={`/admin/orders/${row.orderId}` as Route} className="font-mono text-xs hover:underline">
                  {row.orderNumber}
                </Link>
              </Td>
            ) : null}
            {columns.isVisible("customer") ? (
              <Td className="max-w-48">
                <div className="flex flex-col">
                  <span className="line-clamp-1">{row.customerName}</span>
                  <span className="text-muted-foreground line-clamp-1 text-[11px]">{row.customerEmail || "—"}</span>
                </div>
              </Td>
            ) : null}
            <Td className="max-w-64">
              <ItemCell row={row} />
            </Td>
            {columns.isVisible("seller") ? <Td className="text-muted-foreground max-w-36 text-xs"><span className="line-clamp-1">{row.sellerName}</span></Td> : null}
            {columns.isVisible("reason") ? (
              <Td>
                <StatusPill
                  label={RETURN_REASON_META[row.reason as ReturnReason]?.label ?? row.reason}
                  tone={RETURN_REASON_META[row.reason as ReturnReason]?.tone ?? "neutral"}
                />
              </Td>
            ) : null}
            {columns.isVisible("resolution") ? (
              <Td>
                <ResolutionCell row={row} />
              </Td>
            ) : null}
            <Td>
              <StatusPill
                label={RETURN_REQUEST_STATUS_META[row.status as ReturnRequestStatus]?.label ?? row.status}
                tone={RETURN_REQUEST_STATUS_META[row.status as ReturnRequestStatus]?.tone ?? "neutral"}
              />
            </Td>
            {columns.isVisible("requested") ? <Td className="whitespace-nowrap text-xs">{formatIstDateTime(row.requestedAt)}</Td> : null}
            {columns.isVisible("handled") ? <Td className="text-muted-foreground text-xs">{row.handledBy ?? "—"}</Td> : null}
            <Td align="right">
              <Link href={returnHref(row.id)} className="text-brand text-xs hover:underline">
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
          title={<span className="font-mono">{row.rmaNumber}</span>}
          subtitle={row.itemTitle}
          meta={
            <StatusPill
              label={RETURN_REQUEST_STATUS_META[row.status as ReturnRequestStatus]?.label ?? row.status}
              tone={RETURN_REQUEST_STATUS_META[row.status as ReturnRequestStatus]?.tone ?? "neutral"}
            />
          }
          href={returnHref(row.id)}
        >
          <MobileCardField label="Order">{row.orderNumber}</MobileCardField>
          <MobileCardField label="Customer">{row.customerName}</MobileCardField>
          <MobileCardField label="Reason">{RETURN_REASON_META[row.reason as ReturnReason]?.label ?? row.reason}</MobileCardField>
          <MobileCardField label="Units" numeric>
            {row.quantity}
          </MobileCardField>
          <MobileCardField label="Requested">{formatIstDateTime(row.requestedAt)}</MobileCardField>
        </MobileCard>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      {canManage ? (
        <BulkActionBar
          count={selection.count}
          itemLabel="returns selected"
          onClear={selection.clear}
          actions={[
            { label: "Move to review", icon: ScanEye, onSelect: () => bulk("REVIEW"), disabled: pending },
            { label: "Approve", icon: CheckCircle2, onSelect: () => bulk("APPROVE"), disabled: pending },
            { label: "Reject", icon: ThumbsDown, onSelect: () => bulk("REJECT"), disabled: pending },
            { label: "Close", icon: XCircle, onSelect: () => bulk("CLOSE"), disabled: pending },
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
