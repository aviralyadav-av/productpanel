"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { AlertCircle, CircleCheck, Loader2 } from "lucide-react";

import {
  resetPasswordAction,
  type ResetPasswordState,
} from "@/features/account/password-reset-actions";
import { PASSWORD_MIN_LENGTH } from "@/features/account/password-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL: ResetPasswordState = {};

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(resetPasswordAction, INITIAL);

  if (state.status === "done") {
    return (
      <div className="space-y-4 text-xs leading-relaxed">
        <div className="bg-success-muted text-success flex items-start gap-2 rounded-md p-3">
          <CircleCheck className="mt-px size-3.5 shrink-0" />
          <span>Your password has been changed and every other device has been signed out.</span>
        </div>
        <Button asChild size="lg" className="w-full">
          <Link href="/admin/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  if (state.status === "dead_link") {
    return (
      <div className="space-y-4 text-xs leading-relaxed">
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border p-3"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          <span>{state.error}</span>
        </div>
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href="/admin/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      {state.error && !state.fieldErrors ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border p-3 text-xs"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          autoFocus
          aria-invalid={Boolean(state.fieldErrors?.password)}
        />
        <p className="text-muted-foreground text-[11px]">
          At least {PASSWORD_MIN_LENGTH} characters, not your name or email.
        </p>
        {state.fieldErrors?.password ? (
          <p className="text-destructive text-xs">{state.fieldErrors.password}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Repeat new password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
        />
        {state.fieldErrors?.confirmPassword ? (
          <p className="text-destructive text-xs">{state.fieldErrors.confirmPassword}</p>
        ) : null}
      </div>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          Saving…
        </>
      ) : (
        "Set new password"
      )}
    </Button>
  );
}
