"use client";

import { FormRow, FormRowGroup } from "@/components/shared/form-layout";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ADDRESS_TYPES, type AddressType } from "@/lib/enums";

import type { AddressInput } from "@/features/customers/schemas";

/** Editable form state for one address; mirrors addressSchema's input shape with strings for every text field. */
export type AddressFormState = {
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  state: string;
  pinCode: string;
  country: string;
  type: AddressType;
  isDefault: boolean;
};

export const ADDRESS_TYPE_LABELS: Record<AddressType, string> = {
  SHIPPING: "Shipping",
  BILLING: "Billing",
  BOTH: "Shipping & billing",
};

export function emptyAddress(overrides: Partial<AddressFormState> = {}): AddressFormState {
  return { label: "", fullName: "", phone: "", line1: "", line2: "", landmark: "", city: "", state: "", pinCode: "", country: "IN", type: "BOTH", isDefault: false, ...overrides };
}

export function addressFromRecord(record: {
  label: string | null;
  fullName: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pinCode: string;
  country: string;
  type: string;
  isDefault: boolean;
}): AddressFormState {
  return {
    label: record.label ?? "",
    fullName: record.fullName,
    phone: record.phone ?? "",
    line1: record.line1,
    line2: record.line2 ?? "",
    landmark: record.landmark ?? "",
    city: record.city,
    state: record.state,
    pinCode: record.pinCode,
    country: record.country,
    type: (ADDRESS_TYPES as readonly string[]).includes(record.type) ? (record.type as AddressType) : "BOTH",
    isDefault: record.isDefault,
  };
}

export function toAddressInput(state: AddressFormState): AddressInput {
  return { ...state };
}

/** True when the operator has typed anything worth saving. */
export function addressHasContent(state: AddressFormState): boolean {
  return Boolean(state.fullName || state.line1 || state.city || state.pinCode);
}

/**
 * The address fields, shared by the create form (initial address), the
 * address book dialog and nothing else. `prefix` keeps ids unique when two
 * address forms are on one page. Errors are keyed by the bare field name.
 */
export function AddressFields({
  value,
  onChange,
  errors = {},
  prefix = "address",
  disabled,
  showDefault = true,
}: {
  value: AddressFormState;
  onChange: (next: AddressFormState) => void;
  errors?: Record<string, string>;
  prefix?: string;
  disabled?: boolean;
  showDefault?: boolean;
}) {
  const set = <K extends keyof AddressFormState>(key: K, next: AddressFormState[K]) => onChange({ ...value, [key]: next });
  const id = (field: string) => `${prefix}-${field}`;
  const err = (field: string) => errors[field] ?? errors[`address.${field}`];

  return (
    <div className="space-y-3">
      <FormRowGroup columns={2}>
        <FormRow label="Full name" htmlFor={id("fullName")} required error={err("fullName")}>
          <Input id={id("fullName")} value={value.fullName} onChange={(event) => set("fullName", event.target.value)} disabled={disabled} autoComplete="off" />
        </FormRow>
        <FormRow label="Phone" htmlFor={id("phone")} error={err("phone")} hint="Optional; used by the courier.">
          <Input id={id("phone")} value={value.phone} onChange={(event) => set("phone", event.target.value)} disabled={disabled} inputMode="tel" autoComplete="off" />
        </FormRow>
      </FormRowGroup>
      <FormRow label="Address line 1" htmlFor={id("line1")} required error={err("line1")}>
        <Input id={id("line1")} value={value.line1} onChange={(event) => set("line1", event.target.value)} disabled={disabled} autoComplete="off" />
      </FormRow>
      <FormRowGroup columns={2}>
        <FormRow label="Address line 2" htmlFor={id("line2")} error={err("line2")}>
          <Input id={id("line2")} value={value.line2} onChange={(event) => set("line2", event.target.value)} disabled={disabled} autoComplete="off" />
        </FormRow>
        <FormRow label="Landmark" htmlFor={id("landmark")} error={err("landmark")}>
          <Input id={id("landmark")} value={value.landmark} onChange={(event) => set("landmark", event.target.value)} disabled={disabled} autoComplete="off" />
        </FormRow>
      </FormRowGroup>
      <FormRowGroup columns={3}>
        <FormRow label="City" htmlFor={id("city")} required error={err("city")}>
          <Input id={id("city")} value={value.city} onChange={(event) => set("city", event.target.value)} disabled={disabled} autoComplete="off" />
        </FormRow>
        <FormRow label="State" htmlFor={id("state")} required error={err("state")}>
          <Input id={id("state")} value={value.state} onChange={(event) => set("state", event.target.value)} disabled={disabled} autoComplete="off" />
        </FormRow>
        <FormRow label="PIN code" htmlFor={id("pinCode")} required error={err("pinCode")}>
          <Input id={id("pinCode")} value={value.pinCode} onChange={(event) => set("pinCode", event.target.value)} disabled={disabled} inputMode="numeric" maxLength={6} autoComplete="off" />
        </FormRow>
      </FormRowGroup>
      <FormRowGroup columns={3}>
        <FormRow label="Label" htmlFor={id("label")} error={err("label")} hint="Home, Office…">
          <Input id={id("label")} value={value.label} onChange={(event) => set("label", event.target.value)} disabled={disabled} autoComplete="off" />
        </FormRow>
        <FormRow label="Type" htmlFor={id("type")} error={err("type")}>
          <Select value={value.type} onValueChange={(next) => set("type", next as AddressType)} disabled={disabled}>
            <SelectTrigger id={id("type")} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADDRESS_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {ADDRESS_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormRow>
        {showDefault ? (
          <FormRow label="Default for its type" htmlFor={id("isDefault")} inline>
            <Switch id={id("isDefault")} checked={value.isDefault} onCheckedChange={(checked) => set("isDefault", checked)} disabled={disabled} />
          </FormRow>
        ) : null}
      </FormRowGroup>
    </div>
  );
}
