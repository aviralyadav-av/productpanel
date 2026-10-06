"use client";

import * as React from "react";
import { ExternalLink, MoreHorizontal, Pencil, Plus, Trash2, Truck } from "lucide-react";

import { deletePartnerAction, setPartnerActiveAction } from "@/features/shipping/actions";
import { PartnerDialog } from "@/features/shipping/components/partner-dialog";
import type { PartnerRow } from "@/features/shipping/queries";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";

export function PartnersTab({ partners, canManage }: { partners: PartnerRow[]; canManage: boolean }) {
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [editing, setEditing] = React.useState<PartnerRow | null>(null);
  const [dialogKey, setDialogKey] = React.useState(0);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  function openDialog(partner: PartnerRow | null) {
    setEditing(partner);
    setDialogKey((key) => key + 1);
    setDialogOpen(true);
  }

  async function remove(partner: PartnerRow) {
    const references = partner.shipmentCount + partner.returnPickupCount;
    const result = await confirm({
      title: references > 0 ? `Cannot delete "${partner.name}"` : `Delete partner "${partner.name}"?`,
      description:
        references > 0
          ? `${partner.shipmentCount} shipment${partner.shipmentCount === 1 ? "" : "s"}${partner.returnPickupCount ? ` and ${partner.returnPickupCount} return pickup${partner.returnPickupCount === 1 ? "" : "s"}` : ""} reference this partner. Disable it instead so history keeps its carrier.`
          : "No shipments reference this partner, so it can be removed cleanly.",
      confirmLabel: references > 0 ? "OK" : "Delete partner",
      destructive: references === 0,
    });
    if (!result.ok || references > 0) return;
    await run(() => deletePartnerAction(partner.id));
  }

  const toggleFor = (partner: PartnerRow) => (
    <Switch
      size="sm"
      checked={partner.isActive}
      disabled={!canManage || pending}
      aria-label={`${partner.isActive ? "Disable" : "Enable"} ${partner.name}`}
      onCheckedChange={(checked) => run(() => setPartnerActiveAction(partner.id, checked))}
    />
  );

  const menuFor = (partner: PartnerRow) =>
    canManage ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${partner.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => openDialog(partner)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => remove(partner)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const contacts = (partner: PartnerRow) => {
    const parts = [partner.phone, partner.email].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "—";
  };

  return (
    <div className="surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <p className="text-muted-foreground text-xs">
          {partners.length} partner{partners.length === 1 ? "" : "s"} · tracking links are built from the template with the shipment&apos;s tracking number
        </p>
        {canManage ? (
          <Button size="sm" onClick={() => openDialog(null)}>
            <Plus /> New partner
          </Button>
        ) : null}
      </div>

      {partners.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No shipping partners yet"
          description="Add the couriers you ship with so shipments can carry a carrier and a tracking link."
          action={canManage ? <Button size="sm" onClick={() => openDialog(null)}><Plus /> New partner</Button> : undefined}
        />
      ) : (
        <ResponsiveTable
          table={
            <DataTable>
              <DataTableHead>
                <Th>Partner</Th>
                <Th>Code</Th>
                <Th>Tracking URL template</Th>
                <Th>Contacts</Th>
                <Th>Website</Th>
                <Th align="right">Shipments</Th>
                <Th>Active</Th>
                {canManage ? <Th align="right" width="3rem"><span className="sr-only">Actions</span></Th> : null}
              </DataTableHead>
              <DataTableBody>
                {partners.map((partner) => (
                  <Tr key={partner.id}>
                    <Td className="font-medium">{partner.name}</Td>
                    <Td><code className="font-mono text-xs">{partner.code}</code></Td>
                    <Td>
                      {partner.trackingUrlTemplate ? (
                        <code className="text-muted-foreground block max-w-xs truncate font-mono text-[11px]" title={partner.trackingUrlTemplate}>
                          {partner.trackingUrlTemplate}
                        </code>
                      ) : (
                        <span className="text-muted-foreground text-xs">No tracking link</span>
                      )}
                    </Td>
                    <Td className="text-xs">{contacts(partner)}</Td>
                    <Td>
                      {partner.website ? (
                        <a href={partner.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs underline">
                          {partner.website.replace(/^https?:\/\//, "")} <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </Td>
                    <Td align="right" numeric>{partner.shipmentCount}</Td>
                    <Td>{toggleFor(partner)}</Td>
                    {canManage ? <Td align="right">{menuFor(partner)}</Td> : null}
                  </Tr>
                ))}
              </DataTableBody>
            </DataTable>
          }
          cards={partners.map((partner) => (
            <MobileCard key={partner.id} title={partner.name} subtitle={partner.code} meta={toggleFor(partner)}>
              <MobileCardField label="Tracking">{partner.trackingUrlTemplate ? <span className="block truncate font-mono text-[11px]">{partner.trackingUrlTemplate}</span> : "—"}</MobileCardField>
              <MobileCardField label="Contacts">{contacts(partner)}</MobileCardField>
              <MobileCardField label="Shipments" numeric>{partner.shipmentCount}</MobileCardField>
              {canManage ? <div className="flex justify-end pt-1">{menuFor(partner)}</div> : null}
            </MobileCard>
          ))}
        />
      )}

      {dialogOpen ? <PartnerDialog key={dialogKey} partner={editing} open={dialogOpen} onOpenChange={setDialogOpen} /> : null}
      {confirmDialog}
    </div>
  );
}
