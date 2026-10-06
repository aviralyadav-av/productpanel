"use client";

import * as React from "react";

import { updatePincodeAction, upsertPincodeAction } from "@/features/shipping/actions";
import type { ZoneOption } from "@/features/shipping/components/rate-dialog";
import { INDIAN_STATE_OPTIONS, stateCodeOf, stateName } from "@/features/shipping/india";
import type { PincodeRow } from "@/features/shipping/queries";
import { MAX_ESTIMATE_DAYS } from "@/features/shipping/schemas";
import { SearchableSelect } from "@/components/shared/combobox";
import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormRowGroup } from "@/components/shared/form-layout";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

/**
 * Add one pincode or edit a row. The state is a select over the Indian
 * states/UTs so the stored text is canonical and zone-by-state matching works;
 * a value that came from a courier CSV and is not a known state is kept as-is.
 */
export function PincodeDialog({ row, zones, open, onOpenChange }: { row: PincodeRow | null; zones: ZoneOption[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { pending, run } = useActionToast();
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const [pincode, setPincode] = React.useState(row?.pincode ?? "");
  const [city, setCity] = React.useState(row?.city ?? "");
  const [stateCode, setStateCode] = React.useState<string | null>(stateCodeOf(row?.state));
  const [zoneId, setZoneId] = React.useState<string | null>(row?.zoneId ?? null);
  const [isServiceable, setIsServiceable] = React.useState(row?.isServiceable ?? true);
  const [codAvailable, setCodAvailable] = React.useState(row?.codAvailable ?? true);
  const [estimatedDays, setEstimatedDays] = React.useState<string>(row?.estimatedDays?.toString() ?? "");

  const unknownState = row?.state && !stateCodeOf(row.state) ? row.state : null;
  const stateOptions = unknownState ? [{ value: `raw:${unknownState}`, label: unknownState, description: "As imported" }, ...INDIAN_STATE_OPTIONS] : INDIAN_STATE_OPTIONS;
  const [rawState, setRawState] = React.useState<string | null>(unknownState);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    const state = rawState ?? (stateCode ? stateName(stateCode) : null);
    const days = estimatedDays.trim() === "" ? null : Number(estimatedDays);
    const values = { city: city || null, state, zoneId, isServiceable, codAvailable, estimatedDays: days };
    const result = await run(() => (row ? updatePincodeAction(row.pincode, values) : upsertPincodeAction({ pincode, ...values })), {
      onSuccess: () => onOpenChange(false),
    });
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{row ? `Pincode ${row.pincode}` : "Add a pincode"}</DialogTitle>
          <DialogDescription>
            A row here overrides the zone rules for one pincode: switch it off to exclude it, or pin it to a zone regardless of prefixes.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormRowGroup columns={2}>
            <FormRow label="Pincode" htmlFor="pin-code" required error={errors.pincode}>
              <Input
                id="pin-code"
                inputMode="numeric"
                maxLength={6}
                value={pincode}
                onChange={(event) => setPincode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                disabled={Boolean(row)}
                className="font-mono"
                required
                autoFocus={!row}
              />
            </FormRow>
            <FormRow label="City" htmlFor="pin-city" error={errors.city}>
              <Input id="pin-city" value={city} onChange={(event) => setCity(event.target.value)} maxLength={120} autoFocus={Boolean(row)} />
            </FormRow>
          </FormRowGroup>

          <FormRow label="State / UT" htmlFor="pin-state" error={errors.state}>
            <SearchableSelect
              id="pin-state"
              options={stateOptions}
              value={rawState ? `raw:${rawState}` : stateCode}
              onChange={(value) => {
                if (value?.startsWith("raw:")) {
                  setRawState(value.slice(4));
                  setStateCode(null);
                } else {
                  setRawState(null);
                  setStateCode(value);
                }
              }}
              placeholder="Unknown"
              searchPlaceholder="Search states"
              allowClear
            />
          </FormRow>

          <FormRow label="Zone" htmlFor="pin-zone" hint="Empty = resolve by prefix, state, then default." error={errors.zoneId}>
            <SearchableSelect
              id="pin-zone"
              options={zones.map((zone) => ({ value: zone.id, label: zone.name, description: zone.isDefault ? "Default" : zone.isActive ? undefined : "Inactive" }))}
              value={zoneId}
              onChange={setZoneId}
              placeholder="Automatic"
              allowClear
            />
          </FormRow>

          <FormRowGroup columns={2}>
            <FormRow label="Serviceable" htmlFor="pin-serviceable" inline error={errors.isServiceable}>
              <Switch id="pin-serviceable" checked={isServiceable} onCheckedChange={setIsServiceable} />
            </FormRow>
            <FormRow label="COD available" htmlFor="pin-cod" inline error={errors.codAvailable}>
              <Switch id="pin-cod" checked={codAvailable} onCheckedChange={setCodAvailable} disabled={!isServiceable} />
            </FormRow>
          </FormRowGroup>

          <FormRow label="Estimated delivery days" htmlFor="pin-days" hint="Overrides the rate's estimate for this pincode. Empty = use the rate." error={errors.estimatedDays}>
            <Input id="pin-days" type="number" inputMode="numeric" min={0} max={MAX_ESTIMATE_DAYS} value={estimatedDays} onChange={(event) => setEstimatedDays(event.target.value)} placeholder="From rate" className="max-w-32" />
          </FormRow>

          <FormActions dirty pending={pending} disabled={!/^[1-9]\d{5}$/.test(pincode)} submitLabel={row ? "Save pincode" : "Add pincode"} onCancel={() => onOpenChange(false)} warnOnLeave={false} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
