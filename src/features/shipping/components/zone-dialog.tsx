"use client";

import * as React from "react";

import { createZoneAction, updateZoneAction } from "@/features/shipping/actions";
import { INDIAN_STATE_OPTIONS } from "@/features/shipping/india";
import type { ZoneRow } from "@/features/shipping/queries";
import { PINCODE_PREFIX_PATTERN } from "@/features/shipping/schemas";
import { MultiSelect } from "@/components/shared/combobox";
import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormRowGroup } from "@/components/shared/form-layout";
import { NumberStepper } from "@/components/shared/number-stepper";
import { TagInput } from "@/components/shared/tag-input";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/**
 * Create / edit a shipping zone. Mounted fresh per open (keyed by the caller)
 * so the form starts from the row without a reset effect.
 */
export function ZoneDialog({
  zone,
  open,
  onOpenChange,
  isFirstZone,
}: {
  zone: ZoneRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** With no zones yet the first one is forced to be the default. */
  isFirstZone: boolean;
}) {
  const { pending, run } = useActionToast();
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const [name, setName] = React.useState(zone?.name ?? "");
  const [description, setDescription] = React.useState(zone?.description ?? "");
  const [states, setStates] = React.useState<string[]>(zone?.states ?? []);
  const [prefixes, setPrefixes] = React.useState<string[]>(zone?.pincodePrefixes ?? []);
  const [countries, setCountries] = React.useState<string[]>(zone?.countries ?? ["IN"]);
  const [isDefault, setIsDefault] = React.useState(zone?.isDefault ?? isFirstZone);
  const [isActive, setIsActive] = React.useState(zone?.isActive ?? true);
  const [position, setPosition] = React.useState(zone?.position ?? 0);

  const lockedDefault = isFirstZone || (zone?.isDefault ?? false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    const input = {
      name,
      description: description || null,
      countries,
      states,
      pincodePrefixes: prefixes,
      isDefault: lockedDefault ? true : isDefault,
      isActive: isDefault ? true : isActive,
      position,
    };
    const result = await run(() => (zone ? updateZoneAction(zone.id, input) : createZoneAction(input)), {
      onSuccess: () => onOpenChange(false),
    });
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{zone ? `Edit zone: ${zone.name}` : "New shipping zone"}</DialogTitle>
          <DialogDescription>
            A pincode resolves to its assigned zone, else the zone with the longest matching prefix, else a zone listing its state, else the default zone.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormRow label="Name" htmlFor="zone-name" required error={errors.name}>
            <Input id="zone-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus required />
          </FormRow>

          <FormRow label="Description" htmlFor="zone-description" error={errors.description}>
            <Textarea id="zone-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} maxLength={300} />
          </FormRow>

          <FormRow label="States and union territories" htmlFor="zone-states" hint="Pincodes whose state is listed here fall into this zone when no prefix matches." error={errors.states}>
            <MultiSelect id="zone-states" options={INDIAN_STATE_OPTIONS} value={states} onChange={setStates} placeholder="Any state" searchPlaceholder="Search states" maxVisibleChips={4} />
          </FormRow>

          <FormRow label="Pincode prefixes" htmlFor="zone-prefixes" hint="2 to 4 digits each; a longer prefix beats a shorter one across zones." error={errors.pincodePrefixes}>
            <TagInput
              id="zone-prefixes"
              value={prefixes}
              onChange={(next) => setPrefixes(next.filter((prefix) => PINCODE_PREFIX_PATTERN.test(prefix)))}
              normalize={(tag) => tag.replace(/\D/g, "").slice(0, 4)}
              placeholder="e.g. 11, 4000"
              maxTags={200}
            />
          </FormRow>

          <FormRowGroup columns={2}>
            <FormRow label="Countries" htmlFor="zone-countries" hint="ISO codes; IN unless you ship abroad." error={errors.countries}>
              <TagInput id="zone-countries" value={countries} onChange={setCountries} normalize={(tag) => tag.trim().toUpperCase().slice(0, 2)} placeholder="IN" maxTags={20} />
            </FormRow>
            <FormRow label="Position" htmlFor="zone-position" hint="Tie-breaker when two zones match equally." error={errors.position}>
              <NumberStepper id="zone-position" value={position} onChange={setPosition} min={0} max={100000} aria-label="Position" />
            </FormRow>
          </FormRowGroup>

          <FormRow
            label="Default zone"
            htmlFor="zone-default"
            inline
            hint={lockedDefault ? "Every store needs exactly one default; pick another zone as default to change this." : "Unknown pincodes fall back here."}
            error={errors.isDefault}
          >
            <Switch id="zone-default" checked={lockedDefault || isDefault} onCheckedChange={setIsDefault} disabled={lockedDefault} />
          </FormRow>

          <FormRow label="Active" htmlFor="zone-active" inline hint={isDefault || lockedDefault ? "The default zone is always active." : "Inactive zones never match a pincode."} error={errors.isActive}>
            <Switch id="zone-active" checked={isDefault || lockedDefault || isActive} onCheckedChange={setIsActive} disabled={isDefault || lockedDefault} />
          </FormRow>

          <FormActions dirty pending={pending} submitLabel={zone ? "Save zone" : "Create zone"} onCancel={() => onOpenChange(false)} warnOnLeave={false} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
