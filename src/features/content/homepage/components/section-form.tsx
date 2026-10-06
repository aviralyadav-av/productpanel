"use client";

import * as React from "react";

import { LINK_TYPE_META } from "@/lib/enums";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EntityPicker, type EntityKind as PickerKind, type EntityRef } from "@/components/shared/entity-picker";
import { FormRow } from "@/components/shared/form-layout";
import type { PickedAsset } from "@/components/shared/media-picker";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import {
  formValuesToPayload,
  payloadToFormValues,
  type FieldDescriptor,
  type FormValue,
  type FormValues,
} from "@/features/content/registry";
import { MediaField } from "@/features/banners/components/media-field";

/**
 * The generic section / block editor (blueprint §14.E1): renders whatever
 * FieldDescriptor list the registry hands it, one control per FieldType, and
 * converts back to a payload through the SAME descriptors
 * (`formValuesToPayload`). Adding a section type therefore needs zero UI work.
 *
 * Form values are strings/booleans (registry-forms contract); ids picked
 * through EntityPicker / MediaPicker are mirrored into `refs` / `media` so the
 * chips and thumbnails can render without a second fetch.
 */

export type FieldState = {
  values: FormValues;
  /** Chips for `entity` / `entity-list` fields (first element for single). */
  refs: Record<string, EntityRef[]>;
  /** Asset for `media` / `image` fields. */
  media: Record<string, PickedAsset | null>;
};

export function initialFieldState(
  fields: FieldDescriptor[],
  payload: Record<string, unknown>,
  refs: Record<string, EntityRef[]> = {},
  media: Record<string, PickedAsset | null> = {},
): FieldState {
  return { values: payloadToFormValues(fields, payload), refs: { ...refs }, media: { ...media } };
}

export function fieldStateToPayload(fields: FieldDescriptor[], state: FieldState): Record<string, unknown> {
  return formValuesToPayload(fields, state.values);
}

/** Registry entity kinds the shared picker can search; the rest fall back to an id list. */
const PICKER_KINDS: readonly PickerKind[] = ["product", "category", "seller", "page", "blog"];

function pickerKind(kind: string | undefined): PickerKind | null {
  return kind && (PICKER_KINDS as readonly string[]).includes(kind) ? (kind as PickerKind) : null;
}

function kindForLinkType(linkType: FormValue | undefined): PickerKind | null {
  switch (linkType) {
    case "CATEGORY":
      return "category";
    case "PRODUCT":
      return "product";
    case "PAGE":
      return "page";
    case "BLOG":
      return "blog";
    default:
      return null;
  }
}

function splitIds(value: FormValue | undefined): string[] {
  return typeof value === "string"
    ? value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function optionLabel(field: FieldDescriptor, option: string): string {
  if (field.name === "linkType" || field.linkTypeField) {
    const meta = LINK_TYPE_META[option as keyof typeof LINK_TYPE_META];
    if (meta) return meta.label;
  }
  return option.charAt(0).toUpperCase() + option.slice(1).replace(/[_-]/g, " ");
}

export function SectionForm({
  fields,
  state,
  onChange,
  errors = {},
  errorPrefix = "payload.",
  disabled = false,
  idPrefix = "field",
  pickMedia,
  pickImage,
}: {
  fields: FieldDescriptor[];
  state: FieldState;
  onChange: (next: FieldState) => void;
  errors?: Record<string, string>;
  /** Service field errors arrive as `payload.<name>`; strip this to match. */
  errorPrefix?: string;
  disabled?: boolean;
  idPrefix?: string;
  /** Opens the media library for one asset; resolves null when dismissed. */
  pickMedia: (title?: string) => Promise<PickedAsset | null>;
  /** RichTextEditor image insertion. */
  pickImage: () => Promise<{ url: string; alt?: string } | null>;
}) {
  const errorFor = (name: string) => errors[name] ?? errors[`${errorPrefix}${name}`];

  const setValue = (name: string, value: FormValue) => onChange({ ...state, values: { ...state.values, [name]: value } });
  const setRefs = (name: string, refs: EntityRef[]) =>
    onChange({ ...state, values: { ...state.values, [name]: refs.map((ref) => ref.id).join(", ") }, refs: { ...state.refs, [name]: refs } });
  const setMedia = (name: string, asset: PickedAsset | null) =>
    onChange({ ...state, values: { ...state.values, [name]: asset?.id ?? "" }, media: { ...state.media, [name]: asset } });

  const visible = (field: FieldDescriptor): boolean => {
    if (!field.linkTypeField) return true;
    const linkType = state.values[field.linkTypeField];
    if (field.type === "url" || field.type === "link") return linkType === "URL";
    if (field.type === "entity") return kindForLinkType(linkType) !== null;
    return true;
  };

  return (
    <div className="space-y-4">
      {fields.filter(visible).map((field) => {
        const id = `${idPrefix}-${field.name}`;
        const value = state.values[field.name];
        const text = typeof value === "string" ? value : "";
        const error = errorFor(field.name);
        const common = { label: field.label, htmlFor: id, hint: field.helpText, error, required: field.required };

        switch (field.type) {
          case "boolean":
            return (
              <FormRow key={field.name} {...common} inline>
                <Switch id={id} checked={value === true} onCheckedChange={(checked) => setValue(field.name, checked)} disabled={disabled} />
              </FormRow>
            );

          case "select":
            return (
              <FormRow key={field.name} {...common}>
                <Select value={text || undefined} onValueChange={(next) => setValue(field.name, next)} disabled={disabled}>
                  <SelectTrigger id={id} aria-invalid={Boolean(error) || undefined} className="w-full">
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(field.options ?? []).map((option) => (
                      <SelectItem key={option} value={option}>
                        {optionLabel(field, option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormRow>
            );

          case "textarea":
            return (
              <FormRow key={field.name} {...common}>
                <Textarea id={id} rows={field.rows ?? 3} value={text} onChange={(event) => setValue(field.name, event.target.value)} placeholder={field.placeholder} disabled={disabled} aria-invalid={Boolean(error) || undefined} />
              </FormRow>
            );

          case "richtext":
            return (
              <FormRow key={field.name} {...common}>
                <RichTextEditor id={id} value={text} onChange={(html) => setValue(field.name, html)} onPickImage={pickImage} disabled={disabled} minHeight={Math.max(160, (field.rows ?? 6) * 24)} />
              </FormRow>
            );

          case "number":
            return (
              <FormRow key={field.name} {...common}>
                <Input id={id} type="number" inputMode="numeric" value={text} onChange={(event) => setValue(field.name, event.target.value)} placeholder={field.placeholder} disabled={disabled} aria-invalid={Boolean(error) || undefined} className="max-w-40" />
              </FormRow>
            );

          case "color":
            return (
              <FormRow key={field.name} {...common}>
                <div className="flex items-center gap-2">
                  <input type="color" aria-label={`${field.label} swatch`} value={/^#[0-9a-f]{6}$/i.test(text) ? text : "#000000"} onChange={(event) => setValue(field.name, event.target.value)} disabled={disabled} className="size-8 cursor-pointer rounded border bg-transparent p-0.5" />
                  <Input id={id} value={text} onChange={(event) => setValue(field.name, event.target.value)} placeholder="#1f3d2b" disabled={disabled} aria-invalid={Boolean(error) || undefined} className="max-w-40 font-mono" />
                </div>
              </FormRow>
            );

          case "image":
          case "media":
            return (
              <FormRow key={field.name} {...common}>
                <MediaField value={state.media[field.name] ?? null} onChange={(asset) => setMedia(field.name, asset)} onPick={() => pickMedia(`Choose ${field.label.toLowerCase()}`)} disabled={disabled} />
              </FormRow>
            );

          case "entity": {
            const kind = field.linkTypeField ? kindForLinkType(state.values[field.linkTypeField]) : pickerKind(field.entityKind);
            if (kind) {
              return (
                <FormRow key={field.name} {...common}>
                  <EntityPicker id={id} kind={kind} value={state.refs[field.name]?.[0] ?? null} onChange={(ref) => setRefs(field.name, ref ? [ref] : [])} disabled={disabled} invalid={Boolean(error)} placeholder={`Choose a ${kind}`} />
                </FormRow>
              );
            }
            return (
              <FormRow key={field.name} {...common} hint={field.helpText ?? `Paste the ${field.entityKind ?? "record"} id.`}>
                <Input id={id} value={text} onChange={(event) => setValue(field.name, event.target.value)} disabled={disabled} aria-invalid={Boolean(error) || undefined} className="font-mono" />
              </FormRow>
            );
          }

          case "entity-list": {
            const kind = pickerKind(field.entityKind);
            if (kind) {
              return (
                <FormRow key={field.name} {...common} hint={field.helpText ?? (field.maxItems ? `Up to ${field.maxItems}.` : undefined)}>
                  <EntityPicker id={id} kind={kind} multiple value={state.refs[field.name] ?? []} onChange={(refs) => setRefs(field.name, field.maxItems ? refs.slice(0, field.maxItems) : refs)} disabled={disabled} invalid={Boolean(error)} placeholder={`Add ${kind === "category" ? "categories" : `${kind}s`}`} />
                </FormRow>
              );
            }
            if (field.entityKind === "media") {
              return (
                <FormRow key={field.name} {...common}>
                  <MediaListField ids={splitIds(value)} refs={state.refs[field.name] ?? []} onChange={(refs) => setRefs(field.name, refs)} pickMedia={pickMedia} disabled={disabled} />
                </FormRow>
              );
            }
            return (
              <FormRow key={field.name} {...common} hint={field.helpText ?? `One ${field.entityKind ?? "record"} id per line (copy them from the ${field.entityKind ?? "record"} list). Order is kept.`}>
                <Textarea id={id} rows={3} value={text.split(/,\s*/).join("\n")} onChange={(event) => setValue(field.name, splitIds(event.target.value).join(", "))} disabled={disabled} aria-invalid={Boolean(error) || undefined} className="font-mono text-xs" />
                {state.refs[field.name]?.length ? (
                  <ul className="text-muted-foreground mt-1 space-y-0.5 text-[11px]">
                    {state.refs[field.name].map((ref) => (
                      <li key={ref.id} className="truncate">
                        {ref.title}
                        {ref.subtitle ? <span className="opacity-70"> · {ref.subtitle}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </FormRow>
            );
          }

          case "url":
          case "link":
            return (
              <FormRow key={field.name} {...common}>
                <Input id={id} type="text" inputMode="url" value={text} onChange={(event) => setValue(field.name, event.target.value)} placeholder={field.placeholder ?? "https://… or /path"} disabled={disabled} aria-invalid={Boolean(error) || undefined} />
              </FormRow>
            );

          case "text":
          default:
            if (field.options && field.options.length > 0) {
              return (
                <FormRow key={field.name} {...common}>
                  <Select value={text || undefined} onValueChange={(next) => setValue(field.name, next)} disabled={disabled}>
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue placeholder="Choose…" />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {optionLabel(field, option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormRow>
              );
            }
            return (
              <FormRow key={field.name} {...common}>
                <Input id={id} value={text} onChange={(event) => setValue(field.name, event.target.value)} placeholder={field.placeholder} disabled={disabled} aria-invalid={Boolean(error) || undefined} />
              </FormRow>
            );
        }
      })}
    </div>
  );
}

/** Ordered list of media assets for an `entity-list` of kind media. */
function MediaListField({
  ids,
  refs,
  onChange,
  pickMedia,
  disabled,
}: {
  ids: string[];
  refs: EntityRef[];
  onChange: (refs: EntityRef[]) => void;
  pickMedia: (title?: string) => Promise<PickedAsset | null>;
  disabled: boolean;
}) {
  const known = new Map(refs.map((ref) => [ref.id, ref]));
  const rows = ids.map((id) => known.get(id) ?? { id, title: id });
  return (
    <div className="space-y-2">
      {rows.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {rows.map((ref) => (
            <li key={ref.id} className="bg-muted flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
              {ref.imageUrl ? <MediaFieldThumb src={ref.imageUrl} /> : null}
              <span className="max-w-40 truncate">{ref.title}</span>
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onChange(rows.filter((row) => row.id !== ref.id))} disabled={disabled} aria-label={`Remove ${ref.title}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className="text-brand text-xs hover:underline disabled:opacity-50"
        disabled={disabled}
        onClick={async () => {
          const asset = await pickMedia("Add media");
          if (asset && !known.has(asset.id)) onChange([...rows, { id: asset.id, title: asset.filename, imageUrl: asset.thumbnailUrl ?? asset.url }]);
        }}
      >
        + Add media
      </button>
    </div>
  );
}

function MediaFieldThumb({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- admin thumbnails come from the media store, not a known host list
  return <img src={src} alt="" className="size-6 rounded object-cover" />;
}
