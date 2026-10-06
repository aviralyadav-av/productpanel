"use client";

import * as React from "react";
import { KeyRound, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FormRow } from "@/components/shared/form-layout";
import { MoneyInput } from "@/components/shared/money-input";
import type { PickedAsset } from "@/components/shared/media-picker";

import {
  MULTILINE_SETTING_KEYS,
  isMediaSettingKey,
  type SettingFieldView,
} from "@/features/settings/schemas";

/**
 * One generated control for one Setting, chosen by `type` (blueprint §14.E2).
 *
 * Everything is a string in and a string out, because the Setting column is a
 * string: MoneyInput hands back paise, the switch hands back "true"/"false",
 * and JSON is validated on the server. That keeps the form state a flat
 * `Record<string, string>` that can be diffed and posted as-is.
 *
 * Secrets follow D4: the stored value never arrives, the field shows what is
 * stored ("Set ····1234") and stays empty until the operator chooses Change.
 * Empty therefore means "unchanged", which is exactly what the service does.
 */
export function SettingField({
  field,
  value,
  onChange,
  error,
  disabled,
  onPickMedia,
}: {
  field: SettingFieldView;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  disabled?: boolean;
  /** Opens the media library; returns null when cancelled. */
  onPickMedia?: () => Promise<PickedAsset | null>;
}) {
  const id = `setting-${field.key.replace(/\./g, "-")}`;
  const label = (
    <span className="flex flex-wrap items-center gap-1.5">
      {field.label}
      {field.isPublic ? (
        <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">
          visible to the website
        </Badge>
      ) : null}
      <code className="text-muted-foreground/70 text-[10px]">{field.key}</code>
    </span>
  );

  if (field.type === "boolean") {
    return (
      <FormRow label={label} htmlFor={id} hint={field.helpText} error={error} inline>
        <Switch
          id={id}
          checked={value === "true"}
          onCheckedChange={(checked) => onChange(checked ? "true" : "false")}
          disabled={disabled}
        />
      </FormRow>
    );
  }

  if (field.type === "money") {
    return (
      <FormRow label={label} htmlFor={id} hint={field.helpText} error={error}>
        <MoneyInput
          id={id}
          valuePaise={value === "" ? null : Number(value)}
          onChangePaise={(paise) => onChange(paise === null ? "" : String(paise))}
          disabled={disabled}
          allowEmpty={false}
          className="max-w-xs"
        />
      </FormRow>
    );
  }

  if (field.type === "number") {
    return (
      <FormRow label={label} htmlFor={id} hint={field.helpText} error={error}>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          step={1}
          min={0}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          className="max-w-40"
        />
      </FormRow>
    );
  }

  if (field.type === "secret") {
    return (
      <SecretField
        id={id}
        label={label}
        field={field}
        value={value}
        onChange={onChange}
        error={error}
        disabled={disabled}
      />
    );
  }

  if (field.type === "json") {
    return (
      <FormRow
        label={label}
        htmlFor={id}
        hint={`${field.helpText} JSON is validated before saving.`}
        error={error}
      >
        <Textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          spellCheck={false}
          rows={6}
          aria-invalid={Boolean(error)}
          className="font-mono text-[11px]"
        />
      </FormRow>
    );
  }

  if (isMediaSettingKey(field.key)) {
    return (
      <MediaField
        id={id}
        label={label}
        field={field}
        value={value}
        onChange={onChange}
        error={error}
        disabled={disabled}
        onPickMedia={onPickMedia}
      />
    );
  }

  if (MULTILINE_SETTING_KEYS.includes(field.key)) {
    return (
      <FormRow label={label} htmlFor={id} hint={field.helpText} error={error}>
        <Textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          rows={field.key === "seo.robots_txt" ? 8 : 3}
          aria-invalid={Boolean(error)}
          className={field.key === "seo.robots_txt" ? "font-mono text-[11px]" : undefined}
        />
      </FormRow>
    );
  }

  return (
    <FormRow label={label} htmlFor={id} hint={field.helpText} error={error}>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={Boolean(error)}
      />
    </FormRow>
  );
}

function SecretField({
  id,
  label,
  field,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string;
  label: React.ReactNode;
  field: SettingFieldView;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const isSet = field.secret?.isSet ?? false;

  if (!editing) {
    return (
      <FormRow label={label} htmlFor={id} hint={field.helpText} error={error} inline>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
            <KeyRound className="size-3.5" />
            {isSet
              ? field.secret?.last4
                ? `Set (····${field.secret.last4})`
                : "Set"
              : "Not set"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            {isSet ? "Change" : "Set"}
          </Button>
        </div>
      </FormRow>
    );
  }

  return (
    <FormRow
      label={label}
      htmlFor={id}
      hint={`${field.helpText} Encrypted at rest; leave empty to keep the stored value.`}
      error={error}
    >
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          placeholder="Enter the new value"
        />
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => {
            onChange("");
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </FormRow>
  );
}

function MediaField({
  id,
  label,
  field,
  value,
  onChange,
  error,
  disabled,
  onPickMedia,
}: {
  id: string;
  label: React.ReactNode;
  field: SettingFieldView;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  disabled?: boolean;
  onPickMedia?: () => Promise<PickedAsset | null>;
}) {
  // The hydrated preview only matches the SAVED id; once the operator picks a
  // different asset we show the picked one instead.
  const [picked, setPicked] = React.useState<{ url: string; alt: string | null } | null>(null);
  const preview = picked ?? (field.media && field.media.id === value ? field.media : null);

  async function pick() {
    if (!onPickMedia) return;
    const asset = await onPickMedia();
    if (!asset) return;
    setPicked({ url: asset.url, alt: asset.alt ?? null });
    onChange(asset.id);
  }

  return (
    <FormRow label={label} htmlFor={id} hint={field.helpText} error={error}>
      <div className="flex items-center gap-3">
        <div className="bg-muted relative size-16 shrink-0 overflow-hidden rounded-md border">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- our own uploaded asset; the media library renders these the same way
            <img
              src={preview.url}
              alt={preview.alt ?? "Selected image"}
              className="absolute inset-0 size-full object-contain"
            />
          ) : (
            <span className="text-muted-foreground flex h-full items-center justify-center text-[10px]">
              none
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="xs" onClick={pick} disabled={disabled}>
            {value ? "Replace" : "Choose image"}
          </Button>
          {value ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={disabled}
              onClick={() => {
                setPicked(null);
                onChange("");
              }}
            >
              <Trash2 className="size-3.5" />
              Clear
            </Button>
          ) : null}
          <code className="text-muted-foreground/70 text-[10px]">{value || "unset"}</code>
        </div>
      </div>
    </FormRow>
  );
}
