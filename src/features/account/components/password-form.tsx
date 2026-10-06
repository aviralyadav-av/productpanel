"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { changePassword } from "@/features/account/account-actions";
import { PASSWORD_MIN_LENGTH } from "@/features/account/password-policy";
import { useActionToast } from "@/components/shared/use-action-toast";
import { FormRow, FormSection } from "@/components/shared/form-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PasswordForm({
  forced,
  redirectTo,
}: {
  /** True when the account is flagged forcePasswordChange (D10). */
  forced: boolean;
  redirectTo?: string;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const formRef = React.useRef<HTMLFormElement>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setErrors({});
    const result = await run(
      () =>
        changePassword({
          currentPassword: String(form.get("currentPassword") ?? ""),
          newPassword: String(form.get("newPassword") ?? ""),
          confirmPassword: String(form.get("confirmPassword") ?? ""),
        }),
      {
        onSuccess: () => {
          formRef.current?.reset();
          if (forced || redirectTo) router.push((redirectTo ?? "/admin/dashboard") as never);
        },
      },
    );
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit}>
      <FormSection
        title={forced ? "Set a new password to continue" : "Change password"}
        description={
          forced
            ? "An administrator reset your account, so the password you signed in with is temporary. Choose a new one to unlock the rest of the panel."
            : `At least ${PASSWORD_MIN_LENGTH} characters, and not your name or email. Every other signed-in device is signed out when you save.`
        }
        actions={
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : forced ? "Save and continue" : "Change password"}
          </Button>
        }
      >
        <FormRow label="Current password" htmlFor="currentPassword" required error={errors.currentPassword}>
          <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
        </FormRow>
        <FormRow
          label="New password"
          htmlFor="newPassword"
          required
          hint={`${PASSWORD_MIN_LENGTH}+ characters. A sentence you will remember beats a short string of symbols.`}
          error={errors.newPassword}
        >
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
          />
        </FormRow>
        <FormRow label="Repeat new password" htmlFor="confirmPassword" required error={errors.confirmPassword}>
          <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
        </FormRow>
      </FormSection>
    </form>
  );
}
