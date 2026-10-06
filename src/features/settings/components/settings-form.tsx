"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, MailCheck, PlugZap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormActions } from "@/components/shared/form-actions";
import { FormSection } from "@/components/shared/form-layout";
import { useMediaPicker } from "@/components/shared/media-picker";
import { useActionToast } from "@/components/shared/use-action-toast";

import { updateSettingsAction, testEmailAction } from "@/features/settings/actions";
import { ChargesEditor } from "@/features/settings/components/charges-editor";
import { SettingField } from "@/features/settings/components/setting-field";
import type { SettingsGroupView } from "@/features/settings/schemas";

/**
 * One tab of /admin/settings, generated from the registry.
 *
 * Form state is a flat `Record<string, string>` because that is exactly what
 * the Setting table stores and what the action accepts - no mapping layer to
 * get wrong. Only keys that differ from the loaded values are posted, so the
 * service can audit "these five keys changed" honestly and a Save on an
 * untouched tab is a no-op rather than 70 pointless writes.
 */
export function SettingsForm({
  group,
  canEdit,
  storefrontUrl,
}: {
  group: SettingsGroupView;
  canEdit: boolean;
  /** Shown on the Store tab as an "Open website" link. */
  storefrontUrl?: string | null;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const picker = useMediaPicker();

  const initial = React.useMemo(
    () => Object.fromEntries(group.fields.map((field) => [field.key, field.value])),
    [group.fields],
  );

  const [values, setValues] = React.useState<Record<string, string>>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // A save re-renders the page from the server; reset the draft to whatever
  // came back so "unsaved changes" cannot stick around after a successful save.
  const [prevInitial, setPrevInitial] = React.useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setValues(initial);
    setErrors({});
  }

  const changed = group.fields
    .map((field) => field.key)
    .filter((key) => (values[key] ?? "") !== (initial[key] ?? ""));
  const dirty = changed.length > 0;

  function setValue(key: string, next: string) {
    setValues((current) => ({ ...current, [key]: next }));
    setErrors((current) =>
      current[key]
        ? Object.fromEntries(Object.entries(current).filter(([field]) => field !== key))
        : current,
    );
  }

  async function save() {
    if (!dirty) return;
    const payload = Object.fromEntries(changed.map((key) => [key, values[key] ?? ""]));
    const result = await run(() => updateSettingsAction({ values: payload }), {
      onSuccess: () => {
        setErrors({});
        router.refresh();
      },
    });
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  const chargesField = group.fields.find((field) => field.key === "marketplace.charges");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="space-y-4"
    >
      <FormSection
        title={group.label}
        description={group.description}
        actions={
          storefrontUrl ? (
            <div className="space-y-1">
              <p className="text-muted-foreground text-[11px]">
                Customer website:{" "}
                <code className="break-all">{storefrontUrl}</code>
                <br />
                Edit it on the Storefront tab.
              </p>
              <Button asChild variant="outline" size="xs">
                <a href={storefrontUrl} target="_blank" rel="noreferrer noopener">
                  <ExternalLink className="size-3.5" />
                  Open website
                </a>
              </Button>
            </div>
          ) : null
        }
      >
        {group.fields.map((field) =>
          field.key === "marketplace.charges" ? null : (
            <SettingField
              key={field.key}
              field={field}
              value={values[field.key] ?? ""}
              onChange={(next) => setValue(field.key, next)}
              error={errors[field.key]}
              disabled={!canEdit || pending}
              onPickMedia={async () => {
                const picked = await picker.open({
                  accept: "image",
                  multiple: false,
                  title: field.label,
                });
                return picked?.[0] ?? null;
              }}
            />
          ),
        )}
      </FormSection>

      {chargesField ? (
        <FormSection
          title="Marketplace charges"
          description="Deducted from every seller payable on top of commission (B3). Percent rules are on the seller's gross for the line; fixed rules are per item or per order."
        >
          <ChargesEditor
            value={values[chargesField.key] ?? "[]"}
            onChange={(next) => setValue(chargesField.key, next)}
            disabled={!canEdit || pending}
          />
        </FormSection>
      ) : null}

      {group.group === "email" ? (
        <EmailTestPanel values={values} disabled={!canEdit || pending} />
      ) : null}

      {canEdit ? (
        <FormActions
          dirty={dirty}
          pending={pending}
          submitLabel={
            dirty
              ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}`
              : "Save changes"
          }
          disabled={!dirty}
          onCancel={() => {
            setValues(initial);
            setErrors({});
          }}
        />
      ) : (
        <p className="text-muted-foreground text-xs">
          You have read-only access to these settings.
        </p>
      )}

      {picker.element}
    </form>
  );
}

/**
 * The Email tab's two buttons. Both post the values currently ON SCREEN, so an
 * operator can prove a new password works before saving it - the alternative
 * (save, then test) leaves broken credentials in the database when it fails.
 */
function EmailTestPanel({
  values,
  disabled,
}: {
  values: Record<string, string>;
  disabled?: boolean;
}) {
  const { pending, run } = useActionToast();
  const [to, setTo] = React.useState("");
  const [outcome, setOutcome] = React.useState<string | null>(null);

  async function test(mode: "connection" | "send") {
    const result = await run(() => testEmailAction({ mode, to, values }));
    setOutcome(result.ok ? (result.message ?? "Done.") : result.error);
  }

  return (
    <FormSection
      title="Test"
      description="Check the transport before you rely on it. The connection test opens an SMTP session and authenticates; the test email goes through the real outbox and the job worker."
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor="settings-test-email" className="text-xs font-medium">
            Send a test email to
          </label>
          <Input
            id="settings-test-email"
            type="email"
            value={to}
            placeholder="your own address (defaults to you)"
            onChange={(event) => setTo(event.target.value)}
            disabled={disabled || pending}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || pending}
          onClick={() => test("connection")}
        >
          <PlugZap className="size-3.5" />
          Test SMTP connection
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || pending}
          onClick={() => test("send")}
        >
          <MailCheck className="size-3.5" />
          Send test email
        </Button>
      </div>
      {outcome ? <p className="text-muted-foreground text-xs">{outcome}</p> : null}
    </FormSection>
  );
}
