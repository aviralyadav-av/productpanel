"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";

import { PROMOTION_TYPE_META, COUPON_APPLIES_TO_META } from "@/lib/enums";
import { formatPaise } from "@/lib/money";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import { useMediaPicker, type PickedAsset } from "@/components/shared/media-picker";
import { MoneyInput } from "@/components/shared/money-input";
import { SlugInput } from "@/components/shared/slug-input";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { MediaField } from "@/features/banners/components/media-field";
import { istEndOfDay, istStartOfDay, toDateInputValue } from "@/features/coupons/dates";
import { formatIstWindow } from "@/features/coupons/dates";

import { createPromotionAction, updatePromotionAction } from "../actions";
import {
  PROMOTION_APPLIES_TO,
  PROMOTION_STATUS_META,
  PROMOTION_TYPES,
  derivePromotionStatus,
  describePromotionDiscount,
  promotionFormSchema,
  type PromotionEditorData,
  type PromotionFormInput,
} from "../schemas";

/**
 * Create / edit form for a promotion (blueprint §4.7, §14.A4, B3). Saving
 * re-prices every affected product in the same transaction, so the form says
 * so next to the submit button; the sidebar shows the rule in plain English
 * and, on edit, how many products currently carry it.
 */

type FormValues = {
  name: string;
  slug: string;
  description: string;
  type: (typeof PROMOTION_TYPES)[number];
  discountType: "PERCENT" | "FIXED";
  percent: string;
  fixedPaise: number | null;
  appliesTo: (typeof PROMOTION_APPLIES_TO)[number];
  categories: EntityRef[];
  products: EntityRef[];
  sellers: EntityRef[];
  badgeText: string;
  banner: PickedAsset | null;
  priority: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  fundedBy: "PLATFORM" | "SELLER";
};

function initialValues(promotion: PromotionEditorData | undefined): FormValues {
  return {
    name: promotion?.name ?? "",
    slug: promotion?.slug ?? "",
    description: promotion?.description ?? "",
    type: promotion?.type ?? "SALE",
    discountType: promotion?.discountType ?? "PERCENT",
    percent: promotion && promotion.discountType === "PERCENT" ? String(promotion.value) : "10",
    fixedPaise: promotion && promotion.discountType === "FIXED" ? promotion.value : null,
    appliesTo: promotion?.appliesTo ?? "ALL",
    categories: promotion?.categories ?? [],
    products: promotion?.products ?? [],
    sellers: promotion?.sellers ?? [],
    badgeText: promotion?.badgeText ?? "",
    banner: promotion?.bannerMedia ?? null,
    priority: String(promotion?.priority ?? 0),
    startsAt: toDateInputValue(promotion?.startsAt),
    endsAt: toDateInputValue(promotion?.endsAt),
    isActive: promotion?.isActive ?? true,
    fundedBy: promotion?.fundedBy ?? "PLATFORM",
  };
}

function toInput(values: FormValues): PromotionFormInput {
  const ids = (refs: EntityRef[]) => refs.map((ref) => ref.id);
  return {
    name: values.name,
    slug: values.slug || undefined,
    description: values.description,
    type: values.type,
    discountType: values.discountType,
    value: values.discountType === "PERCENT" ? Number(values.percent) : (values.fixedPaise ?? 0),
    appliesTo: values.appliesTo,
    categoryIds: ids(values.categories),
    productIds: ids(values.products),
    sellerIds: ids(values.sellers),
    badgeText: values.badgeText,
    bannerMediaId: values.banner?.id ?? null,
    priority: Number(values.priority) || 0,
    startsAt: values.startsAt,
    endsAt: values.endsAt,
    isActive: values.isActive,
    fundedBy: values.fundedBy,
  };
}

const FUNDED_BY_HINT: Record<FormValues["fundedBy"], string> = {
  PLATFORM: "The marketplace absorbs the discount; sellers are paid on the full price.",
  SELLER: "Deducted from each seller's payout for their discounted items - only for campaigns the makers agreed to.",
};

export function PromotionForm({ mode, promotion, canManage }: { mode: "create" | "edit"; promotion?: PromotionEditorData; canManage: boolean }) {
  const router = useRouter();
  const picker = useMediaPicker();
  const { pending, run } = useActionToast();
  const [values, setValues] = React.useState<FormValues>(() => initialValues(promotion));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);
  const readOnly = !canManage || pending;

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: "" } : current));
    setDirty(true);
  }

  async function pickBanner(): Promise<PickedAsset | null> {
    const picked = await picker.open({ accept: "image", multiple: false, title: "Choose a promotion banner" });
    return picked?.[0] ?? null;
  }

  const discountLabel = describePromotionDiscount(
    { discountType: values.discountType, value: values.discountType === "PERCENT" ? Number(values.percent) || 0 : (values.fixedPaise ?? 0) },
    formatPaise,
  );
  const scopeLabel =
    values.appliesTo === "CATEGORIES"
      ? `${values.categories.length} categor${values.categories.length === 1 ? "y" : "ies"} (including sub-categories)`
      : values.appliesTo === "PRODUCTS"
        ? `${values.products.length} product${values.products.length === 1 ? "" : "s"}`
        : values.appliesTo === "SELLERS"
          ? `${values.sellers.length} seller${values.sellers.length === 1 ? "" : "s"}`
          : "the whole catalogue";
  const previewStatus =
    values.startsAt && values.endsAt
      ? derivePromotionStatus({ isActive: values.isActive, startsAt: istStartOfDay(values.startsAt), endsAt: istEndOfDay(values.endsAt) })
      : null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly) return;

    const input = toInput(values);
    const parsed = promotionFormSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      if (fieldErrors.value) fieldErrors[values.discountType === "PERCENT" ? "percent" : "fixedPaise"] = fieldErrors.value;
      if (fieldErrors.categoryIds) fieldErrors.categories = fieldErrors.categoryIds;
      if (fieldErrors.productIds) fieldErrors.products = fieldErrors.productIds;
      if (fieldErrors.sellerIds) fieldErrors.sellers = fieldErrors.sellerIds;
      setErrors(fieldErrors);
      return;
    }

    const result = await run(
      () => (mode === "create" || !promotion ? createPromotionAction(input) : updatePromotionAction(promotion.id, input)),
      {
        onSuccess: (data) => {
          setDirty(false);
          if (mode === "create") router.push(`/admin/promotions/${data.id}` as Route);
          else router.refresh();
        },
      },
    );
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]" noValidate>
      <div className="space-y-4">
        <FormSection title="Campaign" description="Name, URL slug and the kind of sale.">
          <FormRowGroup columns={2}>
            <FormRow label="Name" htmlFor="promo-name" required error={errors.name}>
              <Input id="promo-name" value={values.name} onChange={(event) => set("name", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.name) || undefined} maxLength={120} autoFocus={mode === "create"} />
            </FormRow>
            <FormRow label="Slug" htmlFor="promo-slug" error={errors.slug} hint="Used by the storefront for a campaign landing page.">
              <SlugInput id="promo-slug" sourceValue={values.name} value={values.slug} onChange={(slug) => set("slug", slug)} locked={mode === "edit"} disabled={readOnly} invalid={Boolean(errors.slug)} />
            </FormRow>
          </FormRowGroup>
          <FormRow label="Description" htmlFor="promo-description" error={errors.description}>
            <Textarea id="promo-description" value={values.description} onChange={(event) => set("description", event.target.value)} disabled={readOnly} rows={2} maxLength={500} />
          </FormRow>
          <FormRowGroup columns={3}>
            <FormRow label="Type" htmlFor="promo-type" required>
              <Select value={values.type} onValueChange={(value) => set("type", value as FormValues["type"])} disabled={readOnly}>
                <SelectTrigger id="promo-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROMOTION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {PROMOTION_TYPE_META[type].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
            <FormRow label="Badge text" htmlFor="promo-badge" error={errors.badgeText} hint="Short label shown on product cards, e.g. “Festive 10% off”.">
              <Input id="promo-badge" value={values.badgeText} onChange={(event) => set("badgeText", event.target.value)} disabled={readOnly} maxLength={40} />
            </FormRow>
            <FormRow label="Priority" htmlFor="promo-priority" error={errors.priority} hint="When two promotions give the same price, the higher priority wins the badge.">
              <Input id="promo-priority" type="number" inputMode="numeric" step={1} value={values.priority} onChange={(event) => set("priority", event.target.value)} disabled={readOnly} />
            </FormRow>
          </FormRowGroup>
          <FormRow label="Banner image" hint="Optional creative for campaign pages and the promotions strip.">
            <MediaField value={values.banner} onChange={(asset) => set("banner", asset)} onPick={pickBanner} disabled={readOnly} />
          </FormRow>
        </FormSection>

        <FormSection title="Discount" description="Applied per unit to the list price. The customer always gets the lower of sale price and promotion - never both (§11.6).">
          <FormRowGroup columns={2}>
            <FormRow label="Discount type" htmlFor="promo-discount-type" required>
              <Select value={values.discountType} onValueChange={(value) => set("discountType", value as FormValues["discountType"])} disabled={readOnly}>
                <SelectTrigger id="promo-discount-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENT">Percentage</SelectItem>
                  <SelectItem value="FIXED">Fixed amount per unit</SelectItem>
                </SelectContent>
              </Select>
            </FormRow>
            {values.discountType === "PERCENT" ? (
              <FormRow label="Percentage" htmlFor="promo-percent" required error={errors.percent}>
                <div className="relative">
                  <Input id="promo-percent" type="number" inputMode="numeric" min={1} max={100} step={1} value={values.percent} onChange={(event) => set("percent", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.percent) || undefined} className="pr-8" />
                  <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs">%</span>
                </div>
              </FormRow>
            ) : (
              <FormRow label="Amount off per unit" htmlFor="promo-fixed" required error={errors.fixedPaise}>
                <MoneyInput id="promo-fixed" valuePaise={values.fixedPaise} onChangePaise={(paise) => set("fixedPaise", paise)} disabled={readOnly} invalid={Boolean(errors.fixedPaise)} allowEmpty />
              </FormRow>
            )}
          </FormRowGroup>
          <FormRow label="Funded by" htmlFor="promo-funded" hint={FUNDED_BY_HINT[values.fundedBy]}>
            <Select value={values.fundedBy} onValueChange={(value) => set("fundedBy", value as FormValues["fundedBy"])} disabled={readOnly}>
              <SelectTrigger id="promo-funded" className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PLATFORM">Platform</SelectItem>
                <SelectItem value="SELLER">Sellers</SelectItem>
              </SelectContent>
            </Select>
          </FormRow>
        </FormSection>

        <FormSection title="Scope" description="Which products are re-priced. Category scope includes sub-categories.">
          <FormRow label="Applies to" htmlFor="promo-applies" required>
            <Select value={values.appliesTo} onValueChange={(value) => set("appliesTo", value as FormValues["appliesTo"])} disabled={readOnly}>
              <SelectTrigger id="promo-applies" className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROMOTION_APPLIES_TO.map((scope) => (
                  <SelectItem key={scope} value={scope}>
                    {scope === "ALL" ? "Whole catalogue" : COUPON_APPLIES_TO_META[scope].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          {values.appliesTo === "CATEGORIES" ? (
            <FormRow label="Categories" htmlFor="promo-categories" required error={errors.categories}>
              <EntityPicker id="promo-categories" kind="category" multiple value={values.categories} onChange={(refs) => set("categories", refs)} disabled={readOnly} invalid={Boolean(errors.categories)} placeholder="Add categories" />
            </FormRow>
          ) : null}
          {values.appliesTo === "PRODUCTS" ? (
            <FormRow label="Products" htmlFor="promo-products" required error={errors.products}>
              <EntityPicker id="promo-products" kind="product" multiple value={values.products} onChange={(refs) => set("products", refs)} disabled={readOnly} invalid={Boolean(errors.products)} placeholder="Add products" />
            </FormRow>
          ) : null}
          {values.appliesTo === "SELLERS" ? (
            <FormRow label="Sellers" htmlFor="promo-sellers" required error={errors.sellers}>
              <EntityPicker id="promo-sellers" kind="seller" multiple value={values.sellers} onChange={(refs) => set("sellers", refs)} disabled={readOnly} invalid={Boolean(errors.sellers)} placeholder="Add sellers" />
            </FormRow>
          ) : null}
        </FormSection>

        <FormSection title="Schedule" description="Whole IST days. Prices switch over automatically at both boundaries.">
          <FormRowGroup columns={3}>
            <FormRow label="Starts" htmlFor="promo-starts" required error={errors.startsAt}>
              <Input id="promo-starts" type="date" value={values.startsAt} onChange={(event) => set("startsAt", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.startsAt) || undefined} />
            </FormRow>
            <FormRow label="Ends" htmlFor="promo-ends" required error={errors.endsAt}>
              <Input id="promo-ends" type="date" value={values.endsAt} onChange={(event) => set("endsAt", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.endsAt) || undefined} min={values.startsAt || undefined} />
            </FormRow>
            <FormRow inline label="Active" htmlFor="promo-active" hint="Off removes the promotion price immediately, keeping the schedule.">
              <Switch id="promo-active" checked={values.isActive} onCheckedChange={(value) => set("isActive", value)} disabled={readOnly} />
            </FormRow>
          </FormRowGroup>
        </FormSection>

        {canManage ? (
          <FormActions
            dirty={dirty}
            pending={pending}
            submitLabel={mode === "create" ? "Create promotion" : "Save and re-price"}
            onCancel={() => router.push("/admin/promotions" as Route)}
            status={<span className="text-muted-foreground text-xs">Saving re-prices every affected product.</span>}
            warnOnLeave
          />
        ) : null}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <div className="surface space-y-3 p-4">
          <h3 className="text-sm font-semibold">In plain English</h3>
          <p className="text-sm leading-relaxed">
            <span className="font-semibold">{values.name || "This promotion"}</span> gives {discountLabel} on {scopeLabel}
            {values.startsAt || values.endsAt ? `, ${formatIstWindow(values.startsAt ? istStartOfDay(values.startsAt) : null, values.endsAt ? istEndOfDay(values.endsAt) : null)}` : ""}.{" "}
            {values.fundedBy === "SELLER" ? "Funded by the sellers." : "Funded by the platform."}
          </p>
          <dl className="grid grid-cols-2 gap-2 border-t pt-3 text-xs">
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              {previewStatus ? <StatusPill label={PROMOTION_STATUS_META[previewStatus].label} tone={PROMOTION_STATUS_META[previewStatus].tone} /> : <span className="text-muted-foreground">Set the dates</span>}
            </dd>
            {promotion ? (
              <>
                <dt className="text-muted-foreground">Products carrying it</dt>
                <dd className="tabular-nums">{promotion.affectedProducts}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </aside>

      {picker.element}
    </form>
  );
}
