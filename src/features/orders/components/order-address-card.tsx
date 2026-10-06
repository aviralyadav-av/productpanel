"use client";

import * as React from "react";
import { Check, MapPin, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActionToast } from "@/components/shared/use-action-toast";

import { updateOrderAddressAction } from "../actions";
import type { OrderAddressView } from "../detail-types";

/**
 * Shipping and billing addresses, editable until the parcel leaves (the
 * courier label is printed from this row, so an edit after dispatch would be
 * a lie). The PIN code is checked against serviceability as the operator
 * types, because a corrected address that we cannot deliver to is not a
 * correction.
 */

type Serviceability = { serviceable: boolean; codAvailable: boolean; city: string | null; state: string | null; estimatedDays: number } | null;

function AddressLines({ address }: { address: OrderAddressView }) {
  return (
    <address className="text-xs not-italic leading-relaxed">
      <span className="font-medium">{address.fullName}</span>
      <br />
      {address.line1}
      {address.line2 ? (
        <>
          <br />
          {address.line2}
        </>
      ) : null}
      {address.landmark ? (
        <>
          <br />
          <span className="text-muted-foreground">{address.landmark}</span>
        </>
      ) : null}
      <br />
      {address.city}, {address.state} {address.pinCode}
      <br />
      {address.country}
      <br />
      <span className="text-muted-foreground">
        {address.phone}
        {address.email ? ` · ${address.email}` : ""}
      </span>
    </address>
  );
}

function AddressDialog({
  orderId,
  type,
  address,
  open,
  onOpenChange,
}: {
  orderId: string;
  type: "SHIPPING" | "BILLING";
  address: OrderAddressView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { run, pending } = useActionToast();
  const [values, setValues] = React.useState(() => ({
    fullName: address?.fullName ?? "",
    phone: address?.phone ?? "",
    email: address?.email ?? "",
    line1: address?.line1 ?? "",
    line2: address?.line2 ?? "",
    landmark: address?.landmark ?? "",
    city: address?.city ?? "",
    state: address?.state ?? "",
    pinCode: address?.pinCode ?? "",
    country: address?.country ?? "IN",
  }));
  const [check, setCheck] = React.useState<Serviceability>(null);

  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  const pin = values.pinCode.trim();
  React.useEffect(() => {
    let cancelled = false;
    // The reset lives inside the timer so nothing sets state synchronously
    // while the effect body runs.
    const timer = setTimeout(async () => {
      if (pin.length !== 6) {
        if (!cancelled) setCheck(null);
        return;
      }
      try {
        const response = await fetch(`/api/v1/shipping/pincode/${pin}`);
        if (!response.ok) return;
        const body = (await response.json()) as { data?: Serviceability };
        if (!cancelled) setCheck(body.data ?? null);
      } catch {
        // A failed serviceability check must never block an address edit.
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pin]);

  const submit = async () => {
    const result = await run(() => updateOrderAddressAction(orderId, { ...values, type }));
    if (result.ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {type === "SHIPPING" ? "shipping" : "billing"} address</DialogTitle>
          <DialogDescription>The change is recorded on the order timeline and in the audit log.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="addr-name">Recipient</Label>
            <Input id="addr-name" value={values.fullName} onChange={set("fullName")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="addr-phone">Phone</Label>
            <Input id="addr-phone" value={values.phone} onChange={set("phone")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="addr-email">Email</Label>
            <Input id="addr-email" value={values.email} onChange={set("email")} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="addr-line1">Address line 1</Label>
            <Input id="addr-line1" value={values.line1} onChange={set("line1")} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="addr-line2">Address line 2</Label>
            <Input id="addr-line2" value={values.line2} onChange={set("line2")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="addr-landmark">Landmark</Label>
            <Input id="addr-landmark" value={values.landmark} onChange={set("landmark")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="addr-pin">PIN code</Label>
            <Input id="addr-pin" inputMode="numeric" value={values.pinCode} onChange={set("pinCode")} />
            {check ? (
              <p className={check.serviceable ? "text-success text-[11px]" : "text-destructive text-[11px]"}>
                {check.serviceable
                  ? `Serviceable${check.city ? ` · ${check.city}` : ""} · ${check.estimatedDays} day${check.estimatedDays === 1 ? "" : "s"}${check.codAvailable ? " · COD" : ""}`
                  : "We do not deliver to this PIN code."}
              </p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="addr-city">City</Label>
            <Input id="addr-city" value={values.city} onChange={set("city")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="addr-state">State</Label>
            <Input id="addr-state" value={values.state} onChange={set("state")} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending}>
            <Check /> Save address
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OrderAddressesCard({
  orderId,
  shippingAddress,
  billingAddress,
  canEditShipping,
  canEditBilling,
}: {
  orderId: string;
  shippingAddress: OrderAddressView | null;
  billingAddress: OrderAddressView | null;
  canEditShipping: boolean;
  canEditBilling: boolean;
}) {
  const [editing, setEditing] = React.useState<"SHIPPING" | "BILLING" | null>(null);

  return (
    <section className="surface overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <h2 className="text-xs font-semibold tracking-tight">Addresses</h2>
        <MapPin className="text-muted-foreground size-3.5" />
      </header>
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">Shipping</h3>
            {canEditShipping && shippingAddress ? (
              <Button size="icon-xs" variant="ghost" aria-label="Edit shipping address" onClick={() => setEditing("SHIPPING")}>
                <Pencil />
              </Button>
            ) : null}
          </div>
          {shippingAddress ? <AddressLines address={shippingAddress} /> : <p className="text-muted-foreground text-xs">Not recorded.</p>}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">Billing</h3>
            {canEditBilling && billingAddress ? (
              <Button size="icon-xs" variant="ghost" aria-label="Edit billing address" onClick={() => setEditing("BILLING")}>
                <Pencil />
              </Button>
            ) : null}
          </div>
          {billingAddress ? <AddressLines address={billingAddress} /> : <p className="text-muted-foreground text-xs">Same as shipping.</p>}
        </div>
      </div>

      {editing ? (
        <AddressDialog
          key={editing}
          orderId={orderId}
          type={editing}
          address={editing === "SHIPPING" ? shippingAddress : billingAddress}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      ) : null}
    </section>
  );
}
