"use client";

import * as React from "react";
import { ImagePlus, Plus, Sparkles, Trash2 } from "lucide-react";

import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect, MultiSelect } from "@/components/shared/combobox";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { MoneyInput } from "@/components/shared/money-input";
import { NumberStepper } from "@/components/shared/number-stepper";
import { useMediaPicker } from "@/components/shared/media-picker";

import type { ManualCustomizationOption, ManualProductInfo } from "../manual-types";

/**
 * The line editor of the manual order form (blueprint §4, §11.9).
 *
 * An operator keying a phone order must be able to answer the same
 * personalisation questions the storefront asks, because a personalised line
 * without its answers cannot be made. The option definitions come from the
 * product itself, so a new question added by the catalogue team appears here
 * with no change to this file.
 */

export type ManualAnswerValue = string | string[] | boolean | { mediaAssetIds: string[] };

export type ManualLineState = {
  key: string;
  product: EntityRef | null;
  info: ManualProductInfo | null;
  loading: boolean;
  error: string | null;
  variantId: string | null;
  quantity: number;
  answers: Record<string, ManualAnswerValue>;
  overridePaise: number | null;
  overrideReason: string;
};

export function emptyLine(): ManualLineState {
  return {
    key: Math.random().toString(36).slice(2, 10),
    product: null,
    info: null,
    loading: false,
    error: null,
    variantId: null,
    quantity: 1,
    answers: {},
    overridePaise: null,
    overrideReason: "",
  };
}

/** Per-unit surcharge preview; the server recomputes it authoritatively. */
function answerDeltaPaise(option: ManualCustomizationOption, value: ManualAnswerValue | undefined): number {
  if (value === undefined || value === null || value === "" || value === false) return 0;
  let delta = option.priceDeltaPaise;
  if (option.kind === "choice") {
    const picked = Array.isArray(value) ? value : [String(value)];
    for (const choice of option.choices) if (picked.includes(choice.value)) delta += choice.priceDeltaPaise;
  }
  return delta;
}

function CustomizationField({
  option,
  value,
  onChange,
}: {
  option: ManualCustomizationOption;
  value: ManualAnswerValue | undefined;
  onChange: (next: ManualAnswerValue) => void;
}) {
  const picker = useMediaPicker();
  const id = `opt-${option.id}`;
  const delta = answerDeltaPaise(option, value);

  const pickFiles = async () => {
    const picked = await picker.open({ accept: "image", multiple: option.multiple });
    if (!picked || picked.length === 0) return;
    const existing = value && typeof value === "object" && !Array.isArray(value) ? value.mediaAssetIds : [];
    const ids = option.multiple ? [...existing, ...picked.map((asset) => asset.id)] : [picked[0].id];
    onChange({ mediaAssetIds: ids.slice(0, Math.max(1, option.maxFiles ?? 1)) });
  };

  const fileIds = value && typeof value === "object" && !Array.isArray(value) ? value.mediaAssetIds : [];

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {option.label}
        {option.isRequired ? <span className="text-destructive"> *</span> : null}
        {delta > 0 ? <span className="text-muted-foreground ml-1 font-normal">+{formatPaise(delta)}/unit</span> : null}
      </Label>

      {option.kind === "text" ? (
        (option.maxLength ?? 0) > 120 ? (
          <Textarea
            id={id}
            rows={2}
            maxLength={option.maxLength ?? undefined}
            placeholder={option.placeholder ?? undefined}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <Input
            id={id}
            maxLength={option.maxLength ?? undefined}
            placeholder={option.placeholder ?? undefined}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          />
        )
      ) : null}

      {option.kind === "choice" && !option.multiple ? (
        <SearchableSelect
          id={id}
          options={option.choices.map((choice) => ({
            value: choice.value,
            label: choice.priceDeltaPaise > 0 ? `${choice.label} (+${formatPaise(choice.priceDeltaPaise)})` : choice.label,
          }))}
          value={typeof value === "string" ? value : null}
          onChange={(next) => onChange(next ?? "")}
          allowClear
          placeholder="Choose…"
        />
      ) : null}

      {option.kind === "choice" && option.multiple ? (
        <MultiSelect
          id={id}
          options={option.choices.map((choice) => ({ value: choice.value, label: choice.label }))}
          value={Array.isArray(value) ? value : []}
          onChange={(next) => onChange(next)}
          placeholder="Choose…"
        />
      ) : null}

      {option.kind === "boolean" ? (
        <label className="flex items-center gap-2 text-xs">
          <Checkbox id={id} checked={value === true} onCheckedChange={(checked) => onChange(checked === true)} />
          {option.helpText ?? "Yes"}
        </label>
      ) : null}

      {option.kind === "file" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="xs" variant="outline" onClick={() => void pickFiles()}>
            <ImagePlus /> {fileIds.length > 0 ? `${fileIds.length} file selected` : "Pick from media"}
          </Button>
          {fileIds.length > 0 ? (
            <Button type="button" size="xs" variant="ghost" onClick={() => onChange({ mediaAssetIds: [] })}>
              Clear
            </Button>
          ) : null}
          {picker.element}
        </div>
      ) : null}

      {option.helpText && option.kind !== "boolean" ? <p className="text-muted-foreground text-[11px]">{option.helpText}</p> : null}
    </div>
  );
}

function LineCard({
  line,
  index,
  allowOverride,
  onChange,
  onRemove,
  onPickProduct,
}: {
  line: ManualLineState;
  index: number;
  allowOverride: boolean;
  onChange: (patch: Partial<ManualLineState>) => void;
  onRemove: () => void;
  onPickProduct: (ref: EntityRef | null) => void;
}) {
  const info = line.info;
  const variant = info?.variants.find((row) => row.id === line.variantId) ?? null;
  const unitPaise = line.overridePaise ?? variant?.pricePaise ?? 0;
  const extras = (info?.customizationOptions ?? []).reduce((sum, option) => sum + answerDeltaPaise(option, line.answers[option.id]), 0);

  return (
    <li className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <Label className="text-xs">Product {index + 1}</Label>
          <EntityPicker kind="product" value={line.product} onChange={onPickProduct} placeholder="Search products…" className="mt-1" />
          {line.loading ? <p className="text-muted-foreground mt-1 text-[11px]">Loading variants…</p> : null}
          {line.error ? <p className="text-destructive mt-1 text-[11px]">{line.error}</p> : null}
          {info?.problem ? <p className="text-destructive mt-1 text-[11px]">{info.problem}</p> : null}
        </div>
        <Button type="button" size="icon-xs" variant="ghost" aria-label={`Remove line ${index + 1}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>

      {info && !info.problem ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label className="text-xs">Variant</Label>
              <SearchableSelect
                options={info.variants.map((row) => ({
                  value: row.id,
                  label: `${row.name}${row.optionsLabel ? ` — ${row.optionsLabel}` : ""}`,
                  description: `${formatPaise(row.pricePaise)} · ${row.available} available${row.sku ? ` · ${row.sku}` : ""}`,
                }))}
                value={line.variantId}
                onChange={(next) => onChange({ variantId: next })}
                placeholder="Choose a variant"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Quantity</Label>
              <NumberStepper
                value={line.quantity}
                onChange={(next) => onChange({ quantity: next })}
                min={info.minOrderQty}
                max={info.maxOrderQty ?? 1000}
                aria-label="Quantity"
              />
              {variant ? (
                <p className={variant.available < line.quantity && !variant.allowBackorder ? "text-destructive text-[11px]" : "text-muted-foreground text-[11px]"}>
                  {variant.available} in stock
                </p>
              ) : null}
            </div>
          </div>

          {allowOverride ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs">Unit price override</Label>
                <MoneyInput
                  valuePaise={line.overridePaise ?? undefined}
                  onChangePaise={(next) => onChange({ overridePaise: next })}
                  allowEmpty
                  placeholder={variant ? formatPaise(variant.pricePaise) : "Catalogue price"}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Reason for the override</Label>
                <Input
                  value={line.overrideReason}
                  onChange={(event) => onChange({ overrideReason: event.target.value })}
                  placeholder="Negotiated on the phone…"
                  disabled={line.overridePaise === null}
                />
              </div>
            </div>
          ) : null}

          {info.customizationOptions.length > 0 ? (
            <div className="bg-muted/30 space-y-3 rounded-md border p-3">
              <p className="text-muted-foreground flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide">
                <Sparkles className="size-3" /> Personalisation
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {info.customizationOptions.map((option) => (
                  <CustomizationField
                    key={option.id}
                    option={option}
                    value={line.answers[option.id]}
                    onChange={(next) => onChange({ answers: { ...line.answers, [option.id]: next } })}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <p className="text-muted-foreground text-right text-[11px]">
            {formatPaise(unitPaise + extras)} × {line.quantity} ={" "}
            <span data-numeric className="text-foreground font-medium">
              {formatPaise((unitPaise + extras) * line.quantity)}
            </span>
            <span className="ml-1">(before discounts and tax)</span>
          </p>
        </>
      ) : null}
    </li>
  );
}

export function ManualOrderItems({
  lines,
  allowOverride,
  onChange,
  onPickProduct,
}: {
  lines: ManualLineState[];
  allowOverride: boolean;
  onChange: (lines: ManualLineState[]) => void;
  onPickProduct: (key: string, ref: EntityRef | null) => void;
}) {
  const patch = (key: string, values: Partial<ManualLineState>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...values } : line)));

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {lines.map((line, index) => (
          <LineCard
            key={line.key}
            line={line}
            index={index}
            allowOverride={allowOverride}
            onChange={(values) => patch(line.key, values)}
            onRemove={() => onChange(lines.length === 1 ? [emptyLine()] : lines.filter((row) => row.key !== line.key))}
            onPickProduct={(ref) => onPickProduct(line.key, ref)}
          />
        ))}
      </ul>
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...lines, emptyLine()])}>
        <Plus /> Add another item
      </Button>
    </div>
  );
}
