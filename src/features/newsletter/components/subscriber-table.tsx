"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MailMinus, MailPlus, MoreHorizontal, Trash2 } from "lucide-react";

import { NEWSLETTER_STATUS_META, type NewsletterStatus } from "@/lib/enums";
import { formatIstDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BulkActionBar, type BulkAction } from "@/components/shared/bulk-action-bar";
import { ColumnVisibilityMenu, useColumnVisibility } from "@/components/shared/column-visibility";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { CopyButton } from "@/components/shared/copy-button";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { usePermission } from "@/components/shared/permission-gate";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { RowCheckbox, useRowSelection } from "@/components/shared/row-selection";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { bulkSubscribersAction, deleteSubscriberAction, setSubscriberStatusAction } from "@/features/newsletter/actions";
import { NEWSLETTER_COLUMNS, type NewsletterBulkOp } from "@/features/newsletter/schemas";
import type { SubscriberRow } from "@/features/newsletter/types";

/**
 * The subscriber list. A Client Component because selection, column
 * visibility and the confirm dialogs live in the browser; sorting, filtering
 * and paging stay in the URL and are resolved on the server.
 */

export function SubscriberStatusBadge({ status }: { status: NewsletterStatus }) {
  const meta = NEWSLETTER_STATUS_META[status];
  return <StatusPill label={meta?.label ?? status} tone={meta?.tone ?? "neutral"} />;
}

export function SubscriberTable({ rows, sort, order }: { rows: SubscriberRow[]; sort: string; order: "asc" | "desc" }) {
  const router = useRouter();
  const columns = useColumnVisibility("newsletter", [...NEWSLETTER_COLUMNS]);
  const selection = useRowSelection(rows.map((row) => row.id));
  const [confirm, confirmDialog] = useConfirm();
  const { run } = useActionToast();
  const canManage = usePermission("newsletter.manage");
  const show = columns.isVisible;

  async function setStatus(row: SubscriberRow, status: NewsletterStatus) {
    await run(() => setSubscriberStatusAction({ id: row.id, status }), { onSuccess: () => router.refresh() });
  }

  async function remove(row: SubscriberRow) {
    const result = await confirm({
      title: `Remove ${row.email}?`,
      description:
        "The row is deleted outright. Prefer 'Unsubscribe' if you only want to stop emailing them - a deleted address can resubscribe through the storefront and start receiving mail again.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!result.ok) return;
    await run(() => deleteSubscriberAction(row.id), { onSuccess: () => router.refresh() });
  }

  async function bulk(op: NewsletterBulkOp) {
    const ids = [...selection.selectedIds];
    const label = op === "delete" ? "Delete" : op === "unsubscribe" ? "Unsubscribe" : "Resubscribe";
    const result = await confirm({
      title: `${label} ${ids.length} subscriber${ids.length === 1 ? "" : "s"}?`,
      description:
        op === "delete"
          ? "The rows are deleted outright and cannot be recovered."
          : op === "unsubscribe"
            ? "They stop receiving campaigns immediately."
            : "They start receiving campaigns again - only do this for addresses that asked to come back.",
      confirmLabel: label,
      destructive: op !== "resubscribe",
    });
    if (!result.ok) return;
    await run(() => bulkSubscribersAction({ ids, op }), {
      onSuccess: () => {
        selection.clear();
        router.refresh();
      },
    });
  }

  const bulkActions: BulkAction[] = [
    { label: "Unsubscribe", icon: MailMinus, onSelect: () => bulk("unsubscribe"), permission: "newsletter.manage" },
    { label: "Resubscribe", icon: MailPlus, onSelect: () => bulk("resubscribe"), permission: "newsletter.manage" },
    { label: "Delete", icon: Trash2, onSelect: () => bulk("delete"), destructive: true, permission: "newsletter.manage" },
  ];
  const granted = new Set<string>(canManage ? ["newsletter.manage"] : []);

  const table = (
    <DataTable>
      <DataTableHead>
        <Th width="2rem">
          <RowCheckbox {...selection.headerProps} label="Select all subscribers on this page" />
        </Th>
        <SortableTh column="email" label="Email" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        {show("name") ? <SortableTh column="name" label="Name" currentSort={sort} currentOrder={order} defaultOrder="asc" /> : null}
        <SortableTh column="status" label="Status" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        {show("source") ? <SortableTh column="source" label="Source" currentSort={sort} currentOrder={order} defaultOrder="asc" /> : null}
        {show("subscribedAt") ? <SortableTh column="subscribedAt" label="Subscribed" currentSort={sort} currentOrder={order} /> : null}
        {show("unsubscribedAt") ? <Th align="right">Unsubscribed</Th> : null}
        <Th width="3rem">
          <span className="sr-only">Actions</span>
        </Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id} selected={selection.isSelected(row.id)}>
            <Td>
              <RowCheckbox {...selection.rowProps(row.id)} label={`Select ${row.email}`} />
            </Td>
            <Td>
              <span className="flex items-center gap-1.5">
                <span className="block max-w-[18rem] truncate text-xs font-medium">{row.email}</span>
                <CopyButton value={row.email} label="Copy email" size="icon-xs" variant="ghost" />
              </span>
            </Td>
            {show("name") ? (
              <Td className="text-xs">{row.name ?? <span className="text-muted-foreground/70">—</span>}</Td>
            ) : null}
            <Td>
              <SubscriberStatusBadge status={row.status} />
            </Td>
            {show("source") ? (
              <Td className="text-xs">{row.source ?? <span className="text-muted-foreground/70">—</span>}</Td>
            ) : null}
            {show("subscribedAt") ? (
              <Td numeric className="text-xs">
                {formatIstDate(new Date(row.subscribedAt))}
              </Td>
            ) : null}
            {show("unsubscribedAt") ? (
              <Td numeric className="text-xs">
                {row.unsubscribedAt ? formatIstDate(new Date(row.unsubscribedAt)) : <span className="text-muted-foreground/70">—</span>}
              </Td>
            ) : null}
            <Td align="right">
              {canManage ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.email}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {row.status === "SUBSCRIBED" ? (
                      <DropdownMenuItem onSelect={() => void setStatus(row, "UNSUBSCRIBED")}>
                        <MailMinus /> Unsubscribe
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => void setStatus(row, "SUBSCRIBED")}>
                        <MailPlus /> Resubscribe
                      </DropdownMenuItem>
                    )}
                    {row.status !== "BOUNCED" ? (
                      <DropdownMenuItem onSelect={() => void setStatus(row, "BOUNCED")}>Mark bounced</DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => void remove(row)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = rows.map((row) => (
    <MobileCard key={row.id} title={row.email} subtitle={row.name ?? undefined} meta={<SubscriberStatusBadge status={row.status} />}>
      <MobileCardField label="Source">{row.source ?? "—"}</MobileCardField>
      <MobileCardField label="Subscribed">{formatIstDate(new Date(row.subscribedAt))}</MobileCardField>
      {row.unsubscribedAt ? <MobileCardField label="Unsubscribed">{formatIstDate(new Date(row.unsubscribedAt))}</MobileCardField> : null}
    </MobileCard>
  ));

  return (
    <>
      <div className="flex items-center justify-end border-b px-4 py-1.5">
        <ColumnVisibilityMenu {...columns.menuProps} />
      </div>
      <ResponsiveTable table={table} cards={cards} />
      <BulkActionBar count={selection.count} actions={bulkActions} onClear={selection.clear} permissions={granted} itemLabel="subscribers selected" />
      {confirmDialog}
    </>
  );
}
