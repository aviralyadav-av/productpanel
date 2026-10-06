"use client";

import * as React from "react";

import { createRateAction, updateRateAction } from "@/features/shipping/actions";
import type { RateRow } from "@/features/shipping/queries";
import { MAX_ESTIMATE_DAYS, SHIPPING_METHODS } from "@/features/shipping/schemas";
import { SearchableSelect } from "@/components/shared/combobox";
import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormRowGroup } from "@/components/shared/form-layout";
import { MoneyInput } from "@/components/shared/money-input";
import { NumberStepper } from "@/components/shared/number-stepper";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SHIPPING_METHOD_META, type ShippingMethod } from "@/lib/enums";

export type ZoneOption = { id: string; name: string; isDefault: boolean; isActive: boolean };

/** "" ↔ null for optional integer bounds typed into a plain input. */
function OptionalInt({ id, value, onChange, max, unit }: { id: string; value: number | null; onChange: (value: number | null) => void; max: number; unit: string }) {
  return (
    <div className="relative">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        step={1}
        value={value ?? ""}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === "" ? null : Math.max(0, Math.floor(Number(raw))));
        }}
        placeholder="Any"
        className="pr-10"
      />
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs">{unit}</span>
    </div>
  );
}

export function RateDialog({
  rate,
  zones,
  defaultZoneId,
  open,
  onOpenChange,
}: {
  rate: RateRow | null;
  zones: ZoneOption[];
  /** Pre-selected zone for a new rate (the current zone filter, or the default zone). */
  defaultZoneId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { pending, run } = useActionToast();
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const [zoneId, setZoneId] = React.useState<string | null>(rate?.zoneId ?? defaultZoneId ?? zones[0]?.id ?? null);
  const [name, setName] = React.useState(rate?.name ?? "");
  const [method, setMethod] = React.useState<ShippingMethod>((rate?.method as ShippingMethod) ?? "STANDARD");
  const [ratePaise, setRatePaise] = React.useState<number | null>(rate?.ratePaise ?? 0);
  const [freeAbovePaise, setFreeAbovePaise] = React.useState<number | null>(rate?.freeAbovePaise ?? null);
  const [minWeight, setMinWeight] = React.useState<number | null>(rate?.minWeightGrams ?? null);
  const [maxWeight, setMaxWeight] = React.useState<number | null>(rate?.maxWeightGrams ?? null);
  const [minOrder, setMinOrder] = React.useState<number | null>(rate?.minOrderPaise ?? null);
  const [maxOrder, setMaxOrder] = React.useState<number | null>(rate?.maxOrderPaise ?? null);
  const [codAvailable, setCodAvailable] = React.useState(rate?.codAvailable ?? true);
  const [codFeePaise, setCodFeePaise] = React.useState<number | null>(rate?.codFeePaise ?? 0);
  const [daysMin, setDaysMin] = React.useState(rate?.estimatedDaysMin ?? 3);
  const [daysMax, setDaysMax] = React.useState(rate?.estimatedDaysMax ?? 7);
  const [isActive, setIsActive] = React.useState(rate?.isActive ?? true);
  const [position, setPosition] = React.useState(rate?.position ?? 0);

  // Same checks the server runs, surfaced before the round trip.
  const localErrors: Record<string, string> = {};
  if (minWeight !== null && maxWeight !== null && minWeight > maxWeight) localErrors.maxWeightGrams = "Maximum weight must be at least the minimum.";
  if (minOrder !== null && maxOrder !== null && minOrder > maxOrder) localErrors.maxOrderPaise = "Maximum order value must be at least the minimum.";
  if (daysMin > daysMax) localErrors.estimatedDaysMax = "Latest estimate must be at least the earliest.";
  const shown = { ...localErrors, ...errors };

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (Object.keys(localErrors).length > 0 || !zoneId) return;
    setErrors({});
    const input = {
      zoneId,
      name,
      method,
      ratePaise: ratePaise ?? 0,
      freeAbovePaise,
      minWeightGrams: minWeight,
      maxWeightGrams: maxWeight,
      minOrderPaise: minOrder,
      maxOrderPaise: maxOrder,
      codAvailable,
      codFeePaise: codFeePaise ?? 0,
      estimatedDaysMin: daysMin,
      estimatedDaysMax: daysMax,
      isActive,
      position,
    };
    const result = await run(() => (rate ? updateRateAction(rate.id, input) : createRateAction(input)), {
      onSuccess: () => onOpenChange(false),
    });
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{rate ? `Edit rate: ${rate.name}` : "New shipping rate"}</DialogTitle>
          <DialogDescription>
            A rate applies when the basket weight and order value fall inside its bounds. Leave a bound empty for no limit. Free-above on the rate overrides the store-wide setting (B7).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormRowGroup columns={2}>
            <FormRow label="Zone" htmlFor="rate-zone" required error={shown.zoneId}>
              <SearchableSelect
                id="rate-zone"
                options={zones.map((zone) => ({ value: zone.id, label: zone.name, description: zone.isDefault ? "Default" : zone.isActive ? undefined : "Inactive" }))}
                value={zoneId}
                onChange={setZoneId}
                placeholder="Pick a zone"
              />
            </FormRow>
            <FormRow label="Method" htmlFor="rate-method" required error={shown.method}>
              <SearchableSelect
                id="rate-method"
                searchable={false}
                options={SHIPPING_METHODS.map((value) => ({ value, label: SHIPPING_METHOD_META[value].label }))}
                value={method}
                onChange={(value) => value && setMethod(value as ShippingMethod)}
              />
            </FormRow>
          </FormRowGroup>

          <FormRow label="Name" htmlFor="rate-name" required hint="Shown to shoppers at checkout, e.g. “Standard delivery”." error={shown.name}>
            <Input id="rate-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
          </FormRow>

          <FormRowGroup columns={2}>
            <FormRow label="Price" htmlFor="rate-price" required error={shown.ratePaise}>
              <MoneyInput id="rate-price" valuePaise={ratePaise} onChangePaise={setRatePaise} allowEmpty={false} required />
            </FormRow>
            <FormRow label="Free above" htmlFor="rate-free-above" hint="Order subtotal after discounts. Empty = use the store setting." error={shown.freeAbovePaise}>
              <MoneyInput id="rate-free-above" valuePaise={freeAbovePaise} onChangePaise={setFreeAbovePaise} placeholder="Store default" />
            </FormRow>
          </FormRowGroup>

          <FormRowGroup columns={2}>
            <FormRow label="Minimum weight" htmlFor="rate-min-weight" error={shown.minWeightGrams}>
              <OptionalInt id="rate-min-weight" value={minWeight} onChange={setMinWeight} max={1_000_000} unit="g" />
            </FormRow>
            <FormRow label="Maximum weight" htmlFor="rate-max-weight" error={shown.maxWeightGrams}>
              <OptionalInt id="rate-max-weight" value={maxWeight} onChange={setMaxWeight} max={1_000_000} unit="g" />
            </FormRow>
          </FormRowGroup>

          <FormRowGroup columns={2}>
            <FormRow label="Minimum order value" htmlFor="rate-min-order" error={shown.minOrderPaise}>
              <MoneyInput id="rate-min-order" valuePaise={minOrder} onChangePaise={setMinOrder} placeholder="Any" />
            </FormRow>
            <FormRow label="Maximum order value" htmlFor="rate-max-order" error={shown.maxOrderPaise}>
              <MoneyInput id="rate-max-order" valuePaise={maxOrder} onChangePaise={setMaxOrder} placeholder="Any" />
            </FormRow>
          </FormRowGroup>

          <FormRowGroup columns={2}>
            <FormRow label="Earliest delivery" htmlFor="rate-days-min" hint="Days after dispatch." error={shown.estimatedDaysMin}>
              <NumberStepper id="rate-days-min" value={daysMin} onChange={setDaysMin} min={0} max={MAX_ESTIMATE_DAYS} aria-label="Earliest delivery in days" />
            </FormRow>
            <FormRow label="Latest delivery" htmlFor="rate-days-max" hint="Used for the estimated delivery date." error={shown.estimatedDaysMax}>
              <NumberStepper id="rate-days-max" value={daysMax} onChange={setDaysMax} min={0} max={MAX_ESTIMATE_DAYS} aria-label="Latest delivery in days" />
            </FormRow>
          </FormRowGroup>

          <FormRow label="Cash on delivery" htmlFor="rate-cod" inline hint="Also needs COD enabled in Settings and allowed for the pincode." error={shown.codAvailable}>
            <Switch id="rate-cod" checked={codAvailable} onCheckedChange={setCodAvailable} />
          </FormRow>

          {codAvailable ? (
            <FormRow label="COD fee" htmlFor="rate-cod-fee" hint="₹0 = use the store-wide COD fee. Never waived by free shipping." error={shown.codFeePaise}>
              <MoneyInput id="rate-cod-fee" valuePaise={codFeePaise} onChangePaise={setCodFeePaise} allowEmpty={false} />
            </FormRow>
          ) : null}

          <FormRowGroup columns={2}>
            <FormRow label="Active" htmlFor="rate-active" inline hint="Inactive rates are never quoted." error={shown.isActive}>
              <Switch id="rate-active" checked={isActive} onCheckedChange={setIsActive} />
            </FormRow>
            <FormRow label="Position" htmlFor="rate-position" hint="Order at checkout." error={shown.position}>
              <NumberStepper id="rate-position" value={position} onChange={setPosition} min={0} max={100000} aria-label="Position" />
            </FormRow>
          </FormRowGroup>

          <FormActions
            dirty
            pending={pending}
            disabled={!zoneId || Object.keys(localErrors).length > 0}
            submitLabel={rate ? "Save rate" : "Create rate"}
            onCancel={() => onOpenChange(false)}
            warnOnLeave={false}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
