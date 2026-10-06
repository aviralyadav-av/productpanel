"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Lock } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import { useActionToast } from "@/components/shared/use-action-toast";
import {
  ATTRIBUTE_FILTER_TYPES,
  ATTRIBUTE_FILTER_TYPE_META,
  ATTRIBUTE_INPUT_TYPES,
  ATTRIBUTE_INPUT_TYPE_META,
  type AttributeFilterType,
  type AttributeInputType,
} from "@/lib/enums";

import { createAttributeAction, updateAttributeAction } from "../actions";
import { COMPATIBLE_FILTER_TYPES, defaultFilterTypeFor, isAttributeInputType } from "../compat";
import { attributeInputSchema, type AttributeInput } from "../schemas";
import type { AttributeRecord, AttributeUsage } from "../service";

/**
 * Attribute definition form. Two rules are enforced in the UI as well as the
 * service so the operator is never surprised by a rejected save: the code is
 * locked after creation (it is the storefront filter key), and the filter
 * widget list is narrowed to what the input type can render - changing the
 * type snaps the widget to its natural default.
 */
type FormValues = {
  code: string;
  name: string;
  description: string;
  inputType: AttributeInputType;
  filterType: AttributeFilterType;
  unit: string;
  isVariantDefining: boolean;
  isFilterableDefault: boolean;
  isGlobal: boolean;
  position: string;
  isActive: boolean;
};

function initial(attribute: AttributeRecord | undefined): FormValues {
  const inputType = attribute && isAttributeInputType(attribute.inputType) ? attribute.inputType : "SELECT";
  return {
    code: attribute?.code ?? "",
    name: attribute?.name ?? "",
    description: attribute?.description ?? "",
    inputType,
    filterType: (attribute?.filterType as AttributeFilterType | undefined) ?? "CHECKBOX",
    unit: attribute?.unit ?? "",
    isVariantDefining: attribute?.isVariantDefining ?? false,
    isFilterableDefault: attribute?.isFilterableDefault ?? true,
    isGlobal: attribute?.isGlobal ?? false,
    position: attribute ? String(attribute.position) : "0",
    isActive: attribute?.isActive ?? true,
  };
}

function codeFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+|_+$/g, "")
    .slice(0, 60);
}

export function AttributeForm({
  mode,
  attribute,
  usage,
  canManage,
}: {
  mode: "create" | "edit";
  attribute?: AttributeRecord;
  usage?: AttributeUsage;
  canManage: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [values, setValues] = React.useState<FormValues>(() => initial(attribute));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);
  const [codeTouched, setCodeTouched] = React.useState(mode === "edit");
  const readOnly = !canManage || pending;

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: "" } : current));
    setDirty(true);
  }

  function setName(name: string) {
    setValues((current) => ({ ...current, name, code: codeTouched ? current.code : codeFromName(name) }));
    setDirty(true);
  }

  function setInputType(inputType: AttributeInputType) {
    setValues((current) => ({
      ...current,
      inputType,
      filterType: COMPATIBLE_FILTER_TYPES[inputType].includes(current.filterType) ? current.filterType : defaultFilterTypeFor(inputType),
      isVariantDefining: inputType === "SELECT" || inputType === "COLOR" ? current.isVariantDefining : false,
    }));
    setDirty(true);
  }

  const allowedFilters = COMPATIBLE_FILTER_TYPES[values.inputType];
  const canDefineVariants = values.inputType === "SELECT" || values.inputType === "COLOR";
  const typeLocked = mode === "edit" && Boolean(usage && (usage.products > 0 || usage.variants > 0));
  const variantLocked = mode === "edit" && Boolean(attribute?.isVariantDefining && usage && usage.variants > 0);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    const input: AttributeInput = {
      code: values.code,
      name: values.name,
      description: values.description,
      inputType: values.inputType,
      filterType: values.filterType,
      unit: values.unit,
      isVariantDefining: values.isVariantDefining,
      isFilterableDefault: values.isFilterableDefault,
      isGlobal: values.isGlobal,
      position: Number(values.position || 0),
      isActive: values.isActive,
    };
    const parsed = attributeInputSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    const result = await run(
      () => (mode === "create" ? createAttributeAction(parsed.data) : updateAttributeAction(attribute!.id, parsed.data)),
      {
        onSuccess: (saved) => {
          setDirty(false);
          if (mode === "create") router.push(`/admin/attributes/${saved.id}` as Route);
          else router.refresh();
        },
      },
    );
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <FormSection title="Definition" description="What the attribute is called and how products record it.">
        <FormRowGroup columns={2}>
          <FormRow label="Name" htmlFor="attr-name" required error={errors.name}>
            <Input id="attr-name" value={values.name} onChange={(event) => setName(event.target.value)} disabled={readOnly} maxLength={120} autoFocus={mode === "create"} />
          </FormRow>
          <FormRow
            label={
              <span className="inline-flex items-center gap-1">
                Code {mode === "edit" ? <Lock className="text-muted-foreground size-3" /> : null}
              </span>
            }
            htmlFor="attr-code"
            required
            error={errors.code}
            hint={mode === "edit" ? "Locked: the storefront filters by this key (attr[code]=…)." : "Lowercase, no spaces; becomes the public filter key and cannot change later."}
          >
            <Input
              id="attr-code"
              value={values.code}
              onChange={(event) => {
                setCodeTouched(true);
                set("code", event.target.value);
              }}
              disabled={readOnly || mode === "edit"}
              readOnly={mode === "edit"}
              maxLength={60}
              className="font-mono"
              aria-invalid={Boolean(errors.code) || undefined}
            />
          </FormRow>
        </FormRowGroup>

        <FormRow label="Description" htmlFor="attr-description" error={errors.description} hint="Internal note for other operators; not shown on the storefront.">
          <Textarea id="attr-description" value={values.description} onChange={(event) => set("description", event.target.value)} disabled={readOnly} rows={2} maxLength={1000} />
        </FormRow>

        <FormRowGroup columns={3}>
          <FormRow
            label="Input type"
            htmlFor="attr-input-type"
            error={errors.inputType}
            hint={typeLocked ? "Locked while products or variants carry values for this attribute." : ATTRIBUTE_INPUT_TYPE_META[values.inputType].description}
          >
            <Select value={values.inputType} onValueChange={(value) => setInputType(value as AttributeInputType)} disabled={readOnly || typeLocked}>
              <SelectTrigger id="attr-input-type" size="sm" className="w-full" aria-invalid={Boolean(errors.inputType) || undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ATTRIBUTE_INPUT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {ATTRIBUTE_INPUT_TYPE_META[type].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Filter widget" htmlFor="attr-filter-type" error={errors.filterType} hint="How the storefront lets shoppers filter by it.">
            <Select value={values.filterType} onValueChange={(value) => set("filterType", value as AttributeFilterType)} disabled={readOnly}>
              <SelectTrigger id="attr-filter-type" size="sm" className="w-full" aria-invalid={Boolean(errors.filterType) || undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ATTRIBUTE_FILTER_TYPES.map((type) => (
                  <SelectItem key={type} value={type} disabled={!allowedFilters.includes(type)}>
                    {ATTRIBUTE_FILTER_TYPE_META[type].label}
                    {!allowedFilters.includes(type) ? " (not for this type)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Unit" htmlFor="attr-unit" error={errors.unit} hint="Shown after values, e.g. cm, g, ml.">
            <Input id="attr-unit" value={values.unit} onChange={(event) => set("unit", event.target.value)} disabled={readOnly} maxLength={20} placeholder="—" />
          </FormRow>
        </FormRowGroup>
      </FormSection>

      <FormSection title="Behaviour" description="Defaults a category inherits when this attribute is assigned; categories can override each of them.">
        <FormRowGroup columns={2}>
          <FormRow
            inline
            label="Global"
            htmlFor="attr-global"
            hint="Automatically part of EVERY category's attribute set, without assigning it anywhere. Categories can still exclude it."
          >
            <Switch id="attr-global" checked={values.isGlobal} onCheckedChange={(value) => set("isGlobal", value)} disabled={readOnly} />
          </FormRow>
          <FormRow inline label="Filterable by default" htmlFor="attr-filterable" hint="New category assignments start with the filter switched on.">
            <Switch id="attr-filterable" checked={values.isFilterableDefault} onCheckedChange={(value) => set("isFilterableDefault", value)} disabled={readOnly} />
          </FormRow>
          <FormRow
            inline
            label="Variant-defining"
            htmlFor="attr-variant"
            error={errors.isVariantDefining}
            hint={
              variantLocked
                ? `${usage?.variants ?? 0} variant(s) use this axis; remove or remap them before turning this off.`
                : canDefineVariants
                  ? "Products can generate variants from its values (Size, Colour)."
                  : "Only single-select and colour attributes can define variants."
            }
          >
            <Switch
              id="attr-variant"
              checked={values.isVariantDefining}
              onCheckedChange={(value) => set("isVariantDefining", value)}
              disabled={readOnly || !canDefineVariants || variantLocked}
            />
          </FormRow>
          <FormRow inline label="Active" htmlFor="attr-active" hint="Inactive attributes keep their values but drop out of every filter and product form.">
            <Switch id="attr-active" checked={values.isActive} onCheckedChange={(value) => set("isActive", value)} disabled={readOnly} />
          </FormRow>
        </FormRowGroup>
        <FormRow label="Position" htmlFor="attr-position" error={errors.position} hint="Default order among filters; lower first.">
          <Input id="attr-position" type="number" min={0} step={1} inputMode="numeric" value={values.position} onChange={(event) => set("position", event.target.value)} disabled={readOnly} className="max-w-32" />
        </FormRow>
      </FormSection>

      {canManage ? (
        <FormActions dirty={dirty} pending={pending} submitLabel={mode === "create" ? "Create attribute" : "Save changes"} onCancel={() => router.push("/admin/attributes")} />
      ) : null}
    </form>
  );
}
