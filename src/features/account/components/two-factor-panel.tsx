"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck, ShieldOff, TriangleAlert } from "lucide-react";

import {
  beginTwoFactorEnrolment,
  cancelTwoFactorEnrolment,
  confirmTwoFactorEnrolment,
  disableTwoFactorAction,
} from "@/features/account/two-factor-actions";
import type { EnrolmentStart } from "@/features/account/two-factor";
import { useActionToast } from "@/components/shared/use-action-toast";
import { CopyButton } from "@/components/shared/copy-button";
import { FormRow, FormSection } from "@/components/shared/form-layout";
import { StatusPill } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The 2FA lifecycle in one panel:
 *   off      → "Turn on" asks for the password, then shows the QR + manual key
 *   scanning → one code from the app confirms; recovery codes shown ONCE
 *   on       → "Turn off" asks for password + a code
 */
export function TwoFactorPanel({
  status,
  required,
}: {
  status: { enabled: boolean; enrolmentPending: boolean; recoveryCodesLeft: number };
  required: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [start, setStart] = React.useState<EnrolmentStart | null>(null);
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[] | null>(null);
  const [mode, setMode] = React.useState<"idle" | "enrol" | "disable">("idle");

  async function begin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setErrors({});
    const result = await run(
      () => beginTwoFactorEnrolment({ currentPassword: String(form.get("currentPassword") ?? "") }),
      { silent: true },
    );
    if (result.ok) setStart(result.data);
    else if (result.fieldErrors) setErrors(result.fieldErrors);
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setErrors({});
    const result = await run(() => confirmTwoFactorEnrolment({ code: String(form.get("code") ?? "") }));
    if (result.ok) {
      setRecoveryCodes(result.data.recoveryCodes);
      setStart(null);
      setMode("idle");
    } else if (result.fieldErrors) setErrors(result.fieldErrors);
  }

  async function cancel() {
    await run(() => cancelTwoFactorEnrolment(), { silent: true });
    setStart(null);
    setMode("idle");
    router.refresh();
  }

  async function disable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setErrors({});
    const result = await run(() =>
      disableTwoFactorAction({
        currentPassword: String(form.get("currentPassword") ?? ""),
        code: String(form.get("code") ?? ""),
      }),
    );
    if (result.ok) {
      setMode("idle");
      router.refresh();
    } else if (result.fieldErrors) setErrors(result.fieldErrors);
  }

  if (recoveryCodes) {
    return (
      <FormSection
        title="Save your recovery codes"
        description="Each code signs you in once if you lose your phone. They are shown only now - store them somewhere safe, not in this browser."
        actions={
          <Button
            size="sm"
            onClick={() => {
              setRecoveryCodes(null);
              router.refresh();
            }}
          >
            I have saved them
          </Button>
        }
      >
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-muted/40 p-3 text-xs">
          <TriangleAlert className="text-warning mt-px size-3.5 shrink-0" />
          <span>Anyone with a code and your password can sign in as you. Treat them like passwords.</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 font-mono text-sm sm:grid-cols-5">
          {recoveryCodes.map((code) => (
            <span key={code} className="bg-muted rounded px-2 py-1 text-center">
              {code}
            </span>
          ))}
        </div>
        <CopyButton value={recoveryCodes.join("\n")} label="Copy all codes" size="sm" />
      </FormSection>
    );
  }

  if (start) {
    return (
      <form onSubmit={confirm}>
        <FormSection
          title="Scan with your authenticator app"
          description={`Google Authenticator, 1Password, Authy or any TOTP app. The entry will be named “${start.issuer}: ${start.account}”.`}
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Checking…" : "Verify and turn on"}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row">
            {/* A data: URL from the server; next/image adds nothing at 192px. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={start.qrDataUrl}
              alt="QR code for your authenticator app"
              width={192}
              height={192}
              className="bg-white size-48 shrink-0 rounded-md border p-2"
            />
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <p className="text-xs font-medium">Cannot scan? Enter this key manually</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="bg-muted rounded px-2 py-1 font-mono text-xs tracking-wider">{start.manualKey}</code>
                  <CopyButton value={start.manualKey.replace(/\s+/g, "")} label="Copy key" size="xs" />
                </div>
                <p className="text-muted-foreground mt-1 text-[11px]">Time-based · SHA-1 · 6 digits · 30 seconds</p>
              </div>
              <FormRow label="Code from the app" htmlFor="code" required error={errors.code}>
                <Input
                  id="code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]*"
                  placeholder="123 456"
                  maxLength={7}
                  autoFocus
                  required
                  className="max-w-40 font-mono tracking-widest"
                />
              </FormRow>
            </div>
          </div>
        </FormSection>
      </form>
    );
  }

  if (status.enabled) {
    return (
      <form onSubmit={disable}>
        <FormSection
          title="Two-factor authentication"
          description="Every new sign-in asks for a code from your authenticator app. Devices that already passed the check stay signed in."
          actions={
            mode === "disable" ? (
              <>
                <Button type="button" variant="ghost" size="sm" onClick={() => setMode("idle")} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" size="sm" disabled={pending}>
                  {pending ? "Turning off…" : "Turn off"}
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setMode("disable")} disabled={required}>
                <ShieldOff className="size-3.5" />
                Turn off
              </Button>
            )
          }
        >
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <StatusPill label="On" tone="success" />
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <KeyRound className="size-3.5" />
              {status.recoveryCodesLeft} recovery code{status.recoveryCodesLeft === 1 ? "" : "s"} left
            </span>
            {required ? (
              <span className="text-muted-foreground">Required for super-admins by the security settings.</span>
            ) : null}
          </div>
          {mode === "disable" ? (
            <>
              <FormRow label="Current password" htmlFor="currentPassword" required error={errors.currentPassword}>
                <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
              </FormRow>
              <FormRow
                label="Authenticator or recovery code"
                htmlFor="code"
                required
                hint="A 6-digit code from the app, or one of your recovery codes."
                error={errors.code}
              >
                <Input id="code" name="code" autoComplete="one-time-code" required className="max-w-56 font-mono" />
              </FormRow>
            </>
          ) : null}
        </FormSection>
      </form>
    );
  }

  return (
    <form onSubmit={begin}>
      <FormSection
        title="Two-factor authentication"
        description="Add a second step to sign-in: a 6-digit code from an authenticator app on your phone. Strongly recommended for every administrator."
        actions={
          mode === "enrol" ? (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode("idle")} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Preparing…" : "Continue"}
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" onClick={() => setMode("enrol")}>
              <ShieldCheck className="size-3.5" />
              Turn on
            </Button>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <StatusPill label="Off" tone="neutral" />
          {status.enrolmentPending ? (
            <span className="text-muted-foreground">
              An earlier enrolment was not finished. Starting again issues a fresh key.
            </span>
          ) : null}
          {required ? (
            <span className="text-warning inline-flex items-center gap-1">
              <TriangleAlert className="size-3.5" />
              Required for super-admins - the rest of the panel unlocks once this is on.
            </span>
          ) : null}
        </div>
        {mode === "enrol" ? (
          <FormRow
            label="Current password"
            htmlFor="currentPassword"
            required
            hint="Confirms it is really you before a new authenticator is trusted."
            error={errors.currentPassword}
          >
            <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" autoFocus required />
          </FormRow>
        ) : null}
      </FormSection>
    </form>
  );
}
