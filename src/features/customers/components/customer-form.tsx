"use client";

import * as React from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import { TagInput } from "@/components/shared/tag-input";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { createCustomerAction, updateCustomerAction } from "@/features/customers/actions";
import { AddressFields, addressHasContent, emptyAddress, toAddressInput, type AddressFormState } from "@/features/customers/components/address-fields";
import type { CustomerFormInput } from "@/features/customers/schemas";
import type { CustomerCore } from "@/features/customers/service";

/**
 * Create form (/admin/customers/new) and the Profile tab of the detail page.
 * Plain React state with a saved snapshot for dirty tracking; the zod schema
 * runs on the server and its field errors are shown inline.
 */

type ProfileState = {
  fullName: string;
  email: string;
  phone: string;
  acceptsMarketing: boolean;
  tags: string[];
  notes: string;
};

function fromCustomer(customer: CustomerCore | null): ProfileState {
  return {
    fullName: customer?.fullName ?? "",
    email: customer?.email ?? "",
    phone: customer?.phone ?? "",
    acceptsMarketing: customer?.acceptsMarketing ?? false,
    tags: customer?.tags ?? [],
    notes: customer?.notes ?? "",
  };
}

function same(a: ProfileState, b: ProfileState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function CustomerForm({
  customer,
  tagSuggestions,
  canEdit = true,
}: {
  /** null = create. */
  customer: CustomerCore | null;
  tagSuggestions: string[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const initial = React.useMemo(() => fromCustomer(customer), [customer]);
  const [state, setState] = React.useState<ProfileState>(initial);
  const [saved, setSaved] = React.useState<ProfileState>(initial);
  const [address, setAddress] = React.useState<AddressFormState>(() => emptyAddress({ isDefault: true }));
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // A fresh server payload resets the snapshot without discarding unsaved edits.
  const [seen, setSeen] = React.useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setSaved(initial);
    setState((current) => (same(current, saved) ? initial : current));
  }

  const set = <K extends keyof ProfileState>(key: K, value: ProfileState[K]) => setState((current) => ({ ...current, [key]: value }));
  const dirty = !same(state, saved) || (!customer && addressHasContent(address));
  const disabled = !canEdit || pending;

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setErrors({});
    const input: CustomerFormInput = {
      fullName: state.fullName,
      email: state.email,
      phone: state.phone,
      acceptsMarketing: state.acceptsMarketing,
      tags: state.tags,
      notes: state.notes,
    };
    if (customer) {
      const result = await run(() => updateCustomerAction(customer.id, input), { onSuccess: () => router.refresh() });
      if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
      if (result.ok) setSaved(state);
      return;
    }
    const result = await run(() => createCustomerAction({ ...input, address: addressHasContent(address) ? toAddressInput(address) : null }), {
      onSuccess: (data) => router.push(`/admin/customers/${data.id}` as Route),
    });
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <FormSection title="Identity" description="Email is the login and the unique key: changing it clears verification and signs nothing out, but the customer must use the new address from now on.">
        <FormRowGroup columns={2}>
          <FormRow label="Full name" htmlFor="customer-fullName" error={errors.fullName}>
            <Input id="customer-fullName" value={state.fullName} onChange={(event) => set("fullName", event.target.value)} disabled={disabled} autoComplete="off" />
          </FormRow>
          <FormRow label="Email" htmlFor="customer-email" required error={errors.email}>
            <Input id="customer-email" type="email" value={state.email} onChange={(event) => set("email", event.target.value)} disabled={disabled} autoComplete="off" />
          </FormRow>
        </FormRowGroup>
        <FormRowGroup columns={2}>
          <FormRow label="Phone" htmlFor="customer-phone" error={errors.phone} hint="Indian mobiles normalise to +91XXXXXXXXXX.">
            <Input id="customer-phone" value={state.phone} onChange={(event) => set("phone", event.target.value)} disabled={disabled} inputMode="tel" autoComplete="off" />
          </FormRow>
          <FormRow label="Accepts marketing" htmlFor="customer-marketing" inline hint="Only tick this with the customer's explicit consent.">
            <Switch id="customer-marketing" checked={state.acceptsMarketing} onCheckedChange={(checked) => set("acceptsMarketing", checked)} disabled={disabled} />
          </FormRow>
        </FormRowGroup>
      </FormSection>

      <FormSection title="Internal" description="Tags drive list filters and bulk actions; notes are visible to staff only and never leave the admin.">
        <FormRow label="Tags" htmlFor="customer-tags" error={errors.tags}>
          <TagInput id="customer-tags" value={state.tags} onChange={(tags) => set("tags", tags)} suggestions={tagSuggestions} disabled={disabled} maxTags={20} normalize={(tag) => tag.trim().toLowerCase()} />
        </FormRow>
        <FormRow label="Notes" htmlFor="customer-notes" error={errors.notes}>
          <Textarea id="customer-notes" value={state.notes} onChange={(event) => set("notes", event.target.value)} disabled={disabled} rows={4} placeholder="Preferences, past issues, anything the next agent should know." />
        </FormRow>
      </FormSection>

      {!customer ? (
        <FormSection title="Initial address" description="Optional. Saved as the default shipping and billing address; more can be added from the profile.">
          <AddressFields value={address} onChange={setAddress} errors={errors} prefix="new-address" disabled={disabled} showDefault={false} />
        </FormSection>
      ) : null}

      {canEdit ? (
        <FormActions
          dirty={dirty}
          pending={pending}
          submitLabel={customer ? "Save profile" : "Create customer"}
          onCancel={() => (customer ? setState(saved) : router.push("/admin/customers" as Route))}
        />
      ) : null}
    </form>
  );
}
