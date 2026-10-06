"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { AlertCircle, Loader2, MailCheck } from "lucide-react";

import {
  forgotPasswordAction,
  type ForgotPasswordState,
} from "@/features/account/password-reset-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL: ForgotPasswordState = {};

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(forgotPasswordAction, INITIAL);

  if (state.status === "sent") {
    return (
      <div className="space-y-4 text-xs leading-relaxed">
        <div className="bg-success-muted text-success flex items-start gap-2 rounded-md p-3">
          <MailCheck className="mt-px size-3.5 shrink-0" />
          <span>
            If that address belongs to an administrator, a reset link is on its way. It is valid for
            30 minutes. Check your spam folder if nothing arrives.
          </span>
        </div>
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href="/admin/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border p-3 text-xs"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
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
          Sending…
        </>
      ) : (
        "Email me a reset link"
      )}
    </Button>
  );
}
