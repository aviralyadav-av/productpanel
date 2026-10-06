"use client";

import * as React from "react";
import { Calculator, MoreHorizontal, Pencil, Plus, Trash2, Truck } from "lucide-react";

import { deleteRateAction, setRateActiveAction } from "@/features/shipping/actions";
import { QuoteTester } from "@/features/shipping/components/quote-tester";
import { RateDialog, type ZoneOption } from "@/features/shipping/components/rate-dialog";
import type { RateRow } from "@/features/shipping/queries";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs } from "@/components/shared/list-controls";
import { PriceText } from "@/components/shared/price-text";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { SHIPPING_METHOD_META, type ShippingMethod } from "@/lib/enums";
import { formatPaise } from "@/lib/money";

function MethodBadge({ method }: { method: string }) {
  const meta = SHIPPING_METHOD_META[method as ShippingMethod];
  return <StatusPill label={meta?.label ?? method} tone={meta?.tone ?? "neutral"} dot={false} />;
}

function bounds(min: number | null, max: number | null, format: (value: number) => string): string {
  if (min === null && max === null) return "Any";
  if (min !== null && max !== null) return `${format(min)} – ${format(max)}`;
  return min !== null ? `≥ ${format(min)}` : `≤ ${format(max as number)}`;
}

const grams = (value: number) => (value >= 1000 ? `${(value / 1000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg` : `${value} g`);

export function RatesTab({
  rates,
  zones,
  zoneFilter,
  canManage,
}: {
  rates: RateRow[];
  zones: ZoneOption[];
  zoneFilter: string | undefined;
  canManage: boolean;
}) {
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [editing, setEditing] = React.useState<RateRow | null>(null);
  const [dialogKey, setDialogKey] = React.useState(0);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [testerOpen, setTesterOpen] = React.useState(false);

  function openDialog(rate: RateRow | null) {
    setEditing(rate);
    setDialogKey((key) => key + 1);
    setDialogOpen(true);
  }

  async function remove(rate: RateRow) {
    const result = await confirm({
      title: `Delete rate "${rate.name}"?`,
      description: "Existing orders keep their shipping snapshot; new checkouts will no longer see this option.",
      confirmLabel: "Delete rate",
      destructive: true,
    });
    if (!result.ok) return;
    await run(() => deleteRateAction(rate.id));
  }

  const defaultZoneId = zoneFilter ?? zones.find((zone) => zone.isDefault)?.id ?? null;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
      <FilterTabs paramKey="zone" allLabel="All zones" options={zones.map((zone) => ({ value: zone.id, label: zone.name }))} />
      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setTesterOpen(true)}>
          <Calculator /> Test a quote
        </Button>
        {canManage ? (
          <Button size="sm" onClick={() => openDialog(null)} disabled={zones.length === 0}>
            <Plus /> New rate
          </Button>
        ) : null}
      </div>
    </div>
  );

  const menuFor = (rate: RateRow) =>
    canManage ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${rate.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => openDialog(rate)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => remove(rate)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const toggleFor = (rate: RateRow) => (
    <Switch
      size="sm"
      checked={rate.isActive}
      disabled={!canManage || pending}
      aria-label={`${rate.isActive ? "Disable" : "Enable"} ${rate.name}`}
      onCheckedChange={(checked) => run(() => setRateActiveAction(rate.id, checked))}
    />
  );

  return (
    <div className="surface">
      {toolbar}
      {rates.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={zoneFilter ? "No rates in this zone" : "No shipping rates yet"}
          description={
            zones.length === 0
              ? "Create a zone first; rates belong to zones."
              : "Without an active rate a zone is not serviceable. Add a Standard rate first, then Express or Same day if you offer them."
          }
          action={canManage && zones.length > 0 ? <Button size="sm" onClick={() => openDialog(null)}><Plus /> New rate</Button> : undefined}
        />
      ) : (
        <ResponsiveTable
          table={
            <DataTable>
              <DataTableHead>
                <Th>Zone</Th>
                <Th>Rate</Th>
                <Th>Method</Th>
                <Th align="right">Price</Th>
                <Th align="right">Free above</Th>
                <Th>Weight</Th>
                <Th>Order value</Th>
                <Th>COD</Th>
                <Th>Estimate</Th>
                <Th>Active</Th>
                {canManage ? <Th align="right" width="3rem"><span className="sr-only">Actions</span></Th> : null}
              </DataTableHead>
              <DataTableBody>
                {rates.map((rate) => (
                  <Tr key={rate.id}>
                    <Td className="text-muted-foreground">{rate.zoneName}</Td>
                    <Td className="font-medium">{rate.name}</Td>
                    <Td><MethodBadge method={rate.method} /></Td>
                    <Td align="right" numeric><PriceText paise={rate.ratePaise} /></Td>
                    <Td align="right" numeric>{rate.freeAbovePaise === null ? <span className="text-muted-foreground">Store default</span> : <PriceText paise={rate.freeAbovePaise} />}</Td>
                    <Td numeric>{bounds(rate.minWeightGrams, rate.maxWeightGrams, grams)}</Td>
                    <Td numeric>{bounds(rate.minOrderPaise, rate.maxOrderPaise, formatPaise)}</Td>
                    <Td>
                      {rate.codAvailable ? (
                        <span className="text-xs" data-numeric>Yes{rate.codFeePaise > 0 ? ` · ${formatPaise(rate.codFeePaise)}` : " · store fee"}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">No</span>
                      )}
                    </Td>
                    <Td numeric>{rate.estimatedDaysMin}–{rate.estimatedDaysMax} days</Td>
                    <Td>{toggleFor(rate)}</Td>
                    {canManage ? <Td align="right">{menuFor(rate)}</Td> : null}
                  </Tr>
                ))}
              </DataTableBody>
            </DataTable>
          }
          cards={rates.map((rate) => (
            <MobileCard key={rate.id} title={rate.name} subtitle={rate.zoneName} meta={<MethodBadge method={rate.method} />}>
              <MobileCardField label="Price" numeric>{formatPaise(rate.ratePaise)}</MobileCardField>
              <MobileCardField label="Free above" numeric>{rate.freeAbovePaise === null ? "Store default" : formatPaise(rate.freeAbovePaise)}</MobileCardField>
              <MobileCardField label="Weight" numeric>{bounds(rate.minWeightGrams, rate.maxWeightGrams, grams)}</MobileCardField>
              <MobileCardField label="Order value" numeric>{bounds(rate.minOrderPaise, rate.maxOrderPaise, formatPaise)}</MobileCardField>
              <MobileCardField label="Estimate" numeric>{rate.estimatedDaysMin}–{rate.estimatedDaysMax} days</MobileCardField>
              <MobileCardField label="COD">{rate.codAvailable ? "Yes" : "No"}</MobileCardField>
              <div className="flex items-center justify-between pt-1">
                {toggleFor(rate)}
                {menuFor(rate)}
              </div>
            </MobileCard>
          ))}
        />
      )}

      {dialogOpen ? <RateDialog key={dialogKey} rate={editing} zones={zones} defaultZoneId={defaultZoneId} open={dialogOpen} onOpenChange={setDialogOpen} /> : null}
      {testerOpen ? <QuoteTester open={testerOpen} onOpenChange={setTesterOpen} /> : null}
      {confirmDialog}
    </div>
  );
}
