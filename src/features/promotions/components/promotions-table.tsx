"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Megaphone, MoreHorizontal, Pencil, Power, PowerOff, Trash2 } from "lucide-react";

import { PROMOTION_TYPE_META } from "@/lib/enums";
import { formatIstDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import type { PageMeta } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { formatIstWindow } from "@/features/coupons/dates";

import { deletePromotionAction, togglePromotionAction } from "../actions";
import { PROMOTION_STATUS_META, describePromotionDiscount, type PromotionRow } from "../schemas";

function promotionHref(id: string): Route {
  return `/admin/promotions/${id}` as Route;
}

export function PromotionsTable({
  rows,
  meta,
  sort,
  order,
  canManage,
  hasFilters,
}: {
  rows: PromotionRow[];
  meta: PageMeta;
  sort: string;
  order: "asc" | "desc";
  canManage: boolean;
  hasFilters: boolean;
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const { run, pending } = useActionToast();

  const toggle = (row: PromotionRow) => run(() => togglePromotionAction(row.id, !row.isActive), { onSuccess: () => router.refresh() });

  const remove = async (row: PromotionRow) => {
    const result = await confirm({
      title: `Delete "${row.name}"?`,
      description: `${row.affectedProducts} product${row.affectedProducts === 1 ? "" : "s"} currently show this promotion's price; they will be re-priced immediately. Past orders keep their discounts.`,
      confirmLabel: "Delete promotion",
      destructive: true,
      requireReason: { label: "Reason", placeholder: "Why is this promotion being removed?" },
    });
    if (!result.ok) return;
    await run(() => deletePromotionAction(row.id, result.reason), { onSuccess: () => router.refresh() });
  };

  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState
          icon={Megaphone}
          title={hasFilters ? "No promotions match these filters" : "No promotions yet"}
          description={
            hasFilters
              ? "Try clearing the search or switching status tabs."
              : "A promotion lowers prices across a category, a seller's shop or a set of products for a fixed window - no code needed."
          }
          action={
            canManage && !hasFilters ? (
              <Button asChild size="sm">
                <Link href={"/admin/promotions/new" as Route}>New promotion</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const statusPill = (row: PromotionRow) => <StatusPill label={PROMOTION_STATUS_META[row.status].label} tone={PROMOTION_STATUS_META[row.status].tone} />;

  const menu = (row: PromotionRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.name}`} disabled={pending}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={promotionHref(row.id)}>
            <Pencil /> {canManage ? "Edit" : "View"}
          </Link>
        </DropdownMenuItem>
        {canManage ? (
          <>
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
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const table = (
    <DataTable>
      <DataTableHead>
        <SortableTh column="name" label="Promotion" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="type" label="Type" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="value" label="Discount" currentSort={sort} currentOrder={order} />
        <Th>Scope</Th>
        <SortableTh column="startsAt" label="Window" currentSort={sort} currentOrder={order} />
        <Th>Status</Th>
        <SortableTh column="priority" label="Priority" currentSort={sort} currentOrder={order} align="right" />
        <Th align="right">Products</Th>
        <Th>Funded by</Th>
        <SortableTh column="updatedAt" label="Updated" currentSort={sort} currentOrder={order} />
        <Th width="3rem" />
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td className="max-w-64">
              <Link href={promotionHref(row.id)} className="font-medium hover:underline">
                <span className="line-clamp-1">{row.name}</span>
              </Link>
              {row.badgeText ? <span className="text-brand text-xs">{row.badgeText}</span> : null}
            </Td>
            <Td>
              <StatusPill label={PROMOTION_TYPE_META[row.type].label} tone={PROMOTION_TYPE_META[row.type].tone} dot={false} />
            </Td>
            <Td>{describePromotionDiscount(row, formatPaise)}</Td>
            <Td>
              <span className="line-clamp-1">{row.scopeLabel}</span>
            </Td>
            <Td className="whitespace-nowrap">{formatIstWindow(row.startsAt, row.endsAt)}</Td>
            <Td>{statusPill(row)}</Td>
            <Td align="right" numeric>
              {row.priority}
            </Td>
            <Td align="right" numeric>
              {row.affectedProducts}
            </Td>
            <Td>{row.fundedBy === "SELLER" ? "Sellers" : "Platform"}</Td>
            <Td className="whitespace-nowrap">{formatIstDate(row.updatedAt)}</Td>
            <Td align="right">{menu(row)}</Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = (
    <div className="space-y-2">
      {rows.map((row) => (
        <MobileCard key={row.id} title={row.name} subtitle={PROMOTION_TYPE_META[row.type].label} meta={statusPill(row)} href={promotionHref(row.id)}>
          <MobileCardField label="Discount">{describePromotionDiscount(row, formatPaise)}</MobileCardField>
          <MobileCardField label="Scope">{row.scopeLabel}</MobileCardField>
          <MobileCardField label="Window">{formatIstWindow(row.startsAt, row.endsAt)}</MobileCardField>
          <MobileCardField label="Products" numeric>
            {row.affectedProducts}
          </MobileCardField>
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
      {confirmDialog}
    </div>
  );
}
