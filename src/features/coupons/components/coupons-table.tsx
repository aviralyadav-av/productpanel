"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Copy, Eye, EyeOff, MoreHorizontal, Pencil, Power, PowerOff, Ticket, Trash2 } from "lucide-react";

import { COUPON_STATUS_META, COUPON_TYPE_META } from "@/lib/enums";
import { formatIstDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { BulkActionBar } from "@/components/shared/bulk-action-bar";
import { ColumnVisibilityMenu, useColumnVisibility, type ColumnDef } from "@/components/shared/column-visibility";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { CopyButton } from "@/components/shared/copy-button";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { RowCheckbox, useRowSelection } from "@/components/shared/row-selection";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import type { PageMeta } from "@/lib/list-params";

import { bulkCouponsAction, deleteCouponAction, duplicateCouponAction, toggleCouponAction } from "../actions";
import { formatIstWindow } from "../dates";
import type { CouponBulkOp, CouponRow } from "../schemas";
import { describeDiscount } from "../summary";

const COLUMNS: ColumnDef[] = [
  { key: "code", label: "Code", locked: true },
  { key: "name", label: "Name" },
  { key: "discount", label: "Discount" },
  { key: "scope", label: "Scope" },
  { key: "usage", label: "Usage" },
  { key: "window", label: "Window" },
  { key: "status", label: "Status", locked: true },
  { key: "fundedBy", label: "Funded by" },
  { key: "visibility", label: "Visibility", defaultHidden: true },
  { key: "updatedAt", label: "Updated", defaultHidden: true },
];

function couponHref(id: string): Route {
  return `/admin/coupons/${id}` as Route;
}

function UsageCell({ row }: { row: CouponRow }) {
  if (row.usageLimit === null) {
    return <span className="tabular-nums">{row.usageCount} used</span>;
  }
  const percent = Math.min(100, Math.round((row.usageCount / row.usageLimit) * 100));
  return (
    <div className="min-w-24 space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
        <span>
          {row.usageCount} / {row.usageLimit}
        </span>
        <span className="text-muted-foreground">{percent}%</span>
      </div>
      <Progress value={percent} className="h-1.5" aria-label={`${percent}% of usage limit`} />
    </div>
  );
}

export function CouponsTable({
  rows,
  meta,
  sort,
  order,
  canManage,
  hasFilters,
}: {
  rows: CouponRow[];
  meta: PageMeta;
  sort: string;
  order: "asc" | "desc";
  canManage: boolean;
  hasFilters: boolean;
}) {
  const router = useRouter();
  const selection = useRowSelection(rows.map((row) => row.id));
  const columns = useColumnVisibility("coupons", COLUMNS);
  const [confirm, confirmDialog] = useConfirm();
  const { run, pending } = useActionToast();

  const toggle = (row: CouponRow) => run(() => toggleCouponAction(row.id, !row.isActive));

  const duplicate = (row: CouponRow) =>
    run(() => duplicateCouponAction(row.id), {
      onSuccess: (data) => router.push(couponHref(data.id)),
    });

  const remove = async (row: CouponRow) => {
    const result = await confirm({
      title: `Delete ${row.code}?`,
      description:
        row.usageCount > 0
          ? `This coupon has ${row.usageCount} redemption${row.usageCount === 1 ? "" : "s"}. It will be archived so order history keeps its record, and the code is freed for reuse.`
          : "This coupon was never used and will be permanently deleted.",
      confirmLabel: row.usageCount > 0 ? "Archive coupon" : "Delete coupon",
      destructive: true,
      requireReason: { label: "Reason", placeholder: "Why is this coupon being removed?" },
    });
    if (!result.ok) return;
    await run(() => deleteCouponAction(row.id, result.reason));
  };

  const bulk = async (op: CouponBulkOp) => {
    const ids = selection.selectedIds;
    if (op === "DELETE") {
      const result = await confirm({
        title: `Delete ${ids.length} coupon${ids.length === 1 ? "" : "s"}?`,
        description: "Coupons with redemptions are archived (history kept); unused ones are permanently deleted.",
        confirmLabel: "Delete",
        destructive: true,
        requireReason: { label: "Reason" },
      });
      if (!result.ok) return;
    }
    await run(() => bulkCouponsAction({ ids, op }), { onSuccess: () => selection.clear() });
  };

  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState
          icon={Ticket}
          title={hasFilters ? "No coupons match these filters" : "No coupons yet"}
          description={
            hasFilters
              ? "Try clearing the search or switching status tabs."
              : "Create a code customers can enter at checkout - percentage, fixed amount or free shipping."
          }
          action={
            canManage && !hasFilters ? (
              <Button asChild size="sm">
                <Link href={"/admin/coupons/new" as Route}>New coupon</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const actionsMenu = (row: CouponRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.code}`} disabled={pending}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={couponHref(row.id)}>
            <Pencil /> {canManage ? "Edit" : "View"}
          </Link>
        </DropdownMenuItem>
        {canManage ? (
          <>
            <DropdownMenuItem onSelect={() => void duplicate(row)}>
              <Copy /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void toggle(row)}>
              {row.isActive ? (
                <>
                  <PowerOff /> Disable
                </>
              ) : (
                <>
                  <Power /> Enable
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void remove(row)}>
              <Trash2 /> {row.usageCount > 0 ? "Archive" : "Delete"}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const table = (
    <DataTable>
      <DataTableHead>
        {canManage ? (
          <Th width="2rem">
            <RowCheckbox {...selection.headerProps} label="Select all coupons on this page" />
          </Th>
        ) : null}
        <SortableTh column="code" label="Code" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        {columns.isVisible("name") ? <Th>Name</Th> : null}
        {columns.isVisible("discount") ? <SortableTh column="value" label="Discount" currentSort={sort} currentOrder={order} /> : null}
        {columns.isVisible("scope") ? <Th>Scope</Th> : null}
        {columns.isVisible("usage") ? <SortableTh column="usage" label="Usage" currentSort={sort} currentOrder={order} /> : null}
        {columns.isVisible("window") ? <SortableTh column="startsAt" label="Window" currentSort={sort} currentOrder={order} /> : null}
        <Th>Status</Th>
        {columns.isVisible("fundedBy") ? <Th>Funded by</Th> : null}
        {columns.isVisible("visibility") ? <Th>Visibility</Th> : null}
        {columns.isVisible("updatedAt") ? <SortableTh column="updatedAt" label="Updated" currentSort={sort} currentOrder={order} /> : null}
        <Th width="3rem" align="right">
          <ColumnVisibilityMenu {...columns.menuProps} />
        </Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id} selected={selection.isSelected(row.id)}>
            {canManage ? (
              <Td>
                <RowCheckbox {...selection.rowProps(row.id)} label={`Select ${row.code}`} />
              </Td>
            ) : null}
            <Td>
              <div className="flex items-center gap-1">
                <Link href={couponHref(row.id)} className="font-mono text-xs font-semibold tracking-wide hover:underline">
                  {row.code}
                </Link>
                <CopyButton value={row.code} label="Copy code" size="icon-xs" />
              </div>
            </Td>
            {columns.isVisible("name") ? (
              <Td className="max-w-56">
                <span className="line-clamp-1">{row.name}</span>
              </Td>
            ) : null}
            {columns.isVisible("discount") ? (
              <Td>
                <div className="flex flex-col">
                  <span>{describeDiscount(row)}</span>
                  <span className="text-muted-foreground text-xs">{COUPON_TYPE_META[row.type].label}</span>
                </div>
              </Td>
            ) : null}
            {columns.isVisible("scope") ? (
              <Td>
                <span className="line-clamp-1">{row.scopeLabel}</span>
                {row.excludedCount > 0 ? (
                  <span className="text-muted-foreground text-xs">
                    excl. {row.excludedCount} product{row.excludedCount === 1 ? "" : "s"}
                  </span>
                ) : null}
              </Td>
            ) : null}
            {columns.isVisible("usage") ? (
              <Td>
                <UsageCell row={row} />
              </Td>
            ) : null}
            {columns.isVisible("window") ? <Td className="whitespace-nowrap">{formatIstWindow(row.startsAt, row.endsAt)}</Td> : null}
            <Td>
              <StatusPill label={COUPON_STATUS_META[row.status].label} tone={COUPON_STATUS_META[row.status].tone} />
            </Td>
            {columns.isVisible("fundedBy") ? <Td>{row.fundedBy === "SELLER" ? "Sellers" : "Platform"}</Td> : null}
            {columns.isVisible("visibility") ? (
              <Td>
                <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                  {row.isPublic ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                  {row.isPublic ? "Public" : "Private"}
                </span>
              </Td>
            ) : null}
            {columns.isVisible("updatedAt") ? <Td className="whitespace-nowrap">{formatIstDate(row.updatedAt)}</Td> : null}
            <Td align="right">{actionsMenu(row)}</Td>
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
          title={<span className="font-mono">{row.code}</span>}
          subtitle={row.name}
          meta={<StatusPill label={COUPON_STATUS_META[row.status].label} tone={COUPON_STATUS_META[row.status].tone} />}
          href={couponHref(row.id)}
        >
          <MobileCardField label="Discount">{describeDiscount(row)}</MobileCardField>
          <MobileCardField label="Scope">{row.scopeLabel}</MobileCardField>
          <MobileCardField label="Usage" numeric>
            {row.usageLimit === null ? `${row.usageCount} used` : `${row.usageCount} / ${row.usageLimit}`}
          </MobileCardField>
          <MobileCardField label="Window">{formatIstWindow(row.startsAt, row.endsAt)}</MobileCardField>
        </MobileCard>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      {canManage ? (
        <BulkActionBar
          count={selection.count}
          itemLabel="coupons selected"
          onClear={selection.clear}
          actions={[
            { label: "Enable", icon: Power, onSelect: () => bulk("ENABLE") },
            { label: "Disable", icon: PowerOff, onSelect: () => bulk("DISABLE") },
            { label: "Delete", icon: Trash2, destructive: true, onSelect: () => bulk("DELETE") },
          ]}
        />
      ) : null}
      <div className="surface overflow-hidden">
        <ResponsiveTable table={table} cards={cards} />
      </div>
      <p className="text-muted-foreground text-xs">
        Showing {meta.from}–{meta.to} of {meta.total}
      </p>
      {confirmDialog}
    </div>
  );
}
