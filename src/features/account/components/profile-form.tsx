"use client";

import * as React from "react";

import { updateProfile } from "@/features/account/account-actions";
import type { AccountProfile } from "@/features/account/queries";
import { useActionToast } from "@/components/shared/use-action-toast";
import { FormRow, FormSection } from "@/components/shared/form-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ProfileForm({ profile }: { profile: AccountProfile }) {
  const { pending, run } = useActionToast();
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setErrors({});
    const result = await run(() =>
      updateProfile({
        name: String(form.get("name") ?? ""),
        phone: String(form.get("phone") ?? ""),
        image: String(form.get("image") ?? ""),
      }),
    );
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  return (
    <form onSubmit={onSubmit}>
      <FormSection
        title="Profile"
        description="How you appear in the audit log and to other administrators. The sign-in email is changed by an administrator from the Users module."
        actions={
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save profile"}
          </Button>
        }
      >
        <FormRow label="Email" htmlFor="email" hint="Your sign-in address.">
          <Input id="email" value={profile.email} readOnly disabled />
        </FormRow>
        <FormRow label="Name" htmlFor="name" required error={errors.name}>
          <Input id="name" name="name" defaultValue={profile.name ?? ""} autoComplete="name" required />
        </FormRow>
        <FormRow label="Phone" htmlFor="phone" hint="Optional. Indian mobile numbers are stored as +91XXXXXXXXXX." error={errors.phone}>
          <Input id="phone" name="phone" defaultValue={profile.phone ?? ""} autoComplete="tel" inputMode="tel" />
        </FormRow>
        <FormRow label="Avatar URL" htmlFor="image" hint="Optional. A media library picker replaces this in a later wave." error={errors.image}>
          <Input id="image" name="image" defaultValue={profile.image ?? ""} placeholder="https://…" />
        </FormRow>
      </FormSection>
    </form>
  );
}
