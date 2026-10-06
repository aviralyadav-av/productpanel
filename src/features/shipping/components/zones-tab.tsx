"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowDown, ArrowUp, Globe2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

import { deleteZoneAction, reorderZonesAction } from "@/features/shipping/actions";
import { ZoneDialog } from "@/features/shipping/components/zone-dialog";
import { stateName } from "@/features/shipping/india";
import type { ZoneRow } from "@/features/shipping/queries";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** Shows up to `max` chips and a "+n" tail so a 20-state zone stays one line. */
function Chips({ values, max = 4, render = (value: string) => value }: { values: string[]; max?: number; render?: (value: string) => string }) {
  if (values.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
  const shown = values.slice(0, max);
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((value) => (
        <Badge key={value} variant="secondary" className="font-normal">
          {render(value)}
        </Badge>
      ))}
      {values.length > max ? (
        <Badge variant="outline" className="font-normal" title={values.slice(max).map(render).join(", ")}>
          +{values.length - max}
        </Badge>
      ) : null}
    </span>
  );
}

export function ZonesTab({ zones, canManage }: { zones: ZoneRow[]; canManage: boolean }) {
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [editing, setEditing] = React.useState<ZoneRow | null>(null);
  const [dialogKey, setDialogKey] = React.useState(0);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  function openDialog(zone: ZoneRow | null) {
    setEditing(zone);
    setDialogKey((key) => key + 1);
    setDialogOpen(true);
  }

  async function remove(zone: ZoneRow) {
    const blocked = zone.isDefault
      ? "This is the default zone. Make another zone the default first."
      : zone.rateCount > 0
        ? `"${zone.name}" still has ${zone.rateCount} rate${zone.rateCount === 1 ? "" : "s"}. Delete or move them first.`
        : null;
    const result = await confirm({
      title: blocked ? `Cannot delete "${zone.name}"` : `Delete zone "${zone.name}"?`,
      description: blocked ?? `${zone.pincodeCount} pincode${zone.pincodeCount === 1 ? "" : "s"} assigned to it will fall back to prefix, state or default resolution.`,
      confirmLabel: blocked ? "OK" : "Delete zone",
      destructive: !blocked,
    });
    if (!result.ok || blocked) return;
    await run(() => deleteZoneAction(zone.id));
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= zones.length) return;
    const ids = zones.map((zone) => zone.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await run(() => reorderZonesAction(ids), { silent: true });
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
      <p className="text-muted-foreground text-xs">
        {zones.length} zone{zones.length === 1 ? "" : "s"} · resolution order: assigned → longest prefix → state → default
      </p>
      {canManage ? (
        <Button size="sm" onClick={() => openDialog(null)}>
          <Plus /> New zone
        </Button>
      ) : null}
    </div>
  );

  if (zones.length === 0) {
    return (
      <div className="surface">
        {header}
        <EmptyState
          icon={Globe2}
          title="No shipping zones yet"
          description="Create a default zone first - every pincode you have not excluded falls back to it - then add rates to it."
          action={canManage ? <Button size="sm" onClick={() => openDialog(null)}><Plus /> Create the default zone</Button> : undefined}
        />
        {dialogOpen ? <ZoneDialog key={dialogKey} zone={editing} open={dialogOpen} onOpenChange={setDialogOpen} isFirstZone /> : null}
      </div>
    );
  }

  const actionsFor = (zone: ZoneRow, index: number) =>
    canManage ? (
      <div className="flex items-center justify-end gap-0.5">
        <Button variant="ghost" size="icon-xs" aria-label="Move up" disabled={pending || index === 0} onClick={() => move(index, -1)}>
          <ArrowUp />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Move down" disabled={pending || index === zones.length - 1} onClick={() => move(index, 1)}>
          <ArrowDown />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${zone.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => openDialog(zone)}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/admin/shipping?tab=rates&zone=${zone.id}` as Route}>View rates</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => remove(zone)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    ) : null;

  return (
    <div className="surface">
      {header}
      <ResponsiveTable
        table={
          <DataTable>
            <DataTableHead>
              <Th>Zone</Th>
              <Th>States / UTs</Th>
              <Th>Prefixes</Th>
              <Th>Countries</Th>
              <Th align="right">Rates</Th>
              <Th align="right">Pincodes</Th>
              <Th>Status</Th>
              {canManage ? <Th align="right" width="7rem">Actions</Th> : null}
            </DataTableHead>
            <DataTableBody>
              {zones.map((zone, index) => (
                <Tr key={zone.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{zone.name}</span>
                      {zone.isDefault ? <StatusPill label="Default" tone="brand" dot={false} /> : null}
                    </div>
                    {zone.description ? <p className="text-muted-foreground mt-0.5 max-w-xs truncate text-xs">{zone.description}</p> : null}
                  </Td>
                  <Td><Chips values={zone.states} render={(code) => stateName(code) ?? code} /></Td>
                  <Td><Chips values={zone.pincodePrefixes} max={6} /></Td>
                  <Td><Chips values={zone.countries} /></Td>
                  <Td align="right" numeric>
                    <Link href={`/admin/shipping?tab=rates&zone=${zone.id}` as Route} className="hover:underline">{zone.rateCount}</Link>
                  </Td>
                  <Td align="right" numeric>
                    <Link href={`/admin/shipping?tab=pincodes&zone=${zone.id}` as Route} className="hover:underline">{zone.pincodeCount}</Link>
                  </Td>
                  <Td>
                    <StatusPill label={zone.isActive ? "Active" : "Inactive"} tone={zone.isActive ? "success" : "neutral"} />
                  </Td>
                  {canManage ? <Td align="right">{actionsFor(zone, index)}</Td> : null}
                </Tr>
              ))}
            </DataTableBody>
          </DataTable>
        }
        cards={zones.map((zone, index) => (
          <MobileCard
            key={zone.id}
            title={zone.name}
            subtitle={zone.description ?? undefined}
            meta={<StatusPill label={zone.isDefault ? "Default" : zone.isActive ? "Active" : "Inactive"} tone={zone.isDefault ? "brand" : zone.isActive ? "success" : "neutral"} />}
          >
            <MobileCardField label="States"><Chips values={zone.states} render={(code) => stateName(code) ?? code} /></MobileCardField>
            <MobileCardField label="Prefixes"><Chips values={zone.pincodePrefixes} max={6} /></MobileCardField>
            <MobileCardField label="Rates" numeric>{zone.rateCount}</MobileCardField>
            <MobileCardField label="Pincodes" numeric>{zone.pincodeCount}</MobileCardField>
            {canManage ? <div className="pt-1">{actionsFor(zone, index)}</div> : null}
          </MobileCard>
        ))}
      />
      {dialogOpen ? <ZoneDialog key={dialogKey} zone={editing} open={dialogOpen} onOpenChange={setDialogOpen} isFirstZone={false} /> : null}
      {confirmDialog}
    </div>
  );
}
