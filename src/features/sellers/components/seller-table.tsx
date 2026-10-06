"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, MoreHorizontal, RotateCcw, Search, ShieldCheck, XCircle } from "lucide-react";

import { SELLER_STATUS_META, type SellerStatus } from "@/lib/enums";
import { formatIstDate } from "@/lib/dates";
import { formatNumber, formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BulkActionBar, type BulkAction } from "@/components/shared/bulk-action-bar";
import { ColumnVisibilityMenu, useColumnVisibility } from "@/components/shared/column-visibility";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { usePermission } from "@/components/shared/permission-gate";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { RowCheckbox, useRowSelection } from "@/components/shared/row-selection";
import { SortableTh } from "@/components/shared/sortable-th";
import { useActionToast } from "@/components/shared/use-action-toast";

import { bulkSellerStatusAction, transitionSellerAction } from "@/features/sellers/actions";
import { DocsProgress, RatingText, SellerStatusBadge } from "@/features/sellers/components/badges";
import { SellerAvatar } from "@/features/sellers/components/seller-avatar";
import {
  SELLER_COLUMNS,
  nextSellerStatuses,
  permissionForTransition,
  transitionLabel,
  transitionNeedsReason,
  type BulkSellerStatus,
} from "@/features/sellers/schemas";
import type { SellerListRow } from "@/features/sellers/types";

/**
 * The seller list body (brief §6). A Client Component because three things
 * genuinely live in the browser: which columns are hidden, which rows are
 * ticked, and the confirm dialog for a row action. Sorting, filtering and
 * paging stay in the URL (SortableTh, the page's FilterTabs).
 */

const BULK_LABEL: Record<BulkSellerStatus, string> = {
  UNDER_REVIEW: "Move to review",
  APPROVED: "Approve",
  REJECTED: "Reject",
  SUSPENDED: "Suspend",
  ACTIVE: "Activate / reinstate",
};

export function SellerTable({
  rows,
  sort,
  order,
}: {
  rows: SellerListRow[];
  sort: string;
  order: "asc" | "desc";
}) {
  const router = useRouter();
  const columns = useColumnVisibility("sellers", [...SELLER_COLUMNS]);
  const selection = useRowSelection(rows.map((row) => row.id));
  const [confirm, confirmDialog] = useConfirm();
  const { run } = useActionToast();
  const canApprove = usePermission("sellers.approve");
  const canSuspend = usePermission("sellers.suspend");
  const show = columns.isVisible;

  async function transition(row: SellerListRow, toStatus: SellerStatus) {
    const needsReason = transitionNeedsReason(toStatus);
    const label = transitionLabel(row.status, toStatus);
    const result = await confirm({
      title: `${label} "${row.displayName}"?`,
      description: SELLER_STATUS_META[toStatus].description,
      confirmLabel: label,
      destructive: toStatus === "SUSPENDED" || toStatus === "REJECTED",
      requireReason: needsReason ? { label: "Reason (sent to the seller for rejections)", placeholder: "Why?" } : undefined,
    });
    if (!result.ok) return;
    await run(() => transitionSellerAction({ id: row.id, toStatus, reason: result.reason }), {
      onSuccess: () => router.refresh(),
    });
  }

  async function bulk(toStatus: BulkSellerStatus) {
    const ids = [...selection.selectedIds];
    const result = await confirm({
      title: `${BULK_LABEL[toStatus]} ${ids.length} seller${ids.length === 1 ? "" : "s"}?`,
      description: "Sellers that cannot legally make this move are skipped and reported.",
      confirmLabel: BULK_LABEL[toStatus],
      destructive: toStatus === "SUSPENDED" || toStatus === "REJECTED",
      requireReason: transitionNeedsReason(toStatus) ? { label: "Reason (recorded on every seller)" } : undefined,
    });
    if (!result.ok) return;
    await run(() => bulkSellerStatusAction({ ids, toStatus, reason: result.reason }), {
      onSuccess: () => {
        selection.clear();
        router.refresh();
      },
    });
  }

  const bulkActions: BulkAction[] = [
    { label: "Move to review", icon: Search, onSelect: () => bulk("UNDER_REVIEW"), permission: "sellers.approve" },
    { label: "Approve", icon: CheckCircle2, onSelect: () => bulk("APPROVED"), permission: "sellers.approve" },
    { label: "Activate", icon: ShieldCheck, onSelect: () => bulk("ACTIVE"), permission: "sellers.approve" },
    { label: "Reject", icon: XCircle, onSelect: () => bulk("REJECTED"), destructive: true, permission: "sellers.approve" },
    { label: "Suspend", icon: Ban, onSelect: () => bulk("SUSPENDED"), destructive: true, permission: "sellers.suspend" },
  ];
  const grantedBulk = new Set<string>([...(canApprove ? ["sellers.approve"] : []), ...(canSuspend ? ["sellers.suspend"] : [])]);

  const table = (
    <DataTable>
      <DataTableHead>
        <Th width="2rem">
          <RowCheckbox {...selection.headerProps} label="Select all sellers on this page" />
        </Th>
        <SortableTh column="name" label="Seller" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        {show("business") ? <Th>Business</Th> : null}
        {show("email") ? <Th>Email</Th> : null}
        {show("phone") ? <Th>Phone</Th> : null}
        {show("location") ? <Th>Location</Th> : null}
        {show("registered") ? <SortableTh column="registered" label="Registered" currentSort={sort} currentOrder={order} /> : null}
        <SortableTh column="status" label="Status" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        {show("products") ? <SortableTh column="products" label="Products" currentSort={sort} currentOrder={order} align="right" /> : null}
        {show("orders") ? <SortableTh column="orders" label="Orders" currentSort={sort} currentOrder={order} align="right" /> : null}
        {show("revenue") ? <SortableTh column="grossSales" label="Revenue" currentSort={sort} currentOrder={order} align="right" /> : null}
        {show("rating") ? <SortableTh column="rating" label="Rating" currentSort={sort} currentOrder={order} align="right" /> : null}
        {show("commission") ? <Th align="right">Commission</Th> : null}
        {show("payout") ? <Th align="right">Payout</Th> : null}
        <Th width="3rem">
          <span className="sr-only">Actions</span>
        </Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id} selected={selection.isSelected(row.id)}>
            <Td>
              <RowCheckbox {...selection.rowProps(row.id)} label={`Select ${row.displayName}`} />
            </Td>
            <Td>
              <Link href={`/admin/sellers/${row.id}` as Route} className="flex items-center gap-2.5 hover:underline">
                <SellerAvatar name={row.displayName} src={row.logoUrl} size={28} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{row.displayName}</span>
                  <span className="text-muted-foreground block truncate font-mono text-[11px]">/{row.slug}</span>
                </span>
              </Link>
            </Td>
            {show("business") ? (
              <Td>
                <span className="block max-w-[14rem] truncate text-xs">{row.legalName ?? <span className="text-muted-foreground/70">—</span>}</span>
                {row.gstinMasked ? <span className="text-muted-foreground block font-mono text-[11px]">{row.gstinMasked}</span> : null}
              </Td>
            ) : null}
            {show("email") ? (
              <Td>
                <span className="block max-w-[14rem] truncate text-xs">{row.email}</span>
              </Td>
            ) : null}
            {show("phone") ? <Td numeric className="text-xs">{row.phone ?? "—"}</Td> : null}
            {show("location") ? (
              <Td className="text-xs">{[row.city, row.state].filter(Boolean).join(", ") || "—"}</Td>
            ) : null}
            {show("registered") ? <Td numeric className="text-xs">{formatIstDate(new Date(row.registeredAt))}</Td> : null}
            <Td>
              <div className="flex flex-col items-start gap-0.5">
                <SellerStatusBadge status={row.status} />
                <DocsProgress {...row.documents} />
              </div>
            </Td>
            {show("products") ? (
              <Td align="right" numeric className="text-xs">
                {formatNumber(row.publishedProductCount)}
                <span className="text-muted-foreground">/{formatNumber(row.productCount)}</span>
              </Td>
            ) : null}
            {show("orders") ? <Td align="right" numeric className="text-xs">{formatNumber(row.orderCount)}</Td> : null}
            {show("revenue") ? <Td align="right" numeric className="text-xs">{formatPaise(row.grossSalesPaise)}</Td> : null}
            {show("rating") ? (
              <Td align="right" className="text-xs">
                <RatingText avg={row.ratingAvg} count={row.reviewCount} />
              </Td>
            ) : null}
            {show("commission") ? (
              <Td align="right" numeric className="text-xs">
                {(row.commission.rateBps / 100).toFixed(row.commission.rateBps % 100 === 0 ? 0 : 2)}%
                <span className="text-muted-foreground ml-1 text-[10px] uppercase">{row.commission.scope === "SELLER" ? "override" : "global"}</span>
              </Td>
            ) : null}
            {show("payout") ? (
              <Td align="right" className="text-xs">
                <PayoutCell payout={row.payout} />
              </Td>
            ) : null}
            <Td align="right">
              <RowActions row={row} canApprove={canApprove} canSuspend={canSuspend} onTransition={transition} />
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = rows.map((row) => (
    <MobileCard
      key={row.id}
      href={`/admin/sellers/${row.id}`}
      title={row.displayName}
      subtitle={[row.city, row.state].filter(Boolean).join(", ") || row.email}
      meta={<SellerStatusBadge status={row.status} />}
    >
      <MobileCardField label="Products" numeric>
        {formatNumber(row.productCount)}
      </MobileCardField>
      <MobileCardField label="Revenue" numeric>
        {formatPaise(row.grossSalesPaise)}
      </MobileCardField>
      <MobileCardField label="Documents">
        <DocsProgress {...row.documents} />
      </MobileCardField>
      <MobileCardField label="Rating">
        <RatingText avg={row.ratingAvg} count={row.reviewCount} />
      </MobileCardField>
    </MobileCard>
  ));

  return (
    <>
      <div className="flex items-center justify-end border-b px-4 py-1.5">
        <ColumnVisibilityMenu {...columns.menuProps} />
      </div>
      <ResponsiveTable table={table} cards={cards} />
      <BulkActionBar count={selection.count} actions={bulkActions} onClear={selection.clear} permissions={grantedBulk} itemLabel="sellers selected" />
      {confirmDialog}
    </>
  );
}

function PayoutCell({ payout }: { payout: SellerListRow["payout"] }) {
  if (payout.openPayout) {
    return (
      <Link href={`/admin/payouts/${payout.openPayout.id}` as Route} className="hover:underline">
        <span className="block font-mono text-[11px]">{payout.openPayout.number}</span>
        <span className="text-muted-foreground block text-[11px]">
          {payout.openPayout.status.toLowerCase()} · {formatPaise(payout.openPayout.netPaise)}
        </span>
      </Link>
    );
  }
  if (payout.availablePaise > 0) {
    return (
      <span data-numeric>
        {formatPaise(payout.availablePaise)}
        <span className="text-muted-foreground block text-[11px]">available</span>
      </span>
    );
  }
  if (payout.pendingPaise > 0) {
    return (
      <span data-numeric className="text-muted-foreground">
        {formatPaise(payout.pendingPaise)}
        <span className="block text-[11px]">on hold</span>
      </span>
    );
  }
  return <span className="text-muted-foreground/70">—</span>;
}

function RowActions({
  row,
  canApprove,
  canSuspend,
  onTransition,
}: {
  row: SellerListRow;
  canApprove: boolean;
  canSuspend: boolean;
  onTransition: (row: SellerListRow, to: SellerStatus) => Promise<void>;
}) {
  const targets = nextSellerStatuses(row.status).filter((to) => {
    const permission = permissionForTransition(row.status, to);
    return permission === "sellers.suspend" ? canSuspend : canApprove;
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.displayName}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="truncate text-xs">{row.displayName}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href={`/admin/sellers/${row.id}` as Route}>Open profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/admin/sellers/${row.id}?tab=documents` as Route}>Review documents</Link>
        </DropdownMenuItem>
        {targets.length > 0 ? <DropdownMenuSeparator /> : null}
        {targets.map((to) => (
          <DropdownMenuItem
            key={to}
            variant={to === "SUSPENDED" || to === "REJECTED" ? "destructive" : "default"}
            onSelect={() => void onTransition(row, to)}
          >
            {to === "ACTIVE" && row.status === "SUSPENDED" ? <RotateCcw /> : null}
            {transitionLabel(row.status, to)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
