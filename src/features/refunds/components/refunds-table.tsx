"use client";

import Link from "next/link";
import type { Route } from "next";
import { Banknote } from "lucide-react";

import {
  PAYMENT_PROVIDER_META,
  REFUND_METHOD_META,
  REFUND_STATUS_META,
  type PaymentProviderCode,
  type RefundMethod,
  type RefundStatus,
} from "@/lib/enums";
import { formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import type { PageMeta } from "@/lib/list-params";
import { ColumnVisibilityMenu, useColumnVisibility } from "@/components/shared/column-visibility";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";

import { REFUND_COLUMNS } from "../schemas";
import type { RefundListRow } from "../types";

/** The refund ledger as an operator reads it: what, to whom, by which rail. */
export function RefundsTable({
  rows,
  meta,
  sort,
  order,
  hasFilters,
}: {
  rows: RefundListRow[];
  meta: PageMeta;
  sort: string;
  order: "asc" | "desc";
  hasFilters: boolean;
}) {
  const columns = useColumnVisibility("refunds", REFUND_COLUMNS);

  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState
          icon={Banknote}
          title={hasFilters ? "No refunds match these filters" : "No refunds yet"}
          description={
            hasFilters
              ? "Try clearing the search, the date range or the status tab."
              : "Refunds are created from a return, from a cancellation, or by hand from an order."
          }
        />
      </div>
    );
  }

  const table = (
    <DataTable>
      <DataTableHead>
        <SortableTh column="number" label="Refund" currentSort={sort} currentOrder={order} defaultOrder="desc" />
        {columns.isVisible("order") ? <SortableTh column="order" label="Order" currentSort={sort} currentOrder={order} defaultOrder="desc" /> : null}
        {columns.isVisible("customer") ? <Th>Customer</Th> : null}
        <SortableTh column="amount" label="Amount" currentSort={sort} currentOrder={order} align="right" />
        {columns.isVisible("method") ? <Th>Method</Th> : null}
        {columns.isVisible("provider") ? <Th>Provider</Th> : null}
        <SortableTh column="status" label="Status" currentSort={sort} currentOrder={order} />
        {columns.isVisible("return") ? <Th>Return</Th> : null}
        {columns.isVisible("created") ? <SortableTh column="created" label="Created" currentSort={sort} currentOrder={order} /> : null}
        {columns.isVisible("completed") ? <SortableTh column="completed" label="Completed" currentSort={sort} currentOrder={order} /> : null}
        <Th width="3rem" align="right">
          <ColumnVisibilityMenu {...columns.menuProps} />
        </Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td>
              <Link href={`/admin/refunds/${row.id}` as Route} className="font-mono text-xs font-semibold hover:underline">
                {row.refundNumber}
              </Link>
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
            <Td numeric align="right">
              {formatPaise(row.amountPaise)}
            </Td>
            {columns.isVisible("method") ? (
              <Td className="text-xs">{REFUND_METHOD_META[row.method as RefundMethod]?.label ?? row.method}</Td>
            ) : null}
            {columns.isVisible("provider") ? (
              <Td className="text-muted-foreground text-xs">
                {row.provider ? PAYMENT_PROVIDER_META[row.provider as PaymentProviderCode]?.label ?? row.provider : "—"}
              </Td>
            ) : null}
            <Td>
              <StatusPill
                label={REFUND_STATUS_META[row.status as RefundStatus]?.label ?? row.status}
                tone={REFUND_STATUS_META[row.status as RefundStatus]?.tone ?? "neutral"}
              />
            </Td>
            {columns.isVisible("return") ? (
              <Td>
                {row.returnRequestId ? (
                  <Link href={`/admin/returns/${row.returnRequestId}` as Route} className="font-mono text-xs hover:underline">
                    {row.rmaNumber}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Td>
            ) : null}
            {columns.isVisible("created") ? <Td className="whitespace-nowrap text-xs">{formatIstDateTime(row.createdAt)}</Td> : null}
            {columns.isVisible("completed") ? (
              <Td className="whitespace-nowrap text-xs">{row.completedAt ? formatIstDateTime(row.completedAt) : "—"}</Td>
            ) : null}
            <Td align="right">
              <Link href={`/admin/refunds/${row.id}` as Route} className="text-brand text-xs hover:underline">
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
          title={<span className="font-mono">{row.refundNumber}</span>}
          subtitle={row.customerName}
          meta={
            <StatusPill
              label={REFUND_STATUS_META[row.status as RefundStatus]?.label ?? row.status}
              tone={REFUND_STATUS_META[row.status as RefundStatus]?.tone ?? "neutral"}
            />
          }
          href={`/admin/refunds/${row.id}` as Route}
        >
          <MobileCardField label="Order">{row.orderNumber}</MobileCardField>
          <MobileCardField label="Amount" numeric>
            {formatPaise(row.amountPaise)}
          </MobileCardField>
          <MobileCardField label="Method">{REFUND_METHOD_META[row.method as RefundMethod]?.label ?? row.method}</MobileCardField>
          <MobileCardField label="Created">{formatIstDateTime(row.createdAt)}</MobileCardField>
        </MobileCard>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="surface overflow-hidden">
        <ResponsiveTable table={table} cards={cards} />
      </div>
      <p className="text-muted-foreground text-xs">
        Showing {meta.from}–{meta.to} of {meta.total}
      </p>
    </div>
  );
}
