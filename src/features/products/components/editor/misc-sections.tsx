"use client";

import { ImagePlus, X } from "lucide-react";

import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import { KeyValueEditor } from "@/components/shared/key-value-editor";
import { ProductThumb } from "@/components/shared/product-thumb";
import { TagInput } from "@/components/shared/tag-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";

import type { Picker, SectionProps } from "./basics-section";

export function ShippingSection({ state, set, errors, disabled }: SectionProps) {
  return (
    <FormSection id="shipping" title="Shipping" description="Weight and dimensions feed shipping rates; the note is shown to the shopper at checkout (e.g. made to order, ships in 5 days).">
      <FormRowGroup columns={2}>
        <FormRow label="Weight (g)" htmlFor="weightGrams" error={errors.weightGrams}>
          <Input id="weightGrams" type="number" min={0} value={state.weightGrams} onChange={(event) => set({ weightGrams: event.target.value })} disabled={disabled} />
        </FormRow>
        <FormRow label="Length (mm)" htmlFor="lengthMm" error={errors.lengthMm}>
          <Input id="lengthMm" type="number" min={0} value={state.lengthMm} onChange={(event) => set({ lengthMm: event.target.value })} disabled={disabled} />
        </FormRow>
        <FormRow label="Width (mm)" htmlFor="widthMm" error={errors.widthMm}>
          <Input id="widthMm" type="number" min={0} value={state.widthMm} onChange={(event) => set({ widthMm: event.target.value })} disabled={disabled} />
        </FormRow>
        <FormRow label="Height (mm)" htmlFor="heightMm" error={errors.heightMm}>
          <Input id="heightMm" type="number" min={0} value={state.heightMm} onChange={(event) => set({ heightMm: event.target.value })} disabled={disabled} />
        </FormRow>
      </FormRowGroup>
      <FormRow label="Shipping note" htmlFor="shippingNote" error={errors.shippingNote}>
        <Textarea id="shippingNote" rows={2} maxLength={500} value={state.shippingNote} onChange={(event) => set({ shippingNote: event.target.value })} disabled={disabled} />
      </FormRow>
    </FormSection>
  );
}

const FLAGS = [
  ["isFeatured", "Featured", "Eligible for featured sections on the homepage."],
  ["isNewArrival", "New arrival", "Shows the New badge and the new-arrivals rail."],
  ["isBestseller", "Bestseller", "Shows the Bestseller badge."],
  ["isTrending", "Trending", "Shows the Trending badge and rail."],
] as const;

export function FlagsSection({ state, set, errors, disabled }: SectionProps) {
  return (
    <FormSection id="flags" title="Flags & ordering" description="Merchandising switches and purchase limits. Position orders products within a category when the shopper has not chosen a sort.">
      <div className="grid gap-2 sm:grid-cols-2">
        {FLAGS.map(([key, label, description]) => (
          <label key={key} className={cn("flex items-start justify-between gap-3 rounded-lg border p-3", disabled && "opacity-60")}>
            <span>
              <span className="text-sm font-medium">{label}</span>
              <span className="text-muted-foreground block text-xs">{description}</span>
            </span>
            <Switch checked={state[key]} onCheckedChange={(checked) => set({ [key]: checked })} disabled={disabled} />
          </label>
        ))}
      </div>
      <FormRowGroup columns={3}>
        <FormRow label="Min order qty" htmlFor="minOrderQty" error={errors.minOrderQty}>
          <Input id="minOrderQty" type="number" min={1} value={state.minOrderQty} onChange={(event) => set({ minOrderQty: event.target.value })} disabled={disabled} />
        </FormRow>
        <FormRow label="Max order qty" htmlFor="maxOrderQty" error={errors.maxOrderQty} hint="Blank = no limit.">
          <Input id="maxOrderQty" type="number" min={1} value={state.maxOrderQty} onChange={(event) => set({ maxOrderQty: event.target.value })} disabled={disabled} />
        </FormRow>
        <FormRow label="Position" htmlFor="position" error={errors.position}>
          <Input id="position" type="number" min={0} value={state.position} onChange={(event) => set({ position: event.target.value })} disabled={disabled} />
        </FormRow>
      </FormRowGroup>
    </FormSection>
  );
}

function LengthMeter({ value, ideal, max }: { value: number; ideal: number; max: number }) {
  const tone = value === 0 ? "text-muted-foreground" : value <= ideal ? "text-success" : value <= max ? "text-warning" : "text-destructive";
  return (
    <span className={cn("text-[11px]", tone)} data-numeric>
      {value}/{ideal}
    </span>
  );
}

export function SeoSection({ state, set, errors, disabled, picker, storefrontBaseUrl }: SectionProps & { picker: Picker; storefrontBaseUrl: string }) {
  const title = state.metaTitle || state.title;
  const description = state.metaDescription || state.shortDescription;
  const url = `${storefrontBaseUrl.replace(/\/+$/, "")}/p/${state.slug || "slug"}`;

  const pickOg = async () => {
    const picked = await picker.open({ accept: "image", multiple: false, title: "Choose a social image" });
    const asset = picked?.[0];
    if (asset) set({ ogImage: { id: asset.id, url: asset.url, thumbnailUrl: asset.thumbnailUrl, filename: asset.filename } });
  };

  return (
    <FormSection id="seo" title="SEO" description="Search-engine title and description; both fall back to the title and short description. Keep the title under 60 characters and the description under 160.">
      <FormRow label={<span className="flex items-center gap-2">Meta title <LengthMeter value={state.metaTitle.length} ideal={60} max={160} /></span>} htmlFor="metaTitle" error={errors.metaTitle}>
        <Input id="metaTitle" value={state.metaTitle} onChange={(event) => set({ metaTitle: event.target.value })} maxLength={160} placeholder={state.title} disabled={disabled} />
      </FormRow>
      <FormRow label={<span className="flex items-center gap-2">Meta description <LengthMeter value={state.metaDescription.length} ideal={160} max={320} /></span>} htmlFor="metaDescription" error={errors.metaDescription}>
        <Textarea id="metaDescription" rows={3} value={state.metaDescription} onChange={(event) => set({ metaDescription: event.target.value })} maxLength={320} placeholder={state.shortDescription} disabled={disabled} />
      </FormRow>
      <FormRow label="Keywords" htmlFor="metaKeywords" error={errors.metaKeywords}>
        <TagInput id="metaKeywords" value={state.metaKeywords} onChange={(metaKeywords) => set({ metaKeywords })} maxTags={30} disabled={disabled} placeholder="Add a keyword" />
      </FormRow>
      <FormRowGroup columns={2}>
        <FormRow label="Canonical URL" htmlFor="canonicalUrl" error={errors.canonicalUrl} hint="Only when this product is a duplicate of another page.">
          <Input id="canonicalUrl" value={state.canonicalUrl} onChange={(event) => set({ canonicalUrl: event.target.value })} placeholder="https://" disabled={disabled} />
        </FormRow>
        <FormRow label="Social image" hint="Defaults to the primary gallery image." error={errors.ogImageMediaId}>
          <div className="flex items-center gap-2">
            {state.ogImage ? <ProductThumb src={state.ogImage.thumbnailUrl ?? state.ogImage.url} alt={state.ogImage.filename} size={40} /> : null}
            <Button type="button" variant="outline" size="sm" onClick={() => void pickOg()} disabled={disabled}>
              <ImagePlus /> {state.ogImage ? "Replace" : "Choose"}
            </Button>
            {state.ogImage ? (
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove social image" onClick={() => set({ ogImage: null })} disabled={disabled}>
                <X />
              </Button>
            ) : null}
          </div>
        </FormRow>
      </FormRowGroup>
      <div className="rounded-lg border p-3">
        <p className="text-muted-foreground mb-1 text-[11px] uppercase tracking-wide">Snippet preview</p>
        <p className="truncate text-sm font-medium text-[#1a0dab] dark:text-[#8ab4f8]">{title || "Product title"}</p>
        <p className="text-muted-foreground truncate text-xs">{url}</p>
        <p className="line-clamp-2 text-xs">{description || "A description will appear here."}</p>
      </div>
    </FormSection>
  );
}

export function CustomFieldsSection({ state, set, disabled }: Pick<SectionProps, "state" | "set" | "disabled">) {
  return (
    <FormSection id="custom-fields" title="Custom fields" description="Free-form key/value pairs shown in the specifications table for things the attribute set does not cover (care instructions, artisan, technique).">
      <KeyValueEditor value={state.customFields} onChange={(customFields) => set({ customFields })} keyPlaceholder="Material" valuePlaceholder="Hand-block-printed cotton" maxRows={50} disabled={disabled} />
    </FormSection>
  );
}
