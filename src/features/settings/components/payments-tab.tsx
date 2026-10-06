"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, KeyRound } from "lucide-react";

import { PAYMENT_PROVIDER_MODES, type PaymentProviderMode } from "@/lib/enums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CopyButton } from "@/components/shared/copy-button";
import { MoneyInput } from "@/components/shared/money-input";
import { useActionToast } from "@/components/shared/use-action-toast";

import { saveProviderAction } from "@/features/settings/actions";
import { providerForm } from "@/features/settings/payment-providers";
import type { PaymentProviderView } from "@/features/settings/schemas";

/**
 * Settings -> Payments (blueprint §4.9, §14.D4/D5).
 *
 * One card per provider, each saved on its own: turning COD off should never
 * be able to half-apply a Razorpay credential rotation typed in the card
 * above. Credentials follow D4 - the stored value never arrives, the field is
 * blank, and blank means "unchanged".
 */
export function PaymentsTab({
  providers,
  canEdit,
}: {
  providers: PaymentProviderView[];
  canEdit: boolean;
}) {
  return (
    <div className="space-y-3">
      {providers.map((provider) => (
        <ProviderCard key={provider.provider} provider={provider} canEdit={canEdit} />
      ))}
    </div>
  );
}

function ProviderCard({
  provider,
  canEdit,
}: {
  provider: PaymentProviderView;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const spec = providerForm(provider.provider);

  const [isEnabled, setEnabled] = React.useState(provider.isEnabled);
  const [mode, setMode] = React.useState<PaymentProviderMode>(provider.mode);
  const [displayName, setDisplayName] = React.useState(provider.displayName);
  const [position, setPosition] = React.useState(String(provider.position));
  const [credentials, setCredentials] = React.useState<Record<string, string>>({});
  const [settings, setSettings] = React.useState<Record<string, unknown>>(provider.settings);

  const dirty =
    isEnabled !== provider.isEnabled ||
    mode !== provider.mode ||
    displayName !== provider.displayName ||
    position !== String(provider.position) ||
    Object.values(credentials).some((value) => value.trim() !== "") ||
    JSON.stringify(settings) !== JSON.stringify(provider.settings);

  async function save() {
    await run(
      () =>
        saveProviderAction({
          provider: provider.provider as never,
          isEnabled,
          mode,
          displayName: displayName.trim() || provider.provider,
          position: Number(position) || 0,
          supportedMethods: provider.supportedMethods.length
            ? provider.supportedMethods
            : [...(spec?.methods ?? [])],
          // Blank fields are omitted so the stored secret survives (D4).
          credentials: Object.fromEntries(
            Object.entries(credentials).filter(([, value]) => value.trim() !== ""),
          ),
          settings,
        }),
      {
        onSuccess: () => {
          setCredentials({});
          router.refresh();
        },
      },
    );
  }

  return (
    <section className="surface space-y-3 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight">{provider.displayName}</h3>
            <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">
              {provider.provider}
            </Badge>
            {provider.implemented ? null : (
              <Badge variant="outline" className="h-4 gap-1 px-1 text-[10px] font-normal">
                <AlertTriangle className="size-2.5" />
                not implemented
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed">
            {spec?.description}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Label
            htmlFor={`provider-enabled-${provider.provider}`}
            className="text-muted-foreground text-xs"
          >
            Enabled
          </Label>
          <Switch
            id={`provider-enabled-${provider.provider}`}
            checked={isEnabled}
            onCheckedChange={setEnabled}
            disabled={!canEdit || pending}
          />
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`provider-name-${provider.provider}`} className="text-[11px]">
            Display name
          </Label>
          <Input
            id={`provider-name-${provider.provider}`}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={!canEdit || pending}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Mode</Label>
          <Select
            value={mode}
            onValueChange={(value) => setMode(value as PaymentProviderMode)}
            disabled={!canEdit || pending}
          >
            <SelectTrigger size="sm" aria-label={`${provider.displayName} mode`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_PROVIDER_MODES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`provider-position-${provider.provider}`} className="text-[11px]">
            Position
          </Label>
          <Input
            id={`provider-position-${provider.provider}`}
            type="number"
            min={0}
            value={position}
            onChange={(event) => setPosition(event.target.value)}
            disabled={!canEdit || pending}
            className="max-w-24"
          />
        </div>
      </div>

      {spec && spec.credentials.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {spec.credentials.map((field) => {
            const stored = provider.credentials.find((item) => item.key === field.key);
            return (
              <div key={field.key} className="space-y-1">
                <Label
                  htmlFor={`cred-${provider.provider}-${field.key}`}
                  className="flex items-center gap-1.5 text-[11px]"
                >
                  {field.label}
                  <span className="text-muted-foreground inline-flex items-center gap-1">
                    <KeyRound className="size-3" />
                    {stored?.isSet
                      ? stored.last4
                        ? `set ····${stored.last4}`
                        : "set"
                      : "not set"}
                  </span>
                </Label>
                <Input
                  id={`cred-${provider.provider}-${field.key}`}
                  type="password"
                  autoComplete="new-password"
                  placeholder={stored?.isSet ? "Leave empty to keep" : "Enter value"}
                  value={credentials[field.key] ?? ""}
                  onChange={(event) =>
                    setCredentials((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  disabled={!canEdit || pending}
                />
                <p className="text-muted-foreground text-[11px]">{field.helpText}</p>
              </div>
            );
          })}
        </div>
      ) : null}

      {spec && spec.settings.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {spec.settings.map((field) => (
            <ProviderSettingField
              key={field.key}
              provider={provider.provider}
              field={field}
              value={settings[field.key]}
              onChange={(next) =>
                setSettings((current) =>
                  next === null
                    ? Object.fromEntries(
                        Object.entries(current).filter(([key]) => key !== field.key),
                      )
                    : { ...current, [field.key]: next },
                )
              }
              disabled={!canEdit || pending}
            />
          ))}
        </div>
      ) : null}

      {spec?.online ? (
        <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2">
          <span className="text-muted-foreground text-[11px] font-medium">Webhook URL</span>
          <code className="min-w-0 flex-1 truncate text-[11px]">{provider.webhookUrl}</code>
          <CopyButton value={provider.webhookUrl} label="Copy webhook URL" size="icon-xs" variant="ghost" />
        </div>
      ) : null}

      {canEdit ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" disabled={!dirty || pending} onClick={save}>
            Save {provider.displayName}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ProviderSettingField({
  provider,
  field,
  value,
  onChange,
  disabled,
}: {
  provider: string;
  field: { key: string; label: string; helpText: string; type: "money" | "number" | "boolean" | "string" };
  value: unknown;
  onChange: (next: unknown | null) => void;
  disabled?: boolean;
}) {
  const id = `pset-${provider}-${field.key}`;

  if (field.type === "boolean") {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor={id} className="text-[11px]">
            {field.label}
          </Label>
          <p className="text-muted-foreground text-[11px]">{field.helpText}</p>
        </div>
        <Switch
          id={id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
          disabled={disabled}
        />
      </div>
    );
  }

  if (field.type === "money") {
    return (
      <div className="space-y-1">
        <Label htmlFor={id} className="text-[11px]">
          {field.label}
        </Label>
        <MoneyInput
          id={id}
          valuePaise={typeof value === "number" ? value : null}
          onChangePaise={(paise) => onChange(paise === null ? null : paise)}
          disabled={disabled}
        />
        <p className="text-muted-foreground text-[11px]">{field.helpText}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px]">
        {field.label}
      </Label>
      <Input
        id={id}
        type={field.type === "number" ? "number" : "text"}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") return onChange(null);
          onChange(field.type === "number" ? Number(raw) : raw);
        }}
        disabled={disabled}
      />
      <p className="text-muted-foreground text-[11px]">{field.helpText}</p>
    </div>
  );
}
