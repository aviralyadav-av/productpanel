"use client";

import * as React from "react";

import { MANUAL_ORDER_TRANSITIONS, ORDER_STATUS_META, SHIPMENT_STATUS_META, SHIPMENT_TRANSITIONS, type OrderStatus, type ShipmentStatus } from "@/lib/enums";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MoneyInput } from "@/components/shared/money-input";
import { NumberStepper } from "@/components/shared/number-stepper";
import { useActionToast } from "@/components/shared/use-action-toast";

import { createShipmentAction, recordManualPaymentAction, transitionOrderAction, updateShipmentStatusAction } from "../actions";
import { CANCEL_REASONS, MANUAL_PAYMENT_INSTRUMENTS, type ManualPaymentInstrument } from "../schemas";
import type { OrderDetailItem, OrderDetailShipment, PartnerOption } from "../detail-types";

/**
 * The four dialogs the order detail page opens. They are collected in one
 * file because they share the same shape - a small form, one server action,
 * a toast - and because the header and the cards both need to open them; a
 * single import keeps those two call sites honest about which dialog is which.
 */

// ---------------------------------------------------------------------------
// Status change
// ---------------------------------------------------------------------------

export function TransitionDialog({
  orderId,
  fromStatus,
  toStatus,
  open,
  onOpenChange,
}: {
  orderId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { run, pending } = useActionToast();
  const [reason, setReason] = React.useState<string>(CANCEL_REASONS[0]);
  const [note, setNote] = React.useState("");

  if (!toStatus) return null;
  const destructive = toStatus === "CANCELLED" || toStatus === "FAILED";
  const label = ORDER_STATUS_META[toStatus].label;

  const submit = async () => {
    const result = await run(() =>
      transitionOrderAction(orderId, { toStatus, reason: destructive ? reason : undefined, note: note || undefined }),
    );
    if (result.ok) {
      onOpenChange(false);
      setNote("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Move to {label.toLowerCase()}?
          </DialogTitle>
          <DialogDescription>
            {destructive
              ? "Reserved stock is released or restocked, the coupon redemption is handed back, and any money already taken becomes a pending refund."
              : `The order moves from ${ORDER_STATUS_META[fromStatus].label.toLowerCase()} to ${label.toLowerCase()} and the customer timeline records it.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {destructive ? (
            <div className="grid gap-1.5">
              <Label htmlFor="cancel-reason">Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="cancel-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CANCEL_REASONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="transition-note">Internal note (optional)</Label>
            <Textarea id="transition-note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="Anything the next person should know" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={() => void submit()} disabled={pending}>
            {destructive ? `Cancel order` : `Mark ${label.toLowerCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Which statuses this order may be moved to by hand (C2). */
export function manualTargets(status: string): OrderStatus[] {
  return [...(MANUAL_ORDER_TRANSITIONS[status as OrderStatus] ?? [])];
}

// ---------------------------------------------------------------------------
// Record a manual payment (B6)
// ---------------------------------------------------------------------------

export function RecordPaymentDialog({
  orderId,
  outstandingPaise,
  paymentMethod,
  open,
  onOpenChange,
}: {
  orderId: string;
  outstandingPaise: number;
  paymentMethod: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { run, pending } = useActionToast();
  const [amountPaise, setAmountPaise] = React.useState<number | null>(outstandingPaise);
  const [method, setMethod] = React.useState<ManualPaymentInstrument>(paymentMethod === "COD" ? "CASH" : "BANK_TRANSFER");
  const [reference, setReference] = React.useState("");
  const [note, setNote] = React.useState("");

  const submit = async () => {
    const result = await run(() =>
      recordManualPaymentAction(orderId, {
        amountPaise: amountPaise ?? 0,
        method,
        reference: reference || undefined,
        note: note || undefined,
      }),
    );
    if (result.ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            Cash, UPI or a bank transfer received outside the gateway. {formatPaise(outstandingPaise)} is outstanding; more than that is refused - money that should go back is a refund, not a negative payment.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="payment-amount">Amount</Label>
            <MoneyInput id="payment-amount" valuePaise={amountPaise ?? undefined} onChangePaise={setAmountPaise} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="payment-method">Instrument</Label>
            <Select value={method} onValueChange={(next) => setMethod(next as ManualPaymentInstrument)}>
              <SelectTrigger id="payment-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_PAYMENT_INSTRUMENTS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option.toLowerCase().replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="payment-reference">Reference (optional)</Label>
            <Input id="payment-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="UTR, receipt number…" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="payment-note">Note (optional)</Label>
            <Textarea id="payment-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending || !amountPaise}>
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Create a shipment
// ---------------------------------------------------------------------------

export function CreateShipmentDialog({
  orderId,
  items,
  partners,
  open,
  onOpenChange,
}: {
  orderId: string;
  items: OrderDetailItem[];
  partners: PartnerOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { run, pending } = useActionToast();
  const shippable = items.filter((item) => item.unshippedQty > 0);
  const [quantities, setQuantities] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(shippable.map((item) => [item.id, item.unshippedQty])),
  );
  const [partnerId, setPartnerId] = React.useState<string>(partners[0]?.id ?? "");
  const [trackingNumber, setTrackingNumber] = React.useState("");
  const [weightGrams, setWeightGrams] = React.useState("");
  const [costPaise, setCostPaise] = React.useState<number | null>(null);
  const [eta, setEta] = React.useState("");
  const [note, setNote] = React.useState("");
  const [markShipped, setMarkShipped] = React.useState(true);

  const partner = partners.find((row) => row.id === partnerId) ?? null;
  // Mirrors buildTrackingUrl on the server so the operator sees the link the
  // customer will get before they save.
  const previewUrl =
    partner?.trackingUrlTemplate && trackingNumber
      ? partner.trackingUrlTemplate.replace("{tracking}", encodeURIComponent(trackingNumber))
      : null;

  const submit = async () => {
    const lines = shippable
      .map((item) => ({ orderItemId: item.id, quantity: quantities[item.id] ?? 0 }))
      .filter((line) => line.quantity > 0);
    const result = await run(() =>
      createShipmentAction(orderId, {
        items: lines,
        partnerId: partnerId || null,
        trackingNumber: trackingNumber || undefined,
        weightGrams: weightGrams || null,
        costPaise: costPaise ?? undefined,
        estimatedDeliveryAt: eta || null,
        note: note || undefined,
        markShipped,
      }),
    );
    if (result.ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create shipment</DialogTitle>
          <DialogDescription>
            Fulfilment is per shipment: a multi-seller order can go out in parts, each with its own tracking number, and the order status follows the shipments.
          </DialogDescription>
        </DialogHeader>

        {shippable.length === 0 ? (
          <p className="text-muted-foreground text-sm">Every line is already on a shipment.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Lines</Label>
              <div className="divide-y rounded-md border">
                {shippable.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="line-clamp-1 text-xs font-medium">{item.titleSnapshot}</p>
                      <p className="text-muted-foreground text-[11px]">
                        {item.variantSnapshot ?? item.skuSnapshot ?? "—"} · {item.unshippedQty} unshipped
                      </p>
                    </div>
                    <NumberStepper
                      value={quantities[item.id] ?? 0}
                      onChange={(next) => setQuantities((current) => ({ ...current, [item.id]: next }))}
                      min={0}
                      max={item.unshippedQty}
                      size="sm"
                      aria-label={`Units of ${item.titleSnapshot} to ship`}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="shipment-partner">Courier</Label>
                <Select value={partnerId} onValueChange={setPartnerId}>
                  <SelectTrigger id="shipment-partner">
                    <SelectValue placeholder="Pick a partner" />
                  </SelectTrigger>
                  <SelectContent>
                    {partners.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="shipment-tracking">Tracking number</Label>
                <Input id="shipment-tracking" value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="shipment-weight">Weight (g)</Label>
                <Input id="shipment-weight" inputMode="numeric" value={weightGrams} onChange={(event) => setWeightGrams(event.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="shipment-cost">Shipping cost</Label>
                <MoneyInput id="shipment-cost" valuePaise={costPaise ?? undefined} onChangePaise={setCostPaise} allowEmpty />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="shipment-eta">Expected delivery</Label>
                <Input id="shipment-eta" type="date" value={eta} onChange={(event) => setEta(event.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="shipment-note">Note</Label>
                <Input id="shipment-note" value={note} onChange={(event) => setNote(event.target.value)} />
              </div>
            </div>

            {previewUrl ? (
              <p className="text-muted-foreground truncate text-[11px]">Tracking link: {previewUrl}</p>
            ) : null}

            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="shipment-mark">Hand to the courier now</Label>
                <p className="text-muted-foreground text-[11px]">Marks the shipment SHIPPED and emails the customer their tracking link.</p>
              </div>
              <Switch id="shipment-mark" checked={markShipped} onCheckedChange={setMarkShipped} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending || shippable.length === 0}>
            Create shipment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Update a shipment
// ---------------------------------------------------------------------------

/** FAILED_DELIVERY is an event, not a resting state (C2), so it is offered separately. */
export function UpdateShipmentDialog({
  orderId,
  shipment,
  open,
  onOpenChange,
}: {
  orderId: string;
  shipment: OrderDetailShipment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { run, pending } = useActionToast();
  const [toStatus, setToStatus] = React.useState<string>("");
  const [location, setLocation] = React.useState("");
  const [note, setNote] = React.useState("");

  const targets = React.useMemo(() => {
    if (!shipment) return [] as ShipmentStatus[];
    const next = [...(SHIPMENT_TRANSITIONS[shipment.status as ShipmentStatus] ?? [])];
    const inTransit = ["SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(shipment.status);
    return inTransit ? [...next, "FAILED_DELIVERY" as ShipmentStatus] : next;
  }, [shipment]);

  // Derived rather than synced in an effect: when the dialog opens on a
  // different shipment the previous choice is simply no longer in `targets`.
  const selected = toStatus && (targets as string[]).includes(toStatus) ? toStatus : targets[0] ?? "";

  if (!shipment) return null;

  const submit = async () => {
    const result = await run(() =>
      updateShipmentStatusAction(orderId, shipment.id, {
        toStatus: selected as ShipmentStatus,
        location: location || undefined,
        note: note || undefined,
      }),
    );
    if (result.ok) {
      onOpenChange(false);
      setLocation("");
      setNote("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update {shipment.shipmentNumber}</DialogTitle>
          <DialogDescription>
            Currently {SHIPMENT_STATUS_META[shipment.status as ShipmentStatus]?.label.toLowerCase() ?? shipment.status}. Delivering the shipment records COD cash, seller earnings and the delivered email.
          </DialogDescription>
        </DialogHeader>

        {targets.length === 0 ? (
          <p className="text-muted-foreground text-sm">This shipment has reached a final state.</p>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="shipment-status">New status</Label>
              <Select value={toStatus} onValueChange={setToStatus}>
                <SelectTrigger id="shipment-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((status) => (
                    <SelectItem key={status} value={status}>
                      {SHIPMENT_STATUS_META[status]?.label ?? status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="shipment-location">Location (optional)</Label>
              <Input id="shipment-location" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Hub, city…" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="shipment-event-note">Event note (optional)</Label>
              <Textarea id="shipment-event-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending || !toStatus}>
            Save update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
