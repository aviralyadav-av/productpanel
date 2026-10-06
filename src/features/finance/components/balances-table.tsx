"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileText, MoreHorizontal, RefreshCw, Timer } from "lucide-react";

import { PAYOUT_STATUS_META } from "@/lib/enums";
import { formatIstDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { markEarningsAvailableAction, recomputeBalanceAction } from "../actions";
import type { SellerBalanceRow } from "../payout-queries";
import { GenerateStatementDialog } from "./payout-dialogs";

/**
 * "Sellers with balances" (blueprint §14.B4-B5).
 *
 * The four money columns are the `SellerBalance` projection, so they are what
 * the next statement will actually pick up. A row that is "held" - owed money
 * but below the minimum payout - says so explicitly rather than offering a
 * Generate button that would silently do nothing.
 */
export function BalancesTable({
  rows,
  sort,
  order,
  minPayoutPaise,
  canApprove,
  canProcess,
}: {
  rows: SellerBalanceRow[];
  sort: string;
  order: "asc" | "desc";
  minPayoutPaise: number;
  canApprove: boolean;
  canProcess: boolean;
}) {
  const router = useRouter();
  const { run } = useActionToast();
  const [target, setTarget] = React.useState<SellerBalanceRow | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  function generate(row: SellerBalanceRow) {
    setTarget(row);
    setDialogOpen(true);
  }

  async function recompute(row: SellerBalanceRow) {
    await run(() => recomputeBalanceAction(row.sellerId), { onSuccess: () => router.refresh() });
  }

  const table = (
    <DataTable>
      <DataTableHead>
        <SortableTh column="seller" label="Seller" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="pending" label="Pending" currentSort={sort} currentOrder={order} align="right" />
        <SortableTh column="available" label="Available" currentSort={sort} currentOrder={order} align="right" />
        <SortableTh column="scheduled" label="Scheduled" currentSort={sort} currentOrder={order} align="right" />
        <SortableTh column="paid" label="Paid to date" currentSort={sort} currentOrder={order} align="right" />
        <Th>Last payout</Th>
        <Th>Open statement</Th>
        <Th width="3rem">
          <span className="sr-only">Actions</span>
        </Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.sellerId}>
            <Td>
              <Link href={row.sellerHref} className="block min-w-0 hover:underline">
                <span className="block truncate text-sm font-medium">{row.sellerName}</span>
                {row.hasBankAccount ? null : (
                  <span className="text-warning inline-flex items-center gap-1 text-[11px]">
                    <AlertTriangle className="size-3" />
                    No bank account
                  </span>
                )}
              </Link>
            </Td>
            <Td align="right" numeric className="text-xs">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1">
                    {row.pendingPaise > 0 ? <Timer className="text-muted-foreground size-3" /> : null}
                    {formatPaise(row.pendingPaise)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>Delivered but still inside the payout hold.</TooltipContent>
              </Tooltip>
            </Td>
            <Td align="right" numeric className="text-xs font-medium">
              {formatPaise(row.availablePaise)}
              {row.held ? (
                <span className="text-warning block text-[10px]">below {formatPaise(minPayoutPaise)}</span>
              ) : null}
            </Td>
            <Td align="right" numeric className="text-xs">
              {formatPaise(row.scheduledPaise)}
            </Td>
            <Td align="right" numeric className="text-xs">
              {formatPaise(row.paidPaise)}
            </Td>
            <Td className="text-xs">
              {row.lastPayoutAt ? (
                <>
                  <span className="block">{formatIstDate(new Date(row.lastPayoutAt))}</span>
                  <span className="text-muted-foreground block font-mono text-[11px]">
                    {row.lastPayoutNumber}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground/70">Never</span>
              )}
            </Td>
            <Td>
              {row.openPayout ? (
                <Link href={`/admin/payouts/${row.openPayout.id}`} className="hover:underline">
                  <span className="block font-mono text-[11px]">{row.openPayout.number}</span>
                  <StatusPill
                    label={PAYOUT_STATUS_META[row.openPayout.status].label}
                    tone={PAYOUT_STATUS_META[row.openPayout.status].tone}
                  />
                </Link>
              ) : (
                <span className="text-muted-foreground/70 text-xs">—</span>
              )}
            </Td>
            <Td align="right">
              <RowActions
                row={row}
                canApprove={canApprove}
                canProcess={canProcess}
                onGenerate={generate}
                onRecompute={recompute}
              />
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = rows.map((row) => (
    <MobileCard
      key={row.sellerId}
      title={row.sellerName}
      subtitle={row.openPayout ? `Open: ${row.openPayout.number}` : "No open statement"}
      meta={
        <RowActions
          row={row}
          canApprove={canApprove}
          canProcess={canProcess}
          onGenerate={generate}
          onRecompute={recompute}
        />
      }
    >
      <MobileCardField label="Pending" numeric>
        {formatPaise(row.pendingPaise)}
      </MobileCardField>
      <MobileCardField label="Available" numeric>
        {formatPaise(row.availablePaise)}
      </MobileCardField>
      <MobileCardField label="Scheduled" numeric>
        {formatPaise(row.scheduledPaise)}
      </MobileCardField>
      <MobileCardField label="Paid to date" numeric>
        {formatPaise(row.paidPaise)}
      </MobileCardField>
    </MobileCard>
  ));

  return (
    <>
      <ResponsiveTable table={table} cards={cards} />
      <GenerateStatementDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        seller={target ? { id: target.sellerId, name: target.sellerName } : null}
        availablePaise={target?.availablePaise ?? 0}
        minPayoutPaise={minPayoutPaise}
      />
    </>
  );
}

function RowActions({
  row,
  canApprove,
  canProcess,
  onGenerate,
  onRecompute,
}: {
  row: SellerBalanceRow;
  canApprove: boolean;
  canProcess: boolean;
  onGenerate: (row: SellerBalanceRow) => void;
  onRecompute: (row: SellerBalanceRow) => void;
}) {
  if (!canApprove && !canProcess) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.sellerName}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>{row.sellerName}</DropdownMenuLabel>
        {canApprove ? (
          <DropdownMenuItem
            // A second open statement is a 409; sending the operator to the
            // existing one is more useful than letting them find out.
            disabled={Boolean(row.openPayout)}
            onSelect={() => onGenerate(row)}
          >
            <FileText />
            {row.openPayout ? `${row.openPayout.number} is still open` : "Generate statement"}
          </DropdownMenuItem>
        ) : null}
        {canProcess ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onRecompute(row)}>
              <RefreshCw />
              Recompute balance
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Runs the `earnings.mark_available` job on demand. The job also runs on a
 * schedule; this is for the operator who has just resolved a return and wants
 * the held earnings released now rather than at the next tick.
 */
export function MarkAvailableButton() {
  const router = useRouter();
  const { pending, run } = useActionToast();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        void run(() => markEarningsAvailableAction(), { onSuccess: () => router.refresh() })
      }
    >
      <RefreshCw />
      Run mark-available
    </Button>
  );
}
