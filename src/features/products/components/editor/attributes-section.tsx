"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import type { EffectiveAttribute } from "@/features/catalog/attribute-resolution";
import { isSelectType } from "@/features/catalog/attribute-resolution-core";
import { MultiSelect, SearchableSelect } from "@/components/shared/combobox";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { FormRow, FormSection } from "@/components/shared/form-layout";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { removeProductAttributeAction } from "@/features/products/editor-actions";
import type { EditorProduct } from "@/features/products/queries";

import type { SectionProps } from "./basics-section";
import { EMPTY_ATTRIBUTE_VALUE, type AttributeFormValue } from "./form-state";

/**
 * Dynamic attribute form from the category's effective set (blueprint A1):
 * SELECT → searchable select, MULTI_SELECT → multi select, COLOR → swatch
 * select, TEXT/NUMBER/BOOLEAN → their inputs. Values derived from variants
 * are shown read-only (the variants section owns them). Attributes with
 * values that the current category no longer defines are listed separately
 * with a Remove action (A6).
 */
export function AttributesSection({ state, set, errors, disabled, effective, product }: SectionProps & { effective: EffectiveAttribute[]; product: EditorProduct | null }) {
  const router = useRouter();
  const { run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();

  const valueOf = (attributeId: string): AttributeFormValue => state.attributeValues[attributeId] ?? EMPTY_ATTRIBUTE_VALUE;
  const update = (attributeId: string, patch: Partial<AttributeFormValue>) =>
    set({ attributeValues: { ...state.attributeValues, [attributeId]: { ...valueOf(attributeId), ...patch } } });

  const variantAttributeIds = new Set((product?.attributeValues ?? []).filter((row) => row.fromVariants).map((row) => row.attributeId));
  const variantLabels = (attributeId: string, entry: EffectiveAttribute) =>
    (product?.attributeValues ?? [])
      .filter((row) => row.fromVariants && row.attributeId === attributeId)
      .map((row) => entry.values.find((value) => value.id === row.valueId)?.label ?? entry.values.find((value) => value.id === row.valueId)?.value ?? "?")
      .join(", ");

  const removeOrphan = async (attributeId: string, name: string) => {
    if (!product) return;
    const answer = await confirm({ title: `Remove ${name}`, description: "Deletes every value this product holds for the attribute. Variants keep their own values.", confirmLabel: "Remove", destructive: true });
    if (!answer.ok) return;
    await run(() => removeProductAttributeAction(product.id, attributeId), { onSuccess: () => router.refresh() });
  };

  const sourceLabel = (entry: EffectiveAttribute) => (entry.source === "own" ? "Category" : entry.source === "inherited" ? "Inherited" : "Global");

  return (
    <FormSection
      id="attributes"
      title="Attributes"
      description={state.categoryId ? "The attribute set of the chosen category and its ancestors plus global attributes. Required ones must be filled before publishing; filterable ones become storefront facets." : "Choose a category to see its attributes. Global attributes are always available."}
    >
      {effective.length === 0 ? <p className="text-muted-foreground text-xs">No attributes apply. Add global attributes or assign an attribute set to the category.</p> : null}
      {effective.map((entry) => {
        const { attribute } = entry;
        const value = valueOf(attribute.id);
        const fromVariants = entry.isVariant && variantAttributeIds.has(attribute.id);
        const options = entry.values.filter((item) => item.isActive || value.valueIds.includes(item.id)).map((item) => ({ value: item.id, label: item.label ?? item.value, description: item.colorHex ?? undefined }));
        const hint = (
          <span className="flex flex-wrap items-center gap-1.5">
            <span>{sourceLabel(entry)}</span>
            {entry.isVariant ? <StatusPill label="Variant axis" tone="brand" dot={false} className="h-4 px-1.5 text-[10px]" /> : null}
            {entry.isFilterable ? <StatusPill label="Filter" tone="info" dot={false} className="h-4 px-1.5 text-[10px]" /> : null}
            {fromVariants ? <span>· From variants: {variantLabels(attribute.id, entry) || "none yet"}</span> : null}
          </span>
        );
        const id = `attr-${attribute.code}`;
        return (
          <FormRow key={attribute.id} label={attribute.unit ? `${attribute.name} (${attribute.unit})` : attribute.name} htmlFor={id} required={entry.isRequired} hint={hint} error={errors[`attributeValues.${attribute.id}`]}>
            {attribute.inputType === "MULTI_SELECT" ? (
              <MultiSelect id={id} options={options} value={value.valueIds} onChange={(valueIds) => update(attribute.id, { valueIds })} placeholder={`Choose ${attribute.name.toLowerCase()}`} disabled={disabled} />
            ) : isSelectType(attribute.inputType) ? (
              <SearchableSelect
                id={id}
                options={options}
                value={value.valueIds[0] ?? null}
                onChange={(valueId) => update(attribute.id, { valueIds: valueId ? [valueId] : [] })}
                placeholder={fromVariants ? "Set per variant" : `Choose ${attribute.name.toLowerCase()}`}
                allowClear
                disabled={disabled}
                renderOption={
                  attribute.inputType === "COLOR"
                    ? (option) => (
                        <span className="flex items-center gap-2">
                          <span className="size-3.5 rounded-full border" style={{ backgroundColor: option.description ?? "transparent" }} aria-hidden />
                          {option.label}
                        </span>
                      )
                    : undefined
                }
              />
            ) : attribute.inputType === "NUMBER" ? (
              <div className="flex items-center gap-2">
                <Input id={id} type="number" step="any" value={value.number} onChange={(event) => update(attribute.id, { number: event.target.value })} className="w-40" disabled={disabled} />
                {attribute.unit ? <span className="text-muted-foreground text-xs">{attribute.unit}</span> : null}
              </div>
            ) : attribute.inputType === "BOOLEAN" ? (
              <div className="flex items-center gap-2">
                <Switch id={id} checked={value.bool === true} onCheckedChange={(checked) => update(attribute.id, { bool: checked })} disabled={disabled} />
                <span className="text-muted-foreground text-xs">{value.bool === null ? "Not set" : value.bool ? "Yes" : "No"}</span>
                {value.bool !== null ? (
                  <Button type="button" size="xs" variant="ghost" onClick={() => update(attribute.id, { bool: null })} disabled={disabled}>
                    Clear
                  </Button>
                ) : null}
              </div>
            ) : (
              <Input id={id} value={value.text} onChange={(event) => update(attribute.id, { text: event.target.value })} maxLength={500} disabled={disabled} />
            )}
          </FormRow>
        );
      })}

      {product && product.orphanAttributes.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <p className="text-xs font-medium">Attributes not in {product.category?.name ?? "this category"}</p>
          <p className="text-muted-foreground text-xs">Kept from a previous category (blueprint A6). They are not shown as filters or specs; remove what no longer applies.</p>
          <ul className="divide-y text-xs">
            {product.orphanAttributes.map((orphan) => (
              <li key={orphan.attributeId} className="flex items-center justify-between gap-3 py-1.5">
                <span>
                  <span className="font-medium">{orphan.name}</span> <span className="text-muted-foreground">({orphan.code})</span>: {orphan.labels.join(", ") || "—"}
                  {orphan.fromVariants ? <span className="text-muted-foreground"> · from variants</span> : null}
                </span>
                <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => void removeOrphan(orphan.attributeId, orphan.name)}>
                  <Trash2 /> Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {confirmDialog}
    </FormSection>
  );
}
