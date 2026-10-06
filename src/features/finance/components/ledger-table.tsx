"use client";

import * as React from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { ColumnVisibilityMenu, useColumnVisibility } from "@/components/shared/column-visibility";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import type { EntityRef } from "@/components/shared/entity-picker";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusPill } from "@/components/shared/status-badge";

import type { LedgerRow } from "../payout-queries";
import { LEDGER_TABLE_COLUMNS } from "../ui-schemas";
import { AdjustmentDialog } from "./payout-dialogs";

/**
 * The append-only seller ledger (blueprint §14.B4).
 *
 * Amounts are shown SIGNED, because the sign is the meaning: a positive row
 * credits the seller and a negative one debits them, and rendering commission
 * as a bare positive number is how a ledger stops reconciling.
 */
export function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  const columns = useColumnVisibility("ledger", [...LEDGER_TABLE_COLUMNS]);
  const show = columns.isVisible;

  const table = (
    <DataTable>
      <DataTableHead>
        <Th>Recorded</Th>
        <Th>Seller</Th>
        <Th>Type</Th>
        <Th align="right">Amount</Th>
        <Th>Status</Th>
        {show("availableAt") ? <Th>Available at</Th> : null}
        <Th>Description</Th>
        {show("order") ? <Th>Order</Th> : null}
        {show("item") ? <Th>Item</Th> : null}
        {show("statement") ? <Th>Statement</Th> : null}
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td numeric className="text-xs">
              {formatIstDate(new Date(row.createdAt))}
            </Td>
            <Td>
              <Link href={row.sellerHref} className="block max-w-[10rem] truncate text-xs hover:underline">
                {row.sellerName}
              </Link>
            </Td>
            <Td>
              <StatusPill label={row.typeLabel} tone={row.typeTone} />
            </Td>
            <Td align="right" numeric className="text-xs font-medium">
              <SignedAmount paise={row.amountPaise} />
            </Td>
            <Td>
              <StatusPill label={row.statusLabel} tone={row.statusTone} />
            </Td>
            {show("availableAt") ? (
              <Td numeric className="text-xs">
                {row.availableAt ? formatIstDate(new Date(row.availableAt)) : "—"}
              </Td>
            ) : null}
            <Td>
              <span className="block max-w-[22rem] truncate text-xs" title={row.description}>
                {row.description}
              </span>
            </Td>
            {show("order") ? (
              <Td>
                {row.orderHref && row.orderNumber ? (
                  <Link href={row.orderHref} className="font-mono text-[11px] hover:underline">
                    {row.orderNumber}
                  </Link>
                ) : (
                  <span className="text-muted-foreground/70 text-xs">—</span>
                )}
              </Td>
            ) : null}
            {show("item") ? (
              <Td>
                <span className="block max-w-[14rem] truncate text-xs">{row.itemTitle ?? "—"}</span>
              </Td>
            ) : null}
            {show("statement") ? (
              <Td>
                {row.payoutId && row.payoutNumber ? (
                  <Link href={`/admin/payouts/${row.payoutId}`} className="font-mono text-[11px] hover:underline">
                    {row.payoutNumber}
                  </Link>
                ) : (
                  <span className="text-muted-foreground/70 text-xs">—</span>
                )}
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
      title={row.sellerName}
      subtitle={formatIstDateTime(new Date(row.createdAt))}
      meta={<StatusPill label={row.typeLabel} tone={row.typeTone} />}
    >
      <MobileCardField label="Amount" numeric>
        <SignedAmount paise={row.amountPaise} />
      </MobileCardField>
      <MobileCardField label="Status">
        <StatusPill label={row.statusLabel} tone={row.statusTone} />
      </MobileCardField>
      <MobileCardField label="Description">{row.description}</MobileCardField>
      <MobileCardField label="Order">{row.orderNumber ?? "—"}</MobileCardField>
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

export function SignedAmount({ paise }: { paise: number }) {
  const negative = paise < 0;
  return (
    <span className={negative ? "text-destructive" : "text-success"}>
      {negative ? "−" : "+"}
      {formatPaise(Math.abs(paise))}
    </span>
  );
}

/** Toolbar button for the ledger tab (permission payouts.adjust). */
export function AdjustmentButton({ seller }: { seller?: EntityRef | null }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus />
        Manual adjustment
      </Button>
      <AdjustmentDialog open={open} onOpenChange={setOpen} initialSeller={seller} />
    </>
  );
}
