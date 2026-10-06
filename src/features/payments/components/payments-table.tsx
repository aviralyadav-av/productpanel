"use client";

import Link from "next/link";
import type { Route } from "next";
import { CreditCard } from "lucide-react";

import {
  PAYMENT_INSTRUMENT_META,
  PAYMENT_PROVIDER_META,
  PAYMENT_TRANSACTION_STATUS_META,
  PAYMENT_TYPE_META,
  type PaymentInstrument,
  type PaymentProviderCode,
  type PaymentTransactionStatus,
  type PaymentType,
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

import { PAYMENT_COLUMNS } from "../schemas";
import type { PaymentListRow } from "../types";

/**
 * The transaction ledger. Charges and refunds share one table on purpose:
 * reconciling a gateway statement means looking at both legs together, and a
 * refund is shown as a negative amount so a column of figures adds up.
 */
export function PaymentsTable({
  rows,
  meta,
  sort,
  order,
  hasFilters,
}: {
  rows: PaymentListRow[];
  meta: PageMeta;
  sort: string;
  order: "asc" | "desc";
  hasFilters: boolean;
}) {
  const columns = useColumnVisibility("payments", PAYMENT_COLUMNS);

  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState
          icon={CreditCard}
          title={hasFilters ? "No transactions match these filters" : "No payments recorded yet"}
          description={
            hasFilters
              ? "Try clearing the search, the date range or the status filter."
              : "Transactions appear here as the checkout, the gateway webhooks and the refunds service record them."
          }
        />
      </div>
    );
  }

  const amount = (row: PaymentListRow) => (row.type === "REFUND" ? `−${formatPaise(row.amountPaise)}` : formatPaise(row.amountPaise));

  const table = (
    <DataTable>
      <DataTableHead>
        <Th>Transaction</Th>
        {columns.isVisible("order") ? <SortableTh column="order" label="Order" currentSort={sort} currentOrder={order} defaultOrder="desc" /> : null}
        {columns.isVisible("customer") ? <Th>Customer</Th> : null}
        <SortableTh column="amount" label="Amount" currentSort={sort} currentOrder={order} align="right" />
        {columns.isVisible("provider") ? <SortableTh column="provider" label="Gateway" currentSort={sort} currentOrder={order} defaultOrder="asc" /> : null}
        {columns.isVisible("method") ? <Th>Method</Th> : null}
        {columns.isVisible("type") ? <SortableTh column="type" label="Type" currentSort={sort} currentOrder={order} defaultOrder="asc" /> : null}
        <SortableTh column="status" label="Status" currentSort={sort} currentOrder={order} />
        {columns.isVisible("created") ? <SortableTh column="created" label="Date" currentSort={sort} currentOrder={order} /> : null}
        <Th width="3rem" align="right">
          <ColumnVisibilityMenu {...columns.menuProps} />
        </Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td className="max-w-56">
              <Link href={`/admin/payments/${row.id}` as Route} className="font-mono text-xs hover:underline">
                {row.providerPaymentId ?? row.id.slice(0, 12)}
              </Link>
              {row.refundNumber ? <span className="text-muted-foreground ml-1.5 text-[10px]">{row.refundNumber}</span> : null}
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
              {amount(row)}
            </Td>
            {columns.isVisible("provider") ? (
              <Td className="text-xs">{PAYMENT_PROVIDER_META[row.provider as PaymentProviderCode]?.label ?? row.provider}</Td>
            ) : null}
            {columns.isVisible("method") ? (
              <Td className="text-muted-foreground text-xs">
                {PAYMENT_INSTRUMENT_META[row.method as PaymentInstrument]?.label ?? row.method}
              </Td>
            ) : null}
            {columns.isVisible("type") ? (
              <Td>
                <StatusPill
                  label={PAYMENT_TYPE_META[row.type as PaymentType]?.label ?? row.type}
                  tone={PAYMENT_TYPE_META[row.type as PaymentType]?.tone ?? "neutral"}
                  dot={false}
                />
              </Td>
            ) : null}
            <Td>
              <StatusPill
                label={PAYMENT_TRANSACTION_STATUS_META[row.status as PaymentTransactionStatus]?.label ?? row.status}
                tone={PAYMENT_TRANSACTION_STATUS_META[row.status as PaymentTransactionStatus]?.tone ?? "neutral"}
              />
            </Td>
            {columns.isVisible("created") ? <Td className="whitespace-nowrap text-xs">{formatIstDateTime(row.createdAt)}</Td> : null}
            <Td align="right">
              <Link href={`/admin/payments/${row.id}` as Route} className="text-brand text-xs hover:underline">
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
          title={<span className="font-mono">{row.providerPaymentId ?? row.id.slice(0, 12)}</span>}
          subtitle={`${row.orderNumber} · ${row.customerName}`}
          meta={
            <StatusPill
              label={PAYMENT_TRANSACTION_STATUS_META[row.status as PaymentTransactionStatus]?.label ?? row.status}
              tone={PAYMENT_TRANSACTION_STATUS_META[row.status as PaymentTransactionStatus]?.tone ?? "neutral"}
            />
          }
          href={`/admin/payments/${row.id}` as Route}
        >
          <MobileCardField label="Amount" numeric>
            {amount(row)}
          </MobileCardField>
          <MobileCardField label="Gateway">{PAYMENT_PROVIDER_META[row.provider as PaymentProviderCode]?.label ?? row.provider}</MobileCardField>
          <MobileCardField label="Type">{PAYMENT_TYPE_META[row.type as PaymentType]?.label ?? row.type}</MobileCardField>
          <MobileCardField label="Date">{formatIstDateTime(row.createdAt)}</MobileCardField>
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
