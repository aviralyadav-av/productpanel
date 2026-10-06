"use client";

import * as React from "react";
import { ExternalLink, PackagePlus, Truck, Undo2 } from "lucide-react";

import { SHIPMENT_STATUS_META, type ShipmentStatus } from "@/lib/enums";
import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-badge";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { useActionToast } from "@/components/shared/use-action-toast";

import { rtoReceivedAction } from "../actions";
import type { OrderDetailItem, OrderDetailShipment, PartnerOption } from "../detail-types";
import { CreateShipmentDialog, UpdateShipmentDialog } from "./order-dialogs";

/**
 * Shipments and their event trail (§14.C1, C2, C8).
 *
 * "RTO received" is a separate, explicit action rather than a status option:
 * receiving a parcel back restocks the units and can create a refund, and
 * that should never happen because someone picked the wrong entry from a
 * dropdown.
 */
export function OrderShipmentsCard({
  orderId,
  shipments,
  items,
  partners,
  canShip,
}: {
  orderId: string;
  shipments: OrderDetailShipment[];
  items: OrderDetailItem[];
  partners: PartnerOption[];
  canShip: boolean;
}) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [updating, setUpdating] = React.useState<OrderDetailShipment | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const { run, pending } = useActionToast();

  const shippable = items.some((item) => item.unshippedQty > 0);

  const receiveRto = async (shipment: OrderDetailShipment) => {
    const result = await confirm({
      title: `Receive ${shipment.shipmentNumber} back?`,
      description:
        "The units return to stock, the lines are cancelled and anything paid becomes a pending refund. No seller earnings are recorded for a returned parcel.",
      confirmLabel: "Mark received",
      destructive: true,
      requireReason: { label: "Note", placeholder: "Condition of the parcel, courier reference…" },
    });
    if (!result.ok) return;
    await run(() => rtoReceivedAction(orderId, shipment.id, result.reason));
  };

  return (
    <section className="surface overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <h2 className="text-xs font-semibold tracking-tight">Shipments</h2>
        {canShip && shippable ? (
          <Button size="xs" variant="outline" onClick={() => setCreateOpen(true)}>
            <PackagePlus /> New shipment
          </Button>
        ) : null}
      </header>

      {shipments.length === 0 ? (
        <EmptyState
          compact
          icon={Truck}
          title="Nothing shipped yet"
          description={shippable ? "Create a shipment for some or all lines when the parcel is ready." : "Every line is accounted for."}
        />
      ) : (
        <ul className="divide-y">
          {shipments.map((shipment) => {
            const meta = SHIPMENT_STATUS_META[shipment.status as ShipmentStatus];
            return (
              <li key={shipment.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{shipment.shipmentNumber}</span>
                    <StatusPill label={meta?.label ?? shipment.status} tone={meta?.tone ?? "neutral"} />
                    {shipment.carrierName ? <span className="text-muted-foreground text-[11px]">{shipment.carrierName}</span> : null}
                  </div>
                  {canShip ? (
                    <div className="flex items-center gap-1">
                      {shipment.status === "RETURNED_TO_ORIGIN" ? (
                        <Button size="xs" variant="outline" disabled={pending} onClick={() => void receiveRto(shipment)}>
                          <Undo2 /> RTO received
                        </Button>
                      ) : null}
                      <Button size="xs" variant="ghost" onClick={() => setUpdating(shipment)}>
                        Update
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="text-muted-foreground grid gap-x-4 gap-y-0.5 text-[11px] sm:grid-cols-2">
                  {shipment.trackingNumber ? (
                    <span>
                      Tracking{" "}
                      {shipment.trackingUrl ? (
                        <a href={shipment.trackingUrl} target="_blank" rel="noreferrer" className="text-brand inline-flex items-center gap-1 hover:underline">
                          {shipment.trackingNumber} <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="font-mono">{shipment.trackingNumber}</span>
                      )}
                    </span>
                  ) : null}
                  {shipment.estimatedDeliveryAt ? <span>ETA {formatIstDate(shipment.estimatedDeliveryAt)}</span> : null}
                  {shipment.weightGrams ? <span>{shipment.weightGrams} g</span> : null}
                  {shipment.costPaise > 0 ? <span>Cost {formatPaise(shipment.costPaise)}</span> : null}
                </div>

                <ul className="text-xs">
                  {shipment.items.map((line) => (
                    <li key={line.orderItemId} className="text-muted-foreground">
                      {line.quantity} × {line.title}
                      {line.variant ? ` (${line.variant})` : ""}
                    </li>
                  ))}
                </ul>

                {shipment.events.length > 0 ? (
                  <ol className="border-l pl-3 text-[11px]">
                    {shipment.events.map((event) => (
                      <li key={event.id} className="text-muted-foreground py-0.5">
                        <span className="text-foreground font-medium">{SHIPMENT_STATUS_META[event.status as ShipmentStatus]?.label ?? event.status}</span>
                        {event.location ? ` · ${event.location}` : ""}
                        {event.message ? ` — ${event.message}` : ""}
                        <span className="ml-1">{formatIstDateTime(event.occurredAt)}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <CreateShipmentDialog orderId={orderId} items={items} partners={partners} open={createOpen} onOpenChange={setCreateOpen} />
      <UpdateShipmentDialog
        orderId={orderId}
        shipment={updating}
        open={updating !== null}
        onOpenChange={(open) => {
          if (!open) setUpdating(null);
        }}
      />
      {confirmDialog}
    </section>
  );
}
