"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2 } from "lucide-react";
import { cn } from "cn";

import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import { MoneyInput } from "@/components/shared/money-input";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CUSTOMIZATION_OPTION_TYPES, CUSTOMIZATION_OPTION_TYPE_META, type CustomizationOptionType } from "@/lib/enums";
import { formatPaise } from "@/lib/money";

import type { CustomizationOptionRecord } from "@/features/products/customization-service";
import { parseChoices, priceDeltaFor, type CustomizationAnswers } from "@/features/products/customization";
import { createCustomizationOptionAction, deleteCustomizationOptionAction, reorderCustomizationOptionsAction, updateCustomizationOptionAction } from "@/features/products/editor-actions";
import type { EditorProduct } from "@/features/products/queries";
import { CUSTOMIZATION_IMAGE_MIMES, customizationOptionSchema, isChoiceType, isFileType, isTextType } from "@/features/products/schemas";

import type { Picker } from "./basics-section";

/**
 * Customisation option builder (brief §4). Each option is an inline card that
 * saves on its own; the live preview on the right renders the exact form the
 * storefront will show and prices the sample answers with the same pure
 * function the orders module uses at checkout, so a surcharge is never a
 * surprise.
 */
type Draft = {
  type: CustomizationOptionType;
  label: string;
  helpText: string;
  placeholder: string;
  isRequired: boolean;
  minLength: number | null;
  maxLength: number | null;
  maxFiles: number | null;
  allowedMimeTypes: Array<(typeof CUSTOMIZATION_IMAGE_MIMES)[number]>;
  choices: Array<{ value: string; label: string; priceDeltaPaise: number; imageUrl: string | null }>;
  priceDeltaPaise: number;
  isActive: boolean;
};

const emptyDraft = (): Draft => ({ type: "TEXT", label: "", helpText: "", placeholder: "", isRequired: false, minLength: null, maxLength: null, maxFiles: null, allowedMimeTypes: [], choices: [], priceDeltaPaise: 0, isActive: true });

const draftOf = (option: CustomizationOptionRecord): Draft => ({
  type: option.type as CustomizationOptionType,
  label: option.label,
  helpText: option.helpText ?? "",
  placeholder: option.placeholder ?? "",
  isRequired: option.isRequired,
  minLength: option.minLength,
  maxLength: option.maxLength,
  maxFiles: option.maxFiles,
  allowedMimeTypes: option.allowedMimeTypes.filter((mime): mime is Draft["allowedMimeTypes"][number] => (CUSTOMIZATION_IMAGE_MIMES as readonly string[]).includes(mime)),
  choices: parseChoices(option.choices).map((choice) => ({ value: choice.value, label: choice.label ?? choice.value, priceDeltaPaise: choice.priceDeltaPaise ?? 0, imageUrl: choice.imageUrl ?? null })),
  priceDeltaPaise: option.priceDeltaPaise,
  isActive: option.isActive,
});

export function CustomizationSection({ product, disabled, picker }: { product: EditorProduct; disabled: boolean; picker: Picker }) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [adding, setAdding] = React.useState(false);
  const options = product.customizationOptions;

  const move = async (index: number, direction: -1 | 1) => {
    const ids = options.map((option) => option.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await run(() => reorderCustomizationOptionsAction(product.id, ids), { silent: true, onSuccess: () => router.refresh() });
  };

  return (
    <FormSection
      id="customization"
      title="Customisation"
      description="What the shopper is asked before adding to cart: names, messages, photos, design choices. Answers are validated at checkout and frozen on the order line. A product is customisable exactly when it has an active option."
      actions={
        <span className="flex items-center gap-2">
          <StatusPill label={product.isCustomizable ? "Customisable" : "Not customisable"} tone={product.isCustomizable ? "brand" : "neutral"} />
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)} disabled={disabled || adding}>
            <Plus /> Add option
          </Button>
        </span>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]" onKeyDown={(event) => event.key === "Enter" && event.target instanceof HTMLInputElement && event.preventDefault()}>
        <div className="space-y-3">
          {options.length === 0 && !adding ? <p className="text-muted-foreground text-xs">No options yet. Add one to make this product customisable.</p> : null}
          {options.map((option, index) => (
            <OptionCard
              key={option.id}
              productId={product.id}
              option={option}
              disabled={disabled}
              picker={picker}
              onMove={(direction) => void move(index, direction)}
              canUp={index > 0}
              canDown={index < options.length - 1}
              pending={pending}
            />
          ))}
          {adding ? <OptionCard productId={product.id} option={null} disabled={disabled} picker={picker} onClose={() => setAdding(false)} pending={pending} /> : null}
        </div>
        <LivePreview options={options} />
      </div>
    </FormSection>
  );
}

function OptionCard({
  productId,
  option,
  disabled,
  picker,
  onMove,
  canUp,
  canDown,
  onClose,
  pending: parentPending,
}: {
  productId: string;
  option: CustomizationOptionRecord | null;
  disabled: boolean;
  picker: Picker;
  onMove?: (direction: -1 | 1) => void;
  canUp?: boolean;
  canDown?: boolean;
  onClose?: () => void;
  pending: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [open, setOpen] = React.useState(option === null);
  const [draft, setDraft] = React.useState<Draft>(() => (option ? draftOf(option) : emptyDraft()));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const savedJson = option ? JSON.stringify(draftOf(option)) : null;
  const dirty = JSON.stringify(draft) !== savedJson;
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const busy = disabled || pending || parentPending;

  const save = async () => {
    const parsed = customizationOptionSchema.safeParse(draft);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[issue.path.join(".")] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    const action = option ? updateCustomizationOptionAction(productId, option.id, parsed.data) : createCustomizationOptionAction(productId, draft);
    await run(() => action, {
      onSuccess: () => {
        onClose?.();
        if (option) setOpen(false);
        router.refresh();
      },
      onError: (result) => result.fieldErrors && setErrors(result.fieldErrors),
    });
  };

  const remove = () => option && run(() => deleteCustomizationOptionAction(productId, option.id), { onSuccess: () => router.refresh() });

  const choiceType = isChoiceType(draft.type);
  const fileType = isFileType(draft.type);
  const textType = isTextType(draft.type);

  const updateChoice = (index: number, next: Partial<Draft["choices"][number]>) => patch({ choices: draft.choices.map((choice, i) => (i === index ? { ...choice, ...next } : choice)) });
  const pickChoiceImage = async (index: number) => {
    const picked = await picker.open({ accept: "image", multiple: false, title: "Choice image" });
    if (picked?.[0]) updateChoice(index, { imageUrl: picked[0].url });
  };

  return (
    <div className={cn("rounded-lg border", !draft.isActive && "opacity-70")}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen((value) => !value)}>
          <StatusPill label={CUSTOMIZATION_OPTION_TYPE_META[draft.type].label} tone={CUSTOMIZATION_OPTION_TYPE_META[draft.type].tone} dot={false} />
          <span className="truncate text-sm font-medium">{draft.label || "New option"}</span>
          {draft.isRequired ? <span className="text-destructive text-xs">required</span> : null}
          {draft.priceDeltaPaise ? <span className="text-muted-foreground text-xs">+{formatPaise(draft.priceDeltaPaise)}</span> : null}
          {!draft.isActive ? <span className="text-muted-foreground text-xs">inactive</span> : null}
        </button>
        {onMove ? (
          <>
            <Button type="button" size="icon-xs" variant="ghost" aria-label="Move up" disabled={busy || !canUp} onClick={() => onMove(-1)}>
              <ArrowUp />
            </Button>
            <Button type="button" size="icon-xs" variant="ghost" aria-label="Move down" disabled={busy || !canDown} onClick={() => onMove(1)}>
              <ArrowDown />
            </Button>
          </>
        ) : null}
        {option ? (
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Delete option" disabled={busy} onClick={() => void remove()}>
            <Trash2 />
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-3 border-t p-3">
          <FormRowGroup columns={2}>
            <FormRow label="Type" required error={errors.type}>
              <Select value={draft.type} onValueChange={(type) => patch({ type: type as CustomizationOptionType })} disabled={disabled}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOMIZATION_OPTION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {CUSTOMIZATION_OPTION_TYPE_META[type].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
            <FormRow label="Label" required error={errors.label}>
              <Input value={draft.label} onChange={(event) => patch({ label: event.target.value })} maxLength={120} disabled={disabled} />
            </FormRow>
          </FormRowGroup>
          <FormRowGroup columns={2}>
            <FormRow label="Help text" error={errors.helpText}>
              <Input value={draft.helpText ?? ""} onChange={(event) => patch({ helpText: event.target.value })} maxLength={300} disabled={disabled} />
            </FormRow>
            <FormRow label="Placeholder" error={errors.placeholder}>
              <Input value={draft.placeholder ?? ""} onChange={(event) => patch({ placeholder: event.target.value })} maxLength={120} disabled={disabled} />
            </FormRow>
          </FormRowGroup>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={draft.isRequired} onCheckedChange={(isRequired) => patch({ isRequired })} disabled={disabled} /> Required
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={draft.isActive} onCheckedChange={(isActive) => patch({ isActive })} disabled={disabled} /> Active
            </label>
            <FormRow label="Surcharge per unit" inline error={errors.priceDeltaPaise}>
              <MoneyInput valuePaise={draft.priceDeltaPaise} onChangePaise={(paise) => patch({ priceDeltaPaise: paise ?? 0 })} className="w-32" disabled={disabled} />
            </FormRow>
          </div>
          {textType ? (
            <FormRowGroup columns={2}>
              <FormRow label="Min length" error={errors.minLength}>
                <Input type="number" min={0} value={draft.minLength ?? ""} onChange={(event) => patch({ minLength: event.target.value === "" ? null : Number(event.target.value) })} disabled={disabled} />
              </FormRow>
              <FormRow label="Max length" error={errors.maxLength}>
                <Input type="number" min={1} value={draft.maxLength ?? ""} onChange={(event) => patch({ maxLength: event.target.value === "" ? null : Number(event.target.value) })} disabled={disabled} />
              </FormRow>
            </FormRowGroup>
          ) : null}
          {fileType ? (
            <FormRowGroup columns={2}>
              <FormRow label="Max files" error={errors.maxFiles} hint="1-10; uploads are private media.">
                <Input type="number" min={1} max={10} value={draft.maxFiles ?? ""} onChange={(event) => patch({ maxFiles: event.target.value === "" ? null : Number(event.target.value) })} disabled={disabled} />
              </FormRow>
              <FormRow label="Allowed types" hint="Blank = JPEG, PNG and WebP.">
                <div className="flex flex-wrap gap-2">
                  {CUSTOMIZATION_IMAGE_MIMES.map((mime) => {
                    const on = (draft.allowedMimeTypes ?? []).includes(mime);
                    return (
                      <Button key={mime} type="button" size="xs" variant={on ? "secondary" : "outline"} disabled={disabled} onClick={() => patch({ allowedMimeTypes: on ? (draft.allowedMimeTypes ?? []).filter((item) => item !== mime) : [...(draft.allowedMimeTypes ?? []), mime] })}>
                        {mime.replace("image/", "").toUpperCase()}
                      </Button>
                    );
                  })}
                </div>
              </FormRow>
            </FormRowGroup>
          ) : null}
          {choiceType ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">Choices</p>
                <Button type="button" size="xs" variant="outline" disabled={disabled} onClick={() => patch({ choices: [...draft.choices, { value: "", label: "", priceDeltaPaise: 0, imageUrl: null }] })}>
                  <Plus /> Add choice
                </Button>
              </div>
              {errors.choices ? <p className="text-destructive text-xs">{errors.choices}</p> : null}
              {draft.choices.map((choice, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_7rem_auto_auto] items-center gap-2">
                  <Input value={choice.value} onChange={(event) => updateChoice(index, { value: event.target.value })} placeholder="value" className="h-7 font-mono text-xs" disabled={disabled} aria-label="Choice value" aria-invalid={!!errors[`choices.${index}.value`]} />
                  <Input value={choice.label} onChange={(event) => updateChoice(index, { label: event.target.value })} placeholder="Label" className="h-7 text-xs" disabled={disabled} aria-label="Choice label" />
                  <MoneyInput valuePaise={choice.priceDeltaPaise} onChangePaise={(paise) => updateChoice(index, { priceDeltaPaise: paise ?? 0 })} className="h-7" disabled={disabled} />
                  <Button type="button" size="icon-xs" variant={choice.imageUrl ? "secondary" : "ghost"} aria-label="Choice image" disabled={disabled} onClick={() => void pickChoiceImage(index)}>
                    <ImagePlus />
                  </Button>
                  <Button type="button" size="icon-xs" variant="ghost" aria-label="Remove choice" disabled={disabled} onClick={() => patch({ choices: draft.choices.filter((_, i) => i !== index) })}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            {onClose ? (
              <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={() => void save()} disabled={busy || (!!option && !dirty)}>
              {pending ? "Saving" : option ? "Save option" : "Add option"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** What the shopper sees, driven by the saved options and priced live. */
function LivePreview({ options }: { options: CustomizationOptionRecord[] }) {
  const [answers, setAnswers] = React.useState<CustomizationAnswers>({});
  const active = options.filter((option) => option.isActive);
  const delta = priceDeltaFor(options, answers);
  const setAnswer = (id: string, value: CustomizationAnswers[string]) => setAnswers((current) => ({ ...current, [id]: value }));

  return (
    <aside className="bg-muted/40 space-y-3 rounded-lg border p-3">
      <p className="text-xs font-medium">Customer preview</p>
      {active.length === 0 ? <p className="text-muted-foreground text-xs">Nothing to show - add an active option.</p> : null}
      {active.map((option) => {
        const choices = parseChoices(option.choices);
        return (
          <div key={option.id} className="space-y-1">
            <label className="text-xs font-medium">
              {option.label}
              {option.isRequired ? <span className="text-destructive"> *</span> : null}
              {option.priceDeltaPaise ? <span className="text-muted-foreground font-normal"> (+{formatPaise(option.priceDeltaPaise)})</span> : null}
            </label>
            {option.helpText ? <p className="text-muted-foreground text-[11px]">{option.helpText}</p> : null}
            {option.type === "CHECKBOX" ? (
              <Switch checked={answers[option.id] === true} onCheckedChange={(checked) => setAnswer(option.id, checked)} />
            ) : isChoiceType(option.type) ? (
              <Select value={typeof answers[option.id] === "string" ? (answers[option.id] as string) : ""} onValueChange={(value) => setAnswer(option.id, value)}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue placeholder={option.placeholder ?? "Choose"} />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((choice) => (
                    <SelectItem key={choice.value} value={choice.value}>
                      {choice.label}
                      {choice.priceDeltaPaise ? ` (+${formatPaise(choice.priceDeltaPaise)})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : isFileType(option.type) ? (
              <div className="text-muted-foreground rounded border border-dashed p-2 text-[11px]">
                Upload up to {option.maxFiles ?? 1} photo(s) · {(option.allowedMimeTypes.length ? option.allowedMimeTypes : [...CUSTOMIZATION_IMAGE_MIMES]).map((mime) => mime.replace("image/", "").toUpperCase()).join(", ")}
              </div>
            ) : option.type === "MESSAGE" || option.type === "INSTRUCTIONS" ? (
              <Textarea rows={2} className="text-xs" placeholder={option.placeholder ?? ""} maxLength={option.maxLength ?? undefined} value={typeof answers[option.id] === "string" ? (answers[option.id] as string) : ""} onChange={(event) => setAnswer(option.id, event.target.value)} />
            ) : (
              <Input className="h-7 text-xs" placeholder={option.placeholder ?? ""} maxLength={option.maxLength ?? undefined} value={typeof answers[option.id] === "string" ? (answers[option.id] as string) : ""} onChange={(event) => setAnswer(option.id, event.target.value)} />
            )}
          </div>
        );
      })}
      {active.length > 0 ? (
        <p className="border-t pt-2 text-xs">
          Customisation surcharge: <strong data-numeric>{formatPaise(delta)}</strong> per unit
        </p>
      ) : null}
    </aside>
  );
}
