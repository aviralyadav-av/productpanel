"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { CheckCircle2, MoreHorizontal, RotateCcw, ShieldAlert, UserPlus } from "lucide-react";

import { INQUIRY_PRIORITY_META, INQUIRY_STATUS_META, INQUIRY_TYPE_META, type InquiryPriority, type InquiryStatus, type InquiryType } from "@/lib/enums";
import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BulkActionBar, type BulkAction } from "@/components/shared/bulk-action-bar";
import { ColumnVisibilityMenu, useColumnVisibility } from "@/components/shared/column-visibility";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { usePermission } from "@/components/shared/permission-gate";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { RowCheckbox, useRowSelection } from "@/components/shared/row-selection";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { bulkInquiriesAction, setInquiryStatusAction } from "@/features/inquiries/actions";
import { INQUIRY_COLUMNS, type InquiryBulkOp } from "@/features/inquiries/schemas";
import type { AssigneeRef, InquiryListRow } from "@/features/inquiries/types";

/** Badges shared by the list and the detail page. */
export function InquiryStatusBadge({ status }: { status: InquiryStatus }) {
  const meta = INQUIRY_STATUS_META[status];
  return <StatusPill label={meta?.label ?? status} tone={meta?.tone ?? "neutral"} />;
}
export function InquiryPriorityBadge({ priority }: { priority: InquiryPriority }) {
  const meta = INQUIRY_PRIORITY_META[priority];
  return <StatusPill label={meta?.label ?? priority} tone={meta?.tone ?? "neutral"} dot={false} />;
}
export function InquiryTypeBadge({ type }: { type: InquiryType }) {
  const meta = INQUIRY_TYPE_META[type];
  return <StatusPill label={meta?.label ?? type} tone={meta?.tone ?? "neutral"} dot={false} />;
}

/** Pick an assignee for a bulk assign. */
function AssignDialog({ open, users, onOpenChange, onConfirm }: { open: boolean; users: AssigneeRef[]; onOpenChange: (open: boolean) => void; onConfirm: (userId: string | null) => Promise<void> }) {
  const [value, setValue] = React.useState<string>("");
  const [pending, setPending] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign inquiries</DialogTitle>
          <DialogDescription>New inquiries move to Open when assigned.</DialogDescription>
        </DialogHeader>
        <select aria-label="Assignee" className="border-input bg-background h-8 w-full rounded-md border px-2 text-xs" value={value} onChange={(event) => setValue(event.target.value)}>
          <option value="">Unassigned</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name ?? user.email}
            </option>
          ))}
        </select>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm(value || null);
              } finally {
                setPending(false);
              }
            }}
          >
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InquiryTable({ rows, sort, order, users }: { rows: InquiryListRow[]; sort: string; order: "asc" | "desc"; users: AssigneeRef[] }) {
  const router = useRouter();
  const columns = useColumnVisibility("inquiries", [...INQUIRY_COLUMNS]);
  const selection = useRowSelection(rows.map((row) => row.id));
  const [confirm, confirmDialog] = useConfirm();
  const { run } = useActionToast();
  const canManage = usePermission("inquiries.manage");
  const [assignOpen, setAssignOpen] = React.useState(false);
  const show = columns.isVisible;

  async function setStatus(row: InquiryListRow, status: InquiryStatus) {
    await run(() => setInquiryStatusAction({ id: row.id, status }), { onSuccess: () => router.refresh() });
  }

  async function bulk(op: Exclude<InquiryBulkOp, "assign">) {
    const ids = [...selection.selectedIds];
    const label = op === "resolve" ? "Resolve" : op === "spam" ? "Mark as spam" : "Reopen";
    const result = await confirm({ title: `${label} ${ids.length} inquir${ids.length === 1 ? "y" : "ies"}?`, confirmLabel: label, destructive: op === "spam" });
    if (!result.ok) return;
    await run(() => bulkInquiriesAction({ ids, op }), {
      onSuccess: () => {
        selection.clear();
        router.refresh();
      },
    });
  }

  async function bulkAssign(userId: string | null) {
    const ids = [...selection.selectedIds];
    await run(() => bulkInquiriesAction({ ids, op: "assign", assignedToId: userId }), {
      onSuccess: () => {
        selection.clear();
        setAssignOpen(false);
        router.refresh();
      },
    });
  }

  const bulkActions: BulkAction[] = [
    { label: "Resolve", icon: CheckCircle2, onSelect: () => bulk("resolve"), permission: "inquiries.manage" },
    { label: "Assign…", icon: UserPlus, onSelect: () => setAssignOpen(true), permission: "inquiries.manage" },
    { label: "Reopen", icon: RotateCcw, onSelect: () => bulk("reopen"), permission: "inquiries.manage" },
    { label: "Mark as spam", icon: ShieldAlert, onSelect: () => bulk("spam"), destructive: true, permission: "inquiries.manage" },
  ];

  const table = (
    <DataTable>
      <DataTableHead>
        <Th width="2rem">
          <RowCheckbox {...selection.headerProps} label="Select all inquiries on this page" />
        </Th>
        <SortableTh column="name" label="Contact" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <Th>Subject</Th>
        {show("type") ? <Th>Type</Th> : null}
        {show("priority") ? <SortableTh column="priority" label="Priority" currentSort={sort} currentOrder={order} /> : null}
        {show("assigned") ? <Th>Assigned</Th> : null}
        <SortableTh column="status" label="Status" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        {show("received") ? <SortableTh column="createdAt" label="Received" currentSort={sort} currentOrder={order} /> : null}
        {show("lastReply") ? <SortableTh column="lastReply" label="Last reply" currentSort={sort} currentOrder={order} /> : null}
        <Th width="3rem">
          <span className="sr-only">Actions</span>
        </Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id} selected={selection.isSelected(row.id)} className={row.status === "NEW" ? "font-medium" : undefined}>
            <Td>
              <RowCheckbox {...selection.rowProps(row.id)} label={`Select inquiry from ${row.name}`} />
            </Td>
            <Td>
              <Link href={`/admin/inquiries/${row.id}` as Route} className="block hover:underline">
                <span className="block max-w-[12rem] truncate text-sm">{row.name}</span>
                <span className="text-muted-foreground block max-w-[12rem] truncate text-[11px] font-normal">{row.email}</span>
              </Link>
            </Td>
            <Td>
              <Link href={`/admin/inquiries/${row.id}` as Route} className="block max-w-[22rem] truncate text-xs hover:underline">
                {row.subject}
              </Link>
              {row.orderNumber ? <span className="text-muted-foreground block font-mono text-[11px] font-normal">{row.orderNumber}</span> : null}
            </Td>
            {show("type") ? (
              <Td>
                <InquiryTypeBadge type={row.type} />
              </Td>
            ) : null}
            {show("priority") ? (
              <Td>
                <InquiryPriorityBadge priority={row.priority} />
              </Td>
            ) : null}
            {show("assigned") ? <Td className="text-xs font-normal">{row.assignedTo ? row.assignedTo.name ?? row.assignedTo.email : <span className="text-muted-foreground/70">—</span>}</Td> : null}
            <Td>
              <InquiryStatusBadge status={row.status} />
            </Td>
            {show("received") ? (
              <Td numeric className="text-xs font-normal">
                {formatIstDateTime(new Date(row.createdAt))}
              </Td>
            ) : null}
            {show("lastReply") ? (
              <Td numeric className="text-xs font-normal">
                {row.lastReplyAt ? formatIstDate(new Date(row.lastReplyAt)) : <span className="text-muted-foreground/70">—</span>}
              </Td>
            ) : null}
            <Td align="right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label={`Actions for inquiry from ${row.name}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel className="truncate text-xs">{row.name}</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href={`/admin/inquiries/${row.id}` as Route}>Open</Link>
                  </DropdownMenuItem>
                  {canManage ? (
                    <>
                      <DropdownMenuSeparator />
                      {row.status !== "RESOLVED" ? (
                        <DropdownMenuItem onSelect={() => void setStatus(row, "RESOLVED")}>
                          <CheckCircle2 /> Resolve
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => void setStatus(row, "OPEN")}>
                          <RotateCcw /> Reopen
                        </DropdownMenuItem>
                      )}
                      {row.status !== "SPAM" ? (
                        <DropdownMenuItem variant="destructive" onSelect={() => void setStatus(row, "SPAM")}>
                          <ShieldAlert /> Mark as spam
                        </DropdownMenuItem>
                      ) : null}
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = rows.map((row) => (
    <MobileCard key={row.id} href={`/admin/inquiries/${row.id}`} title={row.subject} subtitle={`${row.name} · ${row.email}`} meta={<InquiryStatusBadge status={row.status} />}>
      <MobileCardField label="Type">{INQUIRY_TYPE_META[row.type]?.label ?? row.type}</MobileCardField>
      <MobileCardField label="Priority">{INQUIRY_PRIORITY_META[row.priority]?.label ?? row.priority}</MobileCardField>
      <MobileCardField label="Assigned">{row.assignedTo ? row.assignedTo.name ?? row.assignedTo.email : "—"}</MobileCardField>
      <MobileCardField label="Received">{formatIstDate(new Date(row.createdAt))}</MobileCardField>
    </MobileCard>
  ));

  return (
    <>
      <div className="flex items-center justify-end border-b px-4 py-1.5">
        <ColumnVisibilityMenu {...columns.menuProps} />
      </div>
      <ResponsiveTable table={table} cards={cards} />
      <BulkActionBar count={selection.count} actions={bulkActions} onClear={selection.clear} permissions={canManage ? ["inquiries.manage"] : []} itemLabel="inquiries selected" />
      {confirmDialog}
      <AssignDialog open={assignOpen} users={users} onOpenChange={setAssignOpen} onConfirm={bulkAssign} />
    </>
  );
}
