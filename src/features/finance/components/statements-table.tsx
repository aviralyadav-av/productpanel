"use client";

import Link from "next/link";

import { PAYOUT_METHOD_META, PAYOUT_STATUS_META } from "@/lib/enums";
import { formatIstDate } from "@/lib/dates";
import { formatNumber, formatPaise } from "@/lib/money";
import { ColumnVisibilityMenu, useColumnVisibility } from "@/components/shared/column-visibility";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";

import type { PayoutListRow } from "../payout-queries";
import { PAYOUT_TABLE_COLUMNS } from "../ui-schemas";

/**
 * The statements list (blueprint §14.B5). Every money column is shown because
 * reconciling a statement means reading the identity across it -
 * `net = gross − commission − charges − refunds + adjustments` - and hiding a
 * term by default would break that reading; the column menu lets an operator
 * who only wants the net collapse the rest.
 */
export function StatementsTable({
  rows,
  sort,
  order,
}: {
  rows: PayoutListRow[];
  sort: string;
  order: "asc" | "desc";
}) {
  const columns = useColumnVisibility("payouts", [...PAYOUT_TABLE_COLUMNS]);
  const show = columns.isVisible;

  const table = (
    <DataTable>
      <DataTableHead>
        <SortableTh column="payoutNumber" label="Statement" currentSort={sort} currentOrder={order} defaultOrder="desc" />
        <SortableTh column="seller" label="Seller" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="periodTo" label="Period" currentSort={sort} currentOrder={order} />
        {show("gross") ? <Th align="right">Gross</Th> : null}
        {show("commission") ? <Th align="right">Commission</Th> : null}
        {show("charges") ? <Th align="right">Charges</Th> : null}
        {show("refunds") ? <Th align="right">Refunds</Th> : null}
        {show("adjustments") ? <Th align="right">Adjustments</Th> : null}
        <SortableTh column="netPaise" label="Net" currentSort={sort} currentOrder={order} align="right" />
        <Th>Status</Th>
        {show("method") ? <Th>Method</Th> : null}
        {show("reference") ? <Th>Reference</Th> : null}
        {show("entries") ? <Th align="right">Entries</Th> : null}
        <SortableTh column="createdAt" label="Created" currentSort={sort} currentOrder={order} align="right" />
        {show("paidAt") ? (
          <SortableTh column="paidAt" label="Paid" currentSort={sort} currentOrder={order} align="right" />
        ) : null}
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td>
              <Link href={`/admin/payouts/${row.id}`} className="font-mono text-xs hover:underline">
                {row.payoutNumber}
              </Link>
            </Td>
            <Td>
              <Link href={row.sellerHref} className="block max-w-[12rem] truncate text-sm hover:underline">
                {row.sellerName}
              </Link>
            </Td>
            <Td className="text-xs">
              {formatIstDate(new Date(row.periodFrom))} – {formatIstDate(new Date(row.periodTo))}
            </Td>
            {show("gross") ? (
              <Td align="right" numeric className="text-xs">
                {formatPaise(row.grossSalesPaise)}
              </Td>
            ) : null}
            {show("commission") ? (
              <Td align="right" numeric className="text-xs">
                −{formatPaise(row.commissionPaise)}
              </Td>
            ) : null}
            {show("charges") ? (
              <Td align="right" numeric className="text-xs">
                −{formatPaise(row.chargesPaise)}
              </Td>
            ) : null}
            {show("refunds") ? (
              <Td align="right" numeric className="text-xs">
                −{formatPaise(row.refundsPaise)}
              </Td>
            ) : null}
            {show("adjustments") ? (
              <Td align="right" numeric className="text-xs">
                {formatPaise(row.adjustmentsPaise)}
              </Td>
            ) : null}
            <Td align="right" numeric className="text-xs font-semibold">
              {formatPaise(row.netPaise)}
            </Td>
            <Td>
              <StatusPill
                label={PAYOUT_STATUS_META[row.status].label}
                tone={PAYOUT_STATUS_META[row.status].tone}
              />
            </Td>
            {show("method") ? <Td className="text-xs">{PAYOUT_METHOD_META[row.method].label}</Td> : null}
            {show("reference") ? (
              <Td className="font-mono text-[11px]">
                {row.referenceNumber ?? <span className="text-muted-foreground/70">—</span>}
              </Td>
            ) : null}
            {show("entries") ? (
              <Td align="right" numeric className="text-xs">
                {formatNumber(row.entryCount)}
              </Td>
            ) : null}
            <Td align="right" numeric className="text-xs">
              {formatIstDate(new Date(row.createdAt))}
            </Td>
            {show("paidAt") ? (
              <Td align="right" numeric className="text-xs">
                {row.paidAt ? formatIstDate(new Date(row.paidAt)) : "—"}
              </Td>
            ) : null}
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = rows.map((row) => (
    <MobileCard
      key={row.id}
      href={`/admin/payouts/${row.id}`}
      title={row.payoutNumber}
      subtitle={row.sellerName}
      meta={<StatusPill label={PAYOUT_STATUS_META[row.status].label} tone={PAYOUT_STATUS_META[row.status].tone} />}
    >
      <MobileCardField label="Net" numeric>
        {formatPaise(row.netPaise)}
      </MobileCardField>
      <MobileCardField label="Commission" numeric>
        {formatPaise(row.commissionPaise)}
      </MobileCardField>
      <MobileCardField label="Period">
        {formatIstDate(new Date(row.periodFrom))} – {formatIstDate(new Date(row.periodTo))}
      </MobileCardField>
      <MobileCardField label="Entries" numeric>
        {formatNumber(row.entryCount)}
      </MobileCardField>
    </MobileCard>
  ));

  return (
    <>
      <div className="flex items-center justify-end border-b px-4 py-1.5">
        <ColumnVisibilityMenu {...columns.menuProps} />
      </div>
      <ResponsiveTable table={table} cards={cards} />
    </>
  );
}
