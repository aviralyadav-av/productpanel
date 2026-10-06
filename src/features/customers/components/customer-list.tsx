"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Ban, Eye, KeyRound, MoreHorizontal, Pencil, ShieldCheck, Tag, Tags, Users } from "lucide-react";

import { BulkActionBar, type BulkAction } from "@/components/shared/bulk-action-bar";
import { ColumnVisibilityMenu, useColumnVisibility } from "@/components/shared/column-visibility";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { FilterTabs, PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { PriceText } from "@/components/shared/price-text";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { RowCheckbox, useRowSelection } from "@/components/shared/row-selection";
import { SortableTh } from "@/components/shared/sortable-th";
import { CustomerStatusBadge, StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatIstDate } from "@/lib/dates";
import { CUSTOMER_SEGMENT_META, CUSTOMER_SEGMENTS, type CustomerSegment } from "@/lib/enums";
import type { PageMeta } from "@/lib/list-params";
import { formatNumber } from "@/lib/money";

import { bulkCustomersAction, sendPasswordResetAction, setCustomerStatusAction } from "@/features/customers/actions";
import { CustomerFilters } from "@/features/customers/components/customer-filters";
import { CUSTOMER_COLUMNS, hasActiveFilters, type CustomerListFilters } from "@/features/customers/filters";
import type { CustomerRow, SegmentCounts } from "@/features/customers/queries";
import { BULK_OP_PERMISSION, type BulkOperation } from "@/features/customers/schemas";

/**
 * Toolbar + table + bulk bar for /admin/customers (brief section 7). One
 * client component so column visibility is shared between the menu and the
 * cells; filters, sort and page live in the URL and the page re-queries.
 */
export function CustomerList({
  rows,
  meta,
  filters,
  segmentCounts,
  sort,
  order,
  tagSuggestions,
  permissions,
  exportQuery,
}: {
  rows: CustomerRow[];
  meta: PageMeta;
  filters: CustomerListFilters;
  segmentCounts: SegmentCounts;
  sort: string;
  order: "asc" | "desc";
  tagSuggestions: string[];
  permissions: string[];
  /** The current query string, so the export link reproduces the visible filter. */
  exportQuery: string;
}) {
  const router = useRouter();
  const { run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const columns = useColumnVisibility("customers", [...CUSTOMER_COLUMNS]);
  const selection = useRowSelection(rows.map((row) => row.id));
  const [tagDialog, setTagDialog] = React.useState<Extract<BulkOperation, "ADD_TAG" | "REMOVE_TAG"> | null>(null);
  const permitted = new Set(permissions);
  const can = (code: string) => permitted.has("*") || permitted.has(code);
  const visible = (key: string) => !columns.hydrated || columns.isVisible(key);

  const runBulk = async (op: BulkOperation, extra: { tag?: string; reason?: string } = {}) => {
    const result = await run(() => bulkCustomersAction({ ids: selection.selectedIds, op, ...extra }));
    if (result.ok) {
      selection.clear();
      setTagDialog(null);
      router.refresh();
    }
  };

  const exportHref = (format: string, ids?: readonly string[]) => {
    const params = new URLSearchParams(exportQuery);
    params.set("format", format);
    for (const id of ids ?? []) params.append("id", id);
    return `/api/admin/customers/export?${params.toString()}`;
  };

  const count = selection.count;
  const bulkActions: BulkAction[] = [
    {
      label: "Block",
      icon: Ban,
      permission: BULK_OP_PERMISSION.BLOCK,
      destructive: true,
      onSelect: async () => {
        const answer = await confirm({ title: `Block ${count} customer(s)?`, description: "They are signed out everywhere and cannot order until unblocked.", destructive: true, confirmLabel: "Block", requireReason: { label: "Reason" } });
        if (answer.ok) await runBulk("BLOCK", { reason: answer.reason });
      },
    },
    { label: "Unblock", icon: ShieldCheck, permission: BULK_OP_PERMISSION.UNBLOCK, onSelect: () => runBulk("UNBLOCK") },
    { label: "Add tag", icon: Tag, permission: BULK_OP_PERMISSION.ADD_TAG, onSelect: () => setTagDialog("ADD_TAG") },
    { label: "Remove tag", icon: Tags, permission: BULK_OP_PERMISSION.REMOVE_TAG, onSelect: () => setTagDialog("REMOVE_TAG") },
    {
      label: "Export selected",
      onSelect: () => {
        window.open(exportHref("csv", selection.selectedIds), "_blank", "noopener");
      },
    },
  ];

  const segmentOptions = CUSTOMER_SEGMENTS.map((segment: CustomerSegment) => ({ value: segment, label: CUSTOMER_SEGMENT_META[segment].label, count: segmentCounts[segment] }));

  return (
    <div className="surface overflow-hidden">
      <DataTableToolbar
        search={<SearchInput placeholder="Search name, email or phone" />}
        filters={<FilterTabs paramKey="segment" options={segmentOptions} allLabel={`All ${formatNumber(segmentCounts.all)}`} />}
        actions={
          <>
            <ColumnVisibilityMenu {...columns.menuProps} />
            <ExportButton formats={["csv", "xlsx"]} hrefFor={(format) => exportHref(format)} />
          </>
        }
      />
      <div className="border-b px-4 py-2">
        <CustomerFilters filters={filters} tagSuggestions={tagSuggestions} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={hasActiveFilters(filters) ? "No customers match these filters" : "No customers yet"}
          description={
            hasActiveFilters(filters)
              ? "Try clearing a filter or widening the registered window."
              : "Customers appear here when they register on the website or when you add one manually."
          }
          action={
            can("customers.create") && !hasActiveFilters(filters) ? (
              <Button asChild size="sm">
                <Link href={"/admin/customers/new" as Route}>New customer</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <ResponsiveTable
          table={
            <DataTable>
              <DataTableHead>
                <Th width="2.5rem">
                  <RowCheckbox {...selection.headerProps} label="Select all on this page" />
                </Th>
                <SortableTh column="name" label="Customer" currentSort={sort} currentOrder={order} defaultOrder="asc" />
                {visible("phone") ? <Th>Phone</Th> : null}
                {visible("createdAt") ? <SortableTh column="createdAt" label="Registered" currentSort={sort} currentOrder={order} /> : null}
                {visible("orderCount") ? <SortableTh column="orderCount" label="Orders" currentSort={sort} currentOrder={order} align="right" /> : null}
                {visible("totalSpentPaise") ? <SortableTh column="totalSpentPaise" label="Total spent" currentSort={sort} currentOrder={order} align="right" /> : null}
                {visible("lastOrderAt") ? <SortableTh column="lastOrderAt" label="Last order" currentSort={sort} currentOrder={order} /> : null}
                {visible("status") ? <Th>Status</Th> : null}
                {visible("segment") ? <Th>Segment</Th> : null}
                {visible("tags") ? <Th>Tags</Th> : null}
                {visible("marketing") ? <Th>Marketing</Th> : null}
                <Th width="2.5rem" />
              </DataTableHead>
              <DataTableBody>
                {rows.map((row) => (
                  <Tr key={row.id} selected={selection.isSelected(row.id)}>
                    <Td>
                      <RowCheckbox {...selection.rowProps(row.id)} label={`Select ${row.fullName ?? row.email}`} />
                    </Td>
                    <Td>
                      <Link href={`/admin/customers/${row.id}` as Route} className="font-medium hover:underline">
                        {row.fullName ?? <span className="text-muted-foreground italic">No name</span>}
                      </Link>
                      <div className="text-muted-foreground truncate text-[11px]">{row.email}</div>
                    </Td>
                    {visible("phone") ? <Td className="text-muted-foreground text-xs whitespace-nowrap">{row.phone ?? "—"}</Td> : null}
                    {visible("createdAt") ? <Td className="text-muted-foreground text-xs whitespace-nowrap">{formatIstDate(row.createdAt)}</Td> : null}
                    {visible("orderCount") ? (
                      <Td align="right" numeric>
                        {formatNumber(row.orderCount)}
                      </Td>
                    ) : null}
                    {visible("totalSpentPaise") ? (
                      <Td align="right" numeric>
                        <PriceText paise={row.totalSpentPaise} />
                      </Td>
                    ) : null}
                    {visible("lastOrderAt") ? <Td className="text-muted-foreground text-xs whitespace-nowrap">{row.lastOrderAt ? formatIstDate(row.lastOrderAt) : "—"}</Td> : null}
                    {visible("status") ? (
                      <Td>{row.deletedAt ? <StatusPill label="Deleted" tone="neutral" /> : <CustomerStatusBadge status={row.status} />}</Td>
                    ) : null}
                    {visible("segment") ? (
                      <Td>
                        <SegmentBadge segment={row.segment} />
                      </Td>
                    ) : null}
                    {visible("tags") ? <Td className="text-muted-foreground max-w-48 truncate text-xs">{row.tags.length ? row.tags.join(", ") : "—"}</Td> : null}
                    {visible("marketing") ? <Td className="text-xs">{row.acceptsMarketing ? "Yes" : "No"}</Td> : null}
                    <Td>
                      <RowActions row={row} can={can} />
                    </Td>
                  </Tr>
                ))}
              </DataTableBody>
            </DataTable>
          }
          cards={rows.map((row) => (
            <MobileCard
              key={row.id}
              href={`/admin/customers/${row.id}`}
              title={row.fullName ?? row.email}
              subtitle={row.email}
              meta={row.deletedAt ? <StatusPill label="Deleted" tone="neutral" /> : <CustomerStatusBadge status={row.status} />}
            >
              <MobileCardField label="Orders" numeric>
                {formatNumber(row.orderCount)}
              </MobileCardField>
              <MobileCardField label="Spent" numeric>
                <PriceText paise={row.totalSpentPaise} />
              </MobileCardField>
              <MobileCardField label="Segment">
                <SegmentBadge segment={row.segment} />
              </MobileCardField>
              <MobileCardField label="Registered">{formatIstDate(row.createdAt)}</MobileCardField>
            </MobileCard>
          ))}
        />
      )}

      {meta.total > 0 ? <PaginationBar meta={meta} itemLabel="customers" /> : null}

      <BulkActionBar count={selection.count} actions={bulkActions} onClear={selection.clear} permissions={permitted.has("*") ? undefined : permitted} itemLabel="selected" />
      <TagDialog op={tagDialog} count={selection.count} suggestions={tagSuggestions} onClose={() => setTagDialog(null)} onConfirm={(tag) => runBulk(tagDialog ?? "ADD_TAG", { tag })} />
      {confirmDialog}
    </div>
  );
}

export function SegmentBadge({ segment }: { segment: CustomerSegment | null }) {
  if (!segment) return <span className="text-muted-foreground/60">—</span>;
  const meta = CUSTOMER_SEGMENT_META[segment];
  return <StatusPill label={meta.label} tone={meta.tone} dot={false} />;
}

function TagDialog({
  op,
  count,
  suggestions,
  onClose,
  onConfirm,
}: {
  op: "ADD_TAG" | "REMOVE_TAG" | null;
  count: number;
  suggestions: string[];
  onClose: () => void;
  onConfirm: (tag: string) => Promise<void>;
}) {
  const [tag, setTag] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const submit = async () => {
    if (!tag.trim()) return;
    setPending(true);
    try {
      await onConfirm(tag.trim().toLowerCase());
      setTag("");
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open={op !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{op === "REMOVE_TAG" ? "Remove a tag" : "Add a tag"}</DialogTitle>
          <DialogDescription>
            {op === "REMOVE_TAG" ? `Remove the tag from ${count} selected customer(s).` : `Tag ${count} selected customer(s). Tags are lower-cased and shared across the team.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="bulk-tag">Tag</Label>
          <Input id="bulk-tag" list="bulk-tag-suggestions" value={tag} onChange={(event) => setTag(event.target.value)} placeholder="e.g. wholesale" autoFocus onKeyDown={(event) => event.key === "Enter" && void submit()} />
          <datalist id="bulk-tag-suggestions">
            {suggestions.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={pending || !tag.trim()}>
            {op === "REMOVE_TAG" ? "Remove tag" : "Add tag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RowActions({ row, can }: { row: CustomerRow; can: (code: string) => boolean }) {
  const router = useRouter();
  const { run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const name = row.fullName ?? row.email;

  const toggleBlock = async () => {
    if (row.status === "BLOCKED") {
      await run(() => setCustomerStatusAction(row.id, "ACTIVE"), { onSuccess: () => router.refresh() });
      return;
    }
    const answer = await confirm({ title: "Block customer", description: `Block ${name}? They are signed out everywhere and cannot place orders.`, destructive: true, confirmLabel: "Block", requireReason: { label: "Reason", placeholder: "Why is this customer being blocked?" } });
    if (!answer.ok) return;
    await run(() => setCustomerStatusAction(row.id, "BLOCKED", answer.reason), { onSuccess: () => router.refresh() });
  };

  const resetPassword = async () => {
    const answer = await confirm({ title: "Send password reset", description: `Email ${row.email} a link to choose a new password? The link expires in 60 minutes.`, confirmLabel: "Send link" });
    if (!answer.ok) return;
    await run(() => sendPasswordResetAction(row.id));
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/admin/customers/${row.id}` as Route}>
              <Eye /> View
            </Link>
          </DropdownMenuItem>
          {can("customers.edit") && !row.deletedAt ? (
            <DropdownMenuItem asChild>
              <Link href={`/admin/customers/${row.id}?tab=profile` as Route}>
                <Pencil /> Edit
              </Link>
            </DropdownMenuItem>
          ) : null}
          {!row.deletedAt && (can("customers.block") || can("customers.reset_password")) ? <DropdownMenuSeparator /> : null}
          {can("customers.block") && !row.deletedAt ? (
            <DropdownMenuItem onSelect={() => void toggleBlock()} variant={row.status === "BLOCKED" ? "default" : "destructive"}>
              {row.status === "BLOCKED" ? (
                <>
                  <ShieldCheck /> Unblock
                </>
              ) : (
                <>
                  <Ban /> Block
                </>
              )}
            </DropdownMenuItem>
          ) : null}
          {can("customers.reset_password") && !row.deletedAt && row.status !== "BLOCKED" ? (
            <DropdownMenuItem onSelect={() => void resetPassword()}>
              <KeyRound /> Send password reset
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmDialog}
    </>
  );
}
