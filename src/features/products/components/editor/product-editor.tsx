"use client";

import * as React from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

import type { EffectiveAttribute } from "@/features/catalog/attribute-resolution";
import type { CategoryChangeReport } from "@/features/catalog/publish-validation";
import { FormActions } from "@/components/shared/form-actions";
import { useMediaPicker } from "@/components/shared/media-picker";
import { PageHeader } from "@/components/shared/page-header";
import { SectionNav } from "@/components/shared/section-nav";
import { ProductStatusBadge } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { effectiveAttributesAction, saveProductAction } from "@/features/products/actions";
import type { EditorBootstrap, EditorProduct } from "@/features/products/queries";
import { productFormSchema } from "@/features/products/schemas";

import { AttributesSection } from "./attributes-section";
import { BasicsSection } from "./basics-section";
import { CustomizationSection } from "./customization-section";
import { emptyFormState, fromEditorProduct, sameState, toFormInput, type FieldErrors, type ProductFormState } from "./form-state";
import { HeaderActions } from "./header-actions";
import { ImagesSection } from "./images-section";
import { CustomFieldsSection, FlagsSection, SeoSection, ShippingSection } from "./misc-sections";
import { PricingSection } from "./pricing-section";
import { ActivitySection, RightRail } from "./right-rail";
import { VariantsSection } from "./variants-section";

/**
 * The product editor (blueprint §1 Products, §14.A5-A8). The main form saves
 * as ONE server action; variants, gallery and customisation options save
 * independently through their own actions and `router.refresh()` reloads the
 * Server Component payload underneath. Dirty tracking compares the form state
 * with the last saved snapshot, so a refresh never fakes a "dirty" state.
 */

const SECTIONS = [
  { id: "basics", label: "Basics" },
  { id: "pricing", label: "Pricing" },
  { id: "attributes", label: "Attributes" },
  { id: "variants", label: "Variants" },
  { id: "images", label: "Images & video" },
  { id: "customization", label: "Customisation" },
  { id: "shipping", label: "Shipping" },
  { id: "flags", label: "Flags & ordering" },
  { id: "seo", label: "SEO" },
  { id: "custom-fields", label: "Custom fields" },
  { id: "activity", label: "Activity" },
];

export function ProductEditor({
  product,
  bootstrap,
  permissions,
}: {
  product: EditorProduct | null;
  bootstrap: EditorBootstrap;
  permissions: string[];
}) {
  const router = useRouter();
  const picker = useMediaPicker();
  const { pending, run } = useActionToast();

  const initial = React.useMemo(() => (product ? fromEditorProduct(product) : emptyFormState()), [product]);
  const [state, setState] = React.useState<ProductFormState>(initial);
  const [saved, setSaved] = React.useState<ProductFormState>(initial);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [effective, setEffective] = React.useState<EffectiveAttribute[]>(product?.effectiveAttributes ?? []);
  const [categoryReport, setCategoryReport] = React.useState<CategoryChangeReport | null>(null);

  // A fresh server payload (after any section saved) resets the snapshot but
  // keeps unsaved edits the operator has typed into the main form. This is
  // React's "previous prop in state" pattern - no effect, no extra paint.
  const [seenInitial, setSeenInitial] = React.useState(initial);
  if (seenInitial !== initial) {
    setSeenInitial(initial);
    setSaved(initial);
    setState((current) => (sameState(current, saved) ? initial : current));
  }

  const set = React.useCallback((patch: Partial<ProductFormState>) => setState((current) => ({ ...current, ...patch })), []);
  const dirty = !sameState(state, saved);
  const can = (code: string) => permissions.includes("*") || permissions.includes(code);
  const canEdit = product ? can("products.edit") : can("products.create");

  // The effective attribute set follows the category chosen in the form, not
  // the saved one, so the Attributes and Variants sections update live.
  const categoryId = state.categoryId;
  React.useEffect(() => {
    let cancelled = false;
    void effectiveAttributesAction(categoryId).then((result) => {
      if (!cancelled && result.ok) setEffective(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!canEdit) return;
    // Orphaned attributes (A6) are still writable, so their input types join the effective set for the conversion.
    const shapes = [
      ...effective.map((entry) => ({ id: entry.attribute.id, inputType: entry.attribute.inputType })),
      ...(product?.orphanAttributes ?? []).map((orphan) => ({ id: orphan.attributeId, inputType: orphan.inputType })),
    ];
    const input = toFormInput(state, shapes);
    const parsed = productFormSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      document.getElementById(Object.keys(fieldErrors)[0]?.split(".")[0] ?? "")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setErrors({});
    await run(() => saveProductAction(product?.id ?? null, input), {
      onSuccess: (data) => {
        setSaved(state);
        setCategoryReport(data.categoryChange);
        if (!product) router.push(`/admin/products/${data.id}` as Route);
        else router.refresh();
      },
      onError: (result) => {
        if (result.fieldErrors) setErrors(result.fieldErrors);
      },
    });
  };

  const requestSubmit = () => document.querySelector<HTMLFormElement>("#product-form")?.requestSubmit();

  return (
    <div className="space-y-4">
      <PageHeader
        title={product ? product.title : "New product"}
        description={
          product ? (
            <span className="flex flex-wrap items-center gap-2">
              <ProductStatusBadge status={product.status} />
              <span className="font-mono text-[11px]">/{product.slug}</span>
              {product.category ? <span>{product.category.namePath}</span> : <span className="text-warning">No category</span>}
              <span>{product.seller ? product.seller.displayName : "Sold by the platform"}</span>
            </span>
          ) : (
            "Saved as a draft. Variants, images and customisation options are added once the draft exists."
          )
        }
        actions={<HeaderActions product={product} dirty={dirty} pending={pending} canEdit={canEdit} permissions={permissions} onSave={requestSubmit} previewEnabled={bootstrap.previewEnabled} />}
      />

      <SectionNav items={product ? SECTIONS : SECTIONS.filter((section) => !["variants", "images", "customization", "activity"].includes(section.id))} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <form id="product-form" onSubmit={submit} className="min-w-0 space-y-4" noValidate>
          <BasicsSection
            state={state}
            set={set}
            errors={errors}
            product={product}
            bootstrap={bootstrap}
            disabled={!canEdit}
            picker={picker}
            categoryReport={categoryReport}
            onCategoryReport={setCategoryReport}
          />
          <PricingSection state={state} set={set} errors={errors} defaultTaxBps={bootstrap.defaultTaxBps} disabled={!canEdit} />
          <AttributesSection state={state} set={set} errors={errors} effective={effective} product={product} disabled={!canEdit} />

          {product ? <VariantsSection product={product} effective={effective} disabled={!can("products.edit")} picker={picker} /> : null}
          {product ? <ImagesSection product={product} state={state} set={set} errors={errors} disabled={!can("products.edit")} picker={picker} /> : null}
          {product ? <CustomizationSection product={product} disabled={!can("products.edit")} picker={picker} /> : null}

          <ShippingSection state={state} set={set} errors={errors} disabled={!canEdit} />
          <FlagsSection state={state} set={set} errors={errors} disabled={!canEdit} />
          <SeoSection state={state} set={set} errors={errors} disabled={!canEdit} picker={picker} storefrontBaseUrl={bootstrap.storefrontBaseUrl} />
          <CustomFieldsSection state={state} set={set} disabled={!canEdit} />
          {product ? <ActivitySection product={product} /> : null}

          <FormActions
            dirty={dirty}
            pending={pending}
            submitLabel={product ? "Save product" : "Create draft"}
            onCancel={() => router.push("/admin/products" as Route)}
            cancelLabel="Back to list"
            disabled={!canEdit}
            status={!canEdit ? "You can view this product but not edit it." : undefined}
          />
        </form>

        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">{product ? <RightRail product={product} /> : <NewProductRail />}</aside>
      </div>

      {picker.element}
    </div>
  );
}

function NewProductRail() {
  return (
    <div className="surface space-y-2 p-4 text-xs leading-relaxed">
      <p className="text-sm font-semibold">Before you publish</p>
      <ul className="text-muted-foreground list-disc space-y-1 pl-4">
        <li>A category, a price above zero and at least one image.</li>
        <li>Every attribute the category marks as required.</li>
        <li>One active variant with an inventory row - a &quot;Default&quot; variant is created with the draft.</li>
        <li>An active seller, or none for platform-sold products.</li>
      </ul>
    </div>
  );
}
