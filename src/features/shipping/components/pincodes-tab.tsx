"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { FileUp, MapPinned, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

import { bulkPincodesAction, deletePincodeAction } from "@/features/shipping/actions";
import { PincodeDialog } from "@/features/shipping/components/pincode-dialog";
import { PincodeImportDialog } from "@/features/shipping/components/pincode-import-dialog";
import type { ZoneOption } from "@/features/shipping/components/rate-dialog";
import type { PincodeRow } from "@/features/shipping/queries";
import type { PincodeBulkAction } from "@/features/shipping/schemas";
import { BulkActionBar } from "@/components/shared/bulk-action-bar";
import { SearchableSelect } from "@/components/shared/combobox";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { RowCheckbox, useRowSelection } from "@/components/shared/row-selection";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryNav } from "@/hooks/use-query-nav";
import { formatIstDateTime } from "@/lib/dates";
import type { PageMeta } from "@/lib/list-params";

const EXPORT_URL = "/api/admin/shipping/pincodes/export";

/** A tri-state URL filter (any / yes / no) rendered as a compact select. */
function YesNoFilter({ paramKey, label }: { paramKey: string; label: string }) {
  const { navigate, searchParams } = useQueryNav();
  const value = searchParams.get(paramKey) ?? "any";
  return (
    <Select value={value} onValueChange={(next) => navigate({ [paramKey]: next === "any" ? null : next })}>
      <SelectTrigger size="sm" className="h-8 w-36" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="any">{label}: any</SelectItem>
        <SelectItem value="yes">{label}: yes</SelectItem>
        <SelectItem value="no">{label}: no</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function PincodesTab({
  rows,
  meta,
  zones,
  sort,
  order,
  canManage,
}: {
  rows: PincodeRow[];
  meta: PageMeta;
  zones: ZoneOption[];
  sort: string;
  order: "asc" | "desc";
  canManage: boolean;
}) {
  const searchParams = useSearchParams();
  const { navigate } = useQueryNav();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const selection = useRowSelection(rows.map((row) => row.pincode));

  const [editing, setEditing] = React.useState<PincodeRow | null>(null);
  const [dialogKey, setDialogKey] = React.useState(0);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assignZoneId, setAssignZoneId] = React.useState<string | null>(null);

  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const zoneParam = searchParams.get("zone") ?? "all";

  function openDialog(row: PincodeRow | null) {
    setEditing(row);
    setDialogKey((key) => key + 1);
    setDialogOpen(true);
  }

  async function remove(row: PincodeRow) {
    const result = await confirm({
      title: `Remove pincode ${row.pincode}?`,
      description: "It will follow the zone prefix, state and default rules again instead of this row's overrides.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!result.ok) return;
    await run(() => deletePincodeAction(row.pincode));
  }

  async function bulk(action: PincodeBulkAction, zoneId?: string | null) {
    const pincodes = [...selection.selectedIds];
    await run(() => bulkPincodesAction({ pincodes, action, zoneId }), { onSuccess: () => selection.clear() });
  }

  const exportHref = (format: "csv" | "xlsx") => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.delete("tab");
    params.set("format", format);
    return `${EXPORT_URL}?${params.toString()}`;
  };

  const menuFor = (row: PincodeRow) =>
    canManage ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.pincode}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => openDialog(row)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => remove(row)}>
            <Trash2 /> Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const isFiltered = ["q", "zone", "serviceable", "cod"].some((key) => searchParams.has(key));

  return (
    <div className="surface">
      <DataTableToolbar
        search={<SearchInput placeholder="Pincode prefix, city or state" className="w-full sm:w-64" />}
        filters={
          <>
            <Select value={zoneParam} onValueChange={(next) => navigate({ zone: next === "all" ? null : next })}>
              <SelectTrigger size="sm" className="h-8 w-44" aria-label="Zone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Zone: any</SelectItem>
                <SelectItem value="none">Zone: unassigned</SelectItem>
                {zones.map((zone) => (
                  <SelectItem key={zone.id} value={zone.id}>{zone.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <YesNoFilter paramKey="serviceable" label="Serviceable" />
            <YesNoFilter paramKey="cod" label="COD" />
          </>
        }
        actions={
          <>
            <ExportButton hrefFor={exportHref} disabled={meta.total === 0} />
            {canManage ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                  <FileUp /> Import CSV
                </Button>
                <Button size="sm" onClick={() => openDialog(null)}>
                  <Plus /> Add pincode
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {canManage && selection.count > 0 ? (
        <BulkActionBar
          count={selection.count}
          itemLabel="pincodes"
          onClear={selection.clear}
          actions={[
            { label: "Mark serviceable", onSelect: () => bulk("serviceable_on"), disabled: pending },
            { label: "Mark not serviceable", onSelect: () => bulk("serviceable_off"), disabled: pending },
            { label: "Enable COD", onSelect: () => bulk("cod_on"), disabled: pending },
            { label: "Disable COD", onSelect: () => bulk("cod_off"), disabled: pending },
            { label: "Assign zone…", onSelect: () => setAssignOpen(true), disabled: pending },
          ]}
        />
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={MapPinned}
          title={isFiltered ? "No pincodes match these filters" : "No pincode overrides yet"}
          description={
            isFiltered
              ? "Clear the search or filters to see the rest."
              : "Every pincode is served by zone rules until a row here says otherwise. Import a courier's serviceability CSV or add pincodes one at a time."
          }
          action={canManage && !isFiltered ? <Button size="sm" onClick={() => setImportOpen(true)}><FileUp /> Import CSV</Button> : undefined}
        />
      ) : (
        <>
          <ResponsiveTable
            table={
              <DataTable>
                <DataTableHead>
                  {canManage ? (
                    <Th width="2.5rem">
                      <RowCheckbox {...selection.headerProps} label="Select all on this page" />
                    </Th>
                  ) : null}
                  <SortableTh column="pincode" label="Pincode" currentSort={sort} currentOrder={order} defaultOrder="asc" />
                  <SortableTh column="city" label="City" currentSort={sort} currentOrder={order} defaultOrder="asc" />
                  <SortableTh column="state" label="State" currentSort={sort} currentOrder={order} defaultOrder="asc" />
                  <Th>Zone</Th>
                  <Th>Serviceable</Th>
                  <Th>COD</Th>
                  <Th align="right">Days</Th>
                  <SortableTh column="updatedAt" label="Updated" currentSort={sort} currentOrder={order} />
                  {canManage ? <Th align="right" width="3rem"><span className="sr-only">Actions</span></Th> : null}
                </DataTableHead>
                <DataTableBody>
                  {rows.map((row) => (
                    <Tr key={row.pincode} selected={selection.isSelected(row.pincode)}>
                      {canManage ? (
                        <Td>
                          <RowCheckbox {...selection.rowProps(row.pincode)} label={`Select ${row.pincode}`} />
                        </Td>
                      ) : null}
                      <Td className="font-mono font-medium">{row.pincode}</Td>
                      <Td>{row.city ?? <span className="text-muted-foreground">—</span>}</Td>
                      <Td>{row.state ?? <span className="text-muted-foreground">—</span>}</Td>
                      <Td>{row.zoneName ?? <span className="text-muted-foreground text-xs">Automatic</span>}</Td>
                      <Td><StatusPill label={row.isServiceable ? "Yes" : "No"} tone={row.isServiceable ? "success" : "danger"} /></Td>
                      <Td><StatusPill label={row.codAvailable ? "Yes" : "No"} tone={row.codAvailable ? "success" : "neutral"} /></Td>
                      <Td align="right" numeric>{row.estimatedDays ?? <span className="text-muted-foreground">—</span>}</Td>
                      <Td className="text-muted-foreground text-xs" numeric>{formatIstDateTime(row.updatedAt)}</Td>
                      {canManage ? <Td align="right">{menuFor(row)}</Td> : null}
                    </Tr>
                  ))}
                </DataTableBody>
              </DataTable>
            }
            cards={rows.map((row) => (
              <MobileCard
                key={row.pincode}
                title={<span className="font-mono">{row.pincode}</span>}
                subtitle={[row.city, row.state].filter(Boolean).join(", ") || undefined}
                meta={<StatusPill label={row.isServiceable ? "Serviceable" : "Not serviceable"} tone={row.isServiceable ? "success" : "danger"} />}
              >
                <MobileCardField label="Zone">{row.zoneName ?? "Automatic"}</MobileCardField>
                <MobileCardField label="COD">{row.codAvailable ? "Yes" : "No"}</MobileCardField>
                <MobileCardField label="Days" numeric>{row.estimatedDays ?? "—"}</MobileCardField>
                {canManage ? <div className="flex justify-end pt-1">{menuFor(row)}</div> : null}
              </MobileCard>
            ))}
          />
          <PaginationBar meta={meta} itemLabel="pincodes" />
        </>
      )}

      {dialogOpen ? <PincodeDialog key={dialogKey} row={editing} zones={zones} open={dialogOpen} onOpenChange={setDialogOpen} /> : null}
      {importOpen ? <PincodeImportDialog open={importOpen} onOpenChange={setImportOpen} /> : null}

      <Dialog open={assignOpen} onOpenChange={(next) => !pending && setAssignOpen(next)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign a zone to {selection.count} pincode{selection.count === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>Pinning a zone overrides prefix and state matching for these pincodes. Choose &quot;Automatic&quot; to clear an assignment.</DialogDescription>
          </DialogHeader>
          <SearchableSelect
            options={[{ value: "__auto", label: "Automatic (clear assignment)" }, ...zones.map((zone) => ({ value: zone.id, label: zone.name, description: zone.isDefault ? "Default" : undefined }))]}
            value={assignZoneId ?? "__auto"}
            onChange={(value) => setAssignZoneId(value === "__auto" ? null : value)}
            placeholder="Pick a zone"
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAssignOpen(false)} disabled={pending}>Cancel</Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={async () => {
                await bulk("assign_zone", assignZoneId);
                setAssignOpen(false);
              }}
            >
              Assign{assignZoneId ? ` to ${zoneById.get(assignZoneId)?.name ?? "zone"}` : " automatic"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
