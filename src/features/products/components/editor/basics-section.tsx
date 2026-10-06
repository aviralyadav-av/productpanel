"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";

import type { CategoryChangeReport } from "@/features/catalog/publish-validation";
import { EntityPicker } from "@/components/shared/entity-picker";
import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import type { useMediaPicker } from "@/components/shared/media-picker";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { SlugInput } from "@/components/shared/slug-input";
import { TagInput } from "@/components/shared/tag-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { categoryChangeReportAction } from "@/features/products/actions";
import { CategorySelect } from "@/features/products/components/category-select";
import type { EditorBootstrap, EditorProduct } from "@/features/products/queries";

import type { FieldErrors, ProductFormState } from "./form-state";

export type SectionProps = {
  state: ProductFormState;
  set: (patch: Partial<ProductFormState>) => void;
  errors: FieldErrors;
  disabled: boolean;
};

export type Picker = ReturnType<typeof useMediaPicker>;

export function BasicsSection({
  state,
  set,
  errors,
  disabled,
  product,
  bootstrap,
  picker,
  categoryReport,
  onCategoryReport,
}: SectionProps & {
  product: EditorProduct | null;
  bootstrap: EditorBootstrap;
  picker: Picker;
  categoryReport: CategoryChangeReport | null;
  onCategoryReport: (report: CategoryChangeReport | null) => void;
}) {
  // A6: when an existing product changes category, ask the server what would
  // be orphaned or newly required and show it before the operator saves.
  const onCategoryChange = async (categoryId: string | null) => {
    set({ categoryId });
    if (!product || categoryId === product.categoryId) {
      onCategoryReport(null);
      return;
    }
    const result = await categoryChangeReportAction(product.id, categoryId);
    onCategoryReport(result.ok ? result.data : null);
  };

  return (
    <FormSection id="basics" title="Basics" description="What the product is called, where it sits in the catalogue and who sells it. The slug is the storefront URL; it locks once published.">
      <FormRow label="Title" htmlFor="title" required error={errors.title}>
        <Input id="title" value={state.title} onChange={(event) => set({ title: event.target.value })} maxLength={200} disabled={disabled} aria-invalid={!!errors.title} />
      </FormRow>
      <FormRow label="Slug" htmlFor="slug" required error={errors.slug} hint="Lowercase letters, numbers and hyphens.">
        <SlugInput id="slug" sourceValue={state.title} value={state.slug} onChange={(slug) => set({ slug })} locked={!!product?.publishedAt} prefix="/p/" disabled={disabled} invalid={!!errors.slug} />
      </FormRow>
      <FormRowGroup columns={2}>
        <FormRow label="Base SKU" htmlFor="baseSku" hint="Prefix for variant SKUs; uniqueness is per variant." error={errors.baseSku}>
          <Input id="baseSku" value={state.baseSku} onChange={(event) => set({ baseSku: event.target.value })} maxLength={64} disabled={disabled} />
        </FormRow>
        <FormRow label="Brand" htmlFor="brand" error={errors.brand}>
          <Input id="brand" value={state.brand} onChange={(event) => set({ brand: event.target.value })} maxLength={120} disabled={disabled} />
        </FormRow>
      </FormRowGroup>
      <FormRow label="Short description" htmlFor="shortDescription" hint="One or two sentences for cards and search results." error={errors.shortDescription}>
        <Textarea id="shortDescription" value={state.shortDescription} onChange={(event) => set({ shortDescription: event.target.value })} maxLength={500} rows={2} disabled={disabled} />
      </FormRow>
      <FormRow label="Description" htmlFor="description" error={errors.description}>
        <RichTextEditor id="description" value={state.description} onChange={(description) => set({ description })} onPickImage={picker.pickImage} disabled={disabled} minHeight={220} />
      </FormRow>
      <FormRowGroup columns={2}>
        <FormRow label="Category" htmlFor="categoryId" error={errors.categoryId} hint="Decides the attribute set, filters and variant axes.">
          <CategorySelect id="categoryId" categories={bootstrap.categories} value={state.categoryId} onChange={(value) => void onCategoryChange(value)} placeholder="Choose a category" disabled={disabled} invalid={!!errors.categoryId} />
        </FormRow>
        <FormRow label="Seller" htmlFor="sellerId" error={errors.sellerId} hint="Leave empty for products sold by the platform itself.">
          <EntityPicker
            id="sellerId"
            kind="seller"
            value={state.sellerRef}
            onChange={(ref) => set({ sellerRef: ref, sellerId: ref?.id ?? null })}
            placeholder="Platform (no seller)"
            disabled={disabled}
          />
        </FormRow>
      </FormRowGroup>
      {categoryReport && (categoryReport.orphanAttributes.length > 0 || categoryReport.missingRequired.length > 0 || categoryReport.variantAxesLost.length > 0) ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>This category change affects attributes</AlertTitle>
          <AlertDescription className="space-y-1 text-xs">
            {categoryReport.orphanAttributes.length > 0 ? (
              <p>
                Values kept but no longer in the category:{" "}
                {categoryReport.orphanAttributes.map((item) => `${item.name} (${item.valueCount})`).join(", ")}. Remove them in the Attributes section if they no longer apply.
              </p>
            ) : null}
            {categoryReport.missingRequired.length > 0 ? <p>Required here and still empty: {categoryReport.missingRequired.map((item) => item.name).join(", ")}.</p> : null}
            {categoryReport.variantAxesLost.length > 0 ? (
              <p>Variant axes the new category does not define: {categoryReport.variantAxesLost.map((item) => item.name).join(", ")}. Existing variants keep working; regenerate to change them.</p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <FormRow label="Tags" htmlFor="tags" hint="Free-form keywords for search and related products." error={errors.tags}>
        <TagInput id="tags" value={state.tags} onChange={(tags) => set({ tags })} suggestions={bootstrap.tagSuggestions} maxTags={30} disabled={disabled} />
      </FormRow>
    </FormSection>
  );
}
