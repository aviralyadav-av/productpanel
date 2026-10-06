"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Images, Plus, Save, Trash2, Wand2 } from "lucide-react";

import type { EffectiveAttribute } from "@/features/catalog/attribute-resolution";
import { MultiSelect, SearchableSelect } from "@/components/shared/combobox";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { FormRow, FormSection } from "@/components/shared/form-layout";
import { MoneyInput } from "@/components/shared/money-input";
import { StatusPill, StockBadge } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatNumber } from "@/lib/money";

import {
  createVariantAction,
  deleteVariantAction,
  generateVariantsAction,
  setDefaultVariantAction,
  setVariantImagesAction,
  updateVariantAction,
} from "@/features/products/editor-actions";
import type { EditorProduct, EditorVariant } from "@/features/products/queries";

import type { Picker } from "./basics-section";

/**
 * Variants (blueprint A5). Axes come from the category's variant attributes;
 * "Generate" upserts the cartesian product and reports created/kept/
 * deactivated. Rows edit inline and save one at a time, because a variant
 * table is where an operator fixes one SKU, not where they retype twenty.
 * Enter inside a row is swallowed so it never submits the surrounding form.
 */
export function VariantsSection({ product, effective, disabled, picker }: { product: EditorProduct; effective: EffectiveAttribute[]; disabled: boolean; picker: Picker }) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [addOpen, setAddOpen] = React.useState(false);

  const axisAttributes = effective.filter((entry) => entry.isVariant && ["SELECT", "COLOR"].includes(entry.attribute.inputType));
  const [axes, setAxes] = React.useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const variant of product.variants.filter((item) => item.isActive)) {
      for (const pair of variant.attributeValues) {
        initial[pair.attributeId] = [...new Set([...(initial[pair.attributeId] ?? []), pair.valueId])];
      }
    }
    return initial;
  });
  const combinations = axisAttributes.reduce((count, entry) => count * Math.max(1, (axes[entry.attribute.id] ?? []).length), axisAttributes.some((entry) => (axes[entry.attribute.id] ?? []).length > 0) ? 1 : 0);

  const generate = async () => {
    const payload = axisAttributes
      .filter((entry) => (axes[entry.attribute.id] ?? []).length > 0)
      .map((entry) => ({ attributeId: entry.attribute.id, valueIds: axes[entry.attribute.id] }));
    if (payload.length === 0) return;
    const existingActive = product.variants.filter((item) => item.isActive && item.optionKey === null).length;
    if (existingActive > 0) {
      const answer = await confirm({
        title: "Generate variants",
        description: `${existingActive} variant(s) without attribute values (e.g. "Default") will be deactivated - combinations not produced by the axes are never kept active. Existing matching variants keep their SKU, price and stock.`,
        confirmLabel: "Generate",
      });
      if (!answer.ok) return;
    }
    await run(() => generateVariantsAction(product.id, { axes: payload }), { onSuccess: () => router.refresh() });
  };

  const stopEnter = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
  };

  return (
    <FormSection
      id="variants"
      title="Variants"
      description="Each sellable combination has its own SKU, stock and optional price. Blank prices inherit the product price. Variants referenced by orders are deactivated, never deleted."
      actions={
        <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)} disabled={disabled}>
          <Plus /> Add variant
        </Button>
      }
    >
      <div onKeyDown={stopEnter} className="space-y-4">
        {axisAttributes.length > 0 ? (
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs font-medium">Generate from attributes</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {axisAttributes.map((entry) => (
                <FormRow key={entry.attribute.id} label={entry.attribute.name} htmlFor={`axis-${entry.attribute.code}`}>
                  <MultiSelect
                    id={`axis-${entry.attribute.code}`}
                    options={entry.values.filter((value) => value.isActive || (axes[entry.attribute.id] ?? []).includes(value.id)).map((value) => ({ value: value.id, label: value.label ?? value.value, description: value.colorHex ?? undefined }))}
                    value={axes[entry.attribute.id] ?? []}
                    onChange={(valueIds) => setAxes((current) => ({ ...current, [entry.attribute.id]: valueIds }))}
                    placeholder={`Pick ${entry.attribute.name.toLowerCase()} values`}
                    disabled={disabled}
                  />
                </FormRow>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">{combinations > 0 ? `${combinations} combination${combinations === 1 ? "" : "s"} (max 200).` : "Pick at least one value."}</p>
              <Button type="button" size="sm" onClick={() => void generate()} disabled={disabled || pending || combinations === 0 || combinations > 200}>
                <Wand2 /> Generate variants
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            {product.categoryId ? "This category has no variant attributes. Mark an attribute as a variant axis on the category, or add variants by hand." : "Choose and save a category to generate variants from its attributes."}
          </p>
        )}

        <div className="overflow-x-auto rounded-lg border">
          <DataTable>
            <DataTableHead>
              <Th>Variant</Th>
              <Th>SKU / barcode</Th>
              <Th align="right">Price</Th>
              <Th align="right">Sale</Th>
              <Th align="right">Cost</Th>
              <Th align="right">Weight (g)</Th>
              <Th align="right">Stock</Th>
              <Th>Active</Th>
              <Th>Default</Th>
              <Th>Images</Th>
              <Th />
            </DataTableHead>
            <DataTableBody>
              {product.variants.length === 0 ? (
                <Tr>
                  <Td colSpan={11} className="text-muted-foreground py-6 text-center text-xs">
                    No variants yet.
                  </Td>
                </Tr>
              ) : null}
              {product.variants.map((variant) => (
                <VariantRow key={variant.id} product={product} variant={variant} disabled={disabled} picker={picker} confirm={confirm} />
              ))}
            </DataTableBody>
          </DataTable>
        </div>
      </div>

      <AddVariantDialog open={addOpen} onOpenChange={setAddOpen} product={product} axisAttributes={axisAttributes} />
      {confirmDialog}
    </FormSection>
  );
}

type RowDraft = { name: string; sku: string; barcode: string; pricePaise: number | null; salePricePaise: number | null; costPaise: number | null; weightGrams: string };

const draftOf = (variant: EditorVariant): RowDraft => ({
  name: variant.name,
  sku: variant.sku ?? "",
  barcode: variant.barcode ?? "",
  pricePaise: variant.pricePaise,
  salePricePaise: variant.salePricePaise,
  costPaise: variant.costPaise,
  weightGrams: variant.weightGrams === null ? "" : String(variant.weightGrams),
});

function VariantRow({
  product,
  variant,
  disabled,
  picker,
  confirm,
}: {
  product: EditorProduct;
  variant: EditorVariant;
  disabled: boolean;
  picker: Picker;
  confirm: ReturnType<typeof useConfirm>[0];
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [draft, setDraft] = React.useState<RowDraft>(() => draftOf(variant));
  const saved = draftOf(variant);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const patch = (next: Partial<RowDraft>) => setDraft((current) => ({ ...current, ...next }));

  const save = () =>
    run(
      () =>
        updateVariantAction(product.id, variant.id, {
          name: draft.name,
          sku: draft.sku || null,
          barcode: draft.barcode || null,
          pricePaise: draft.pricePaise,
          salePricePaise: draft.salePricePaise,
          costPaise: draft.costPaise,
          weightGrams: draft.weightGrams.trim() === "" ? null : Number(draft.weightGrams),
        }),
      { onSuccess: () => router.refresh() },
    );

  const toggleActive = (isActive: boolean) => run(() => updateVariantAction(product.id, variant.id, { isActive }), { onSuccess: () => router.refresh() });
  const makeDefault = () => run(() => setDefaultVariantAction(product.id, variant.id), { onSuccess: () => router.refresh() });

  const pickImages = async () => {
    const picked = await picker.open({ accept: "image", multiple: true, title: `Images for ${variant.name}` });
    if (!picked) return;
    const ids = [...new Set([...variant.images.map((image) => image.mediaId), ...picked.map((asset) => asset.id)])];
    await run(() => setVariantImagesAction(product.id, variant.id, ids), { onSuccess: () => router.refresh() });
  };
  const clearImages = () => run(() => setVariantImagesAction(product.id, variant.id, []), { onSuccess: () => router.refresh() });

  const remove = async () => {
    const answer = await confirm({ title: "Delete variant", description: `Delete "${variant.name}"? Its SKU is freed; stock history is kept.`, destructive: true, confirmLabel: "Delete" });
    if (!answer.ok) return;
    await run(() => deleteVariantAction(product.id, variant.id), { onSuccess: () => router.refresh() });
  };

  const muted = !variant.isActive ? "opacity-60" : "";
  return (
    <Tr className={muted}>
      <Td>
        <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} className="h-7 min-w-36 text-xs" disabled={disabled} aria-label="Variant name" />
        {variant.optionKey ? <span className="text-muted-foreground block max-w-40 truncate font-mono text-[10px]">{variant.optionKey}</span> : <span className="text-muted-foreground text-[10px]">manual</span>}
      </Td>
      <Td>
        <Input value={draft.sku} onChange={(event) => patch({ sku: event.target.value })} placeholder="SKU" className="h-7 w-32 font-mono text-xs" disabled={disabled} aria-label="SKU" />
        <Input value={draft.barcode} onChange={(event) => patch({ barcode: event.target.value })} placeholder="Barcode" className="mt-1 h-7 w-32 font-mono text-xs" disabled={disabled} aria-label="Barcode" />
      </Td>
      <Td align="right">
        <MoneyInput valuePaise={draft.pricePaise} onChangePaise={(pricePaise) => patch({ pricePaise })} placeholder="Inherit" allowEmpty className="w-28" disabled={disabled} />
      </Td>
      <Td align="right">
        <MoneyInput valuePaise={draft.salePricePaise} onChangePaise={(salePricePaise) => patch({ salePricePaise })} placeholder="—" allowEmpty className="w-28" disabled={disabled} />
      </Td>
      <Td align="right">
        <MoneyInput valuePaise={draft.costPaise} onChangePaise={(costPaise) => patch({ costPaise })} placeholder="—" allowEmpty className="w-28" disabled={disabled} />
      </Td>
      <Td align="right">
        <Input type="number" min={0} value={draft.weightGrams} onChange={(event) => patch({ weightGrams: event.target.value })} className="h-7 w-20 text-xs" disabled={disabled} aria-label="Weight" />
      </Td>
      <Td align="right">
        <Link href={`/admin/inventory?variant=${variant.id}` as Route} className="flex flex-col items-end gap-0.5 hover:underline">
          {variant.inventory ? <StockBadge state={variant.inventory.stockState} /> : <StatusPill label="No inventory" tone="warning" />}
          <span data-numeric className="text-muted-foreground text-[11px]">
            {variant.inventory ? `${formatNumber(variant.inventory.available)} avail · ${formatNumber(variant.inventory.onHand)} on hand` : "—"}
          </span>
        </Link>
      </Td>
      <Td>
        <Switch checked={variant.isActive} onCheckedChange={(checked) => void toggleActive(checked)} disabled={disabled || pending} aria-label="Active" />
      </Td>
      <Td>
        <input type="radio" name={`default-${product.id}`} checked={variant.isDefault} onChange={() => void makeDefault()} disabled={disabled || pending || !variant.isActive} aria-label="Default variant" className="accent-brand size-3.5" />
      </Td>
      <Td>
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="xs" onClick={() => void pickImages()} disabled={disabled}>
            <Images /> {variant.images.length}
          </Button>
          {variant.images.length > 0 ? (
            <Button type="button" variant="ghost" size="xs" onClick={() => void clearImages()} disabled={disabled}>
              Clear
            </Button>
          ) : null}
        </div>
      </Td>
      <Td>
        <div className="flex items-center gap-1">
          <Button type="button" size="xs" variant={dirty ? "default" : "ghost"} onClick={() => void save()} disabled={disabled || pending || !dirty} aria-label="Save variant">
            <Save />
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => void remove()} disabled={disabled || pending} aria-label="Delete variant">
            <Trash2 />
          </Button>
        </div>
      </Td>
    </Tr>
  );
}

function AddVariantDialog({ open, onOpenChange, product, axisAttributes }: { open: boolean; onOpenChange: (open: boolean) => void; product: EditorProduct; axisAttributes: EffectiveAttribute[] }) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [name, setName] = React.useState("");
  const [sku, setSku] = React.useState("");
  const [pricePaise, setPricePaise] = React.useState<number | null>(null);
  const [openingStock, setOpeningStock] = React.useState("0");
  const [values, setValues] = React.useState<Record<string, string | null>>({});

  const chosen = axisAttributes.filter((entry) => values[entry.attribute.id]).map((entry) => ({ attributeId: entry.attribute.id, valueId: values[entry.attribute.id] as string }));
  const suggestedName = axisAttributes
    .map((entry) => entry.values.find((value) => value.id === values[entry.attribute.id]))
    .filter(Boolean)
    .map((value) => value?.label ?? value?.value)
    .join(" / ");

  const submit = async () => {
    await run(
      () => createVariantAction(product.id, { name: name || suggestedName || "Variant", sku: sku || null, barcode: null, pricePaise, salePricePaise: null, costPaise: null, weightGrams: null, isActive: true, attributeValues: chosen, openingStock: Number(openingStock) || 0 }),
      {
        onSuccess: () => {
          onOpenChange(false);
          setName("");
          setSku("");
          setPricePaise(null);
          setOpeningStock("0");
          setValues({});
          router.refresh();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a variant</DialogTitle>
          <DialogDescription>For a combination the generator does not cover, or a free-form option such as a gift box. An inventory row is created with the opening stock.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {axisAttributes.map((entry) => (
            <FormRow key={entry.attribute.id} label={entry.attribute.name}>
              <SearchableSelect
                options={entry.values.filter((value) => value.isActive).map((value) => ({ value: value.id, label: value.label ?? value.value }))}
                value={values[entry.attribute.id] ?? null}
                onChange={(valueId) => setValues((current) => ({ ...current, [entry.attribute.id]: valueId }))}
                placeholder={`Any ${entry.attribute.name.toLowerCase()}`}
                allowClear
              />
            </FormRow>
          ))}
          <FormRow label="Name" required>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={suggestedName || "e.g. Gift box"} />
          </FormRow>
          <div className="grid grid-cols-3 gap-3">
            <FormRow label="SKU">
              <Input value={sku} onChange={(event) => setSku(event.target.value)} className="font-mono" />
            </FormRow>
            <FormRow label="Price" hint="Blank inherits">
              <MoneyInput valuePaise={pricePaise} onChangePaise={setPricePaise} allowEmpty />
            </FormRow>
            <FormRow label="Opening stock">
              <Input type="number" min={0} value={openingStock} onChange={(event) => setOpeningStock(event.target.value)} />
            </FormRow>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" size="sm" onClick={() => void submit()} disabled={pending || !(name || suggestedName)}>
            {pending ? "Adding" : "Add variant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
