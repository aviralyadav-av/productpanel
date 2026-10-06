"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2 } from "lucide-react";

import {
  abandonTwoFactorChallenge,
  verifyTwoFactorChallenge,
  type ChallengeState,
} from "@/features/account/two-factor-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL: ChallengeState = {};

export function TwoFactorChallengeForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, formAction] = useActionState(verifyTwoFactorChallenge, INITIAL);
  const [useRecovery, setUseRecovery] = React.useState(false);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

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
        <Label htmlFor="code">{useRecovery ? "Recovery code" : "6-digit code"}</Label>
        <Input
          id="code"
          name="code"
          key={useRecovery ? "recovery" : "totp"}
          inputMode={useRecovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          placeholder={useRecovery ? "xxxxx-xxxxx" : "123 456"}
          maxLength={useRecovery ? 16 : 7}
          className="font-mono tracking-widest"
          autoFocus
          required
        />
        <button
          type="button"
          onClick={() => setUseRecovery((value) => !value)}
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
        >
          {useRecovery ? "Use my authenticator app instead" : "Lost your phone? Use a recovery code"}
        </button>
      </div>

      <SubmitButton />

      <Button
        type="submit"
        formAction={abandonTwoFactorChallenge}
        variant="ghost"
        size="sm"
        className="w-full"
        formNoValidate
      >
        Cancel and sign out
      </Button>
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
          Verifying…
        </>
      ) : (
        "Verify"
      )}
    </Button>
  );
}
