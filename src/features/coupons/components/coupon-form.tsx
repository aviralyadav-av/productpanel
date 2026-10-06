"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Sparkles, Wand2 } from "lucide-react";

import {
  COUPON_APPLIES_TO,
  COUPON_APPLIES_TO_META,
  COUPON_STATUS_META,
  COUPON_TYPES,
  COUPON_TYPE_META,
} from "@/lib/enums";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { FormActions } from "@/components/shared/form-actions";
import { FieldHint, FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import { MoneyInput } from "@/components/shared/money-input";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { createCouponAction, updateCouponAction } from "../actions";
import { istEndOfDay, istStartOfDay, toDateInputValue } from "../dates";
import { couponFormSchema, generateCouponCode, type CouponEditorData, type CouponFormInput } from "../schemas";
import { couponSummary } from "../summary";

/**
 * Create / edit form for a coupon (blueprint §1 Coupons, §4.7, §14.B2/B3).
 *
 * Validates with the same zod schema the Server Action enforces, so a red
 * outline here is exactly the rule that would reject the save. Money fields
 * hold PAISE (MoneyInput converts), the percentage holds whole points, and
 * dates are IST calendar days (see ../dates.ts). The summary card on the
 * right re-reads the rule in English on every change - the cheapest review
 * step there is.
 */

type FormValues = {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  isPublic: boolean;
  fundedBy: "PLATFORM" | "SELLER";
  type: (typeof COUPON_TYPES)[number];
  percent: string;
  fixedPaise: number | null;
  maxDiscountPaise: number | null;
  minOrderPaise: number | null;
  appliesTo: (typeof COUPON_APPLIES_TO)[number];
  categories: EntityRef[];
  products: EntityRef[];
  sellers: EntityRef[];
  excludedProducts: EntityRef[];
  firstOrderOnly: boolean;
  customers: EntityRef[];
  usageLimit: string;
  perCustomerLimit: string;
  startsAt: string;
  endsAt: string;
};

function initialValues(coupon: CouponEditorData | undefined): FormValues {
  return {
    code: coupon?.code ?? "",
    name: coupon?.name ?? "",
    description: coupon?.description ?? "",
    isActive: coupon?.isActive ?? true,
    isPublic: coupon?.isPublic ?? true,
    fundedBy: coupon?.fundedBy ?? "PLATFORM",
    type: coupon?.type ?? "PERCENT",
    percent: coupon && coupon.type === "PERCENT" ? String(coupon.value) : "10",
    fixedPaise: coupon && coupon.type === "FIXED" ? coupon.value : null,
    maxDiscountPaise: coupon?.maxDiscountPaise ?? null,
    minOrderPaise: coupon?.minOrderPaise ?? null,
    appliesTo: coupon?.appliesTo ?? "ALL",
    categories: coupon?.categories ?? [],
    products: coupon?.products ?? [],
    sellers: coupon?.sellers ?? [],
    excludedProducts: coupon?.excludedProducts ?? [],
    firstOrderOnly: coupon?.firstOrderOnly ?? false,
    customers: coupon?.customers ?? [],
    usageLimit: coupon?.usageLimit ? String(coupon.usageLimit) : "",
    perCustomerLimit: coupon?.perCustomerLimit ? String(coupon.perCustomerLimit) : "",
    startsAt: toDateInputValue(coupon?.startsAt),
    endsAt: toDateInputValue(coupon?.endsAt),
  };
}

function toInput(values: FormValues): CouponFormInput {
  const ids = (refs: EntityRef[]) => refs.map((ref) => ref.id);
  return {
    code: values.code,
    name: values.name,
    description: values.description,
    isActive: values.isActive,
    isPublic: values.isPublic,
    fundedBy: values.fundedBy,
    type: values.type,
    value: values.type === "PERCENT" ? Number(values.percent) : values.type === "FIXED" ? (values.fixedPaise ?? 0) : 0,
    maxDiscountPaise: values.type === "PERCENT" ? values.maxDiscountPaise : null,
    minOrderPaise: values.minOrderPaise,
    appliesTo: values.appliesTo,
    categoryIds: ids(values.categories),
    productIds: ids(values.products),
    sellerIds: ids(values.sellers),
    excludedProductIds: ids(values.excludedProducts),
    firstOrderOnly: values.firstOrderOnly,
    customerIds: ids(values.customers),
    usageLimit: values.usageLimit === "" ? null : Number(values.usageLimit),
    perCustomerLimit: values.perCustomerLimit === "" ? null : Number(values.perCustomerLimit),
    startsAt: values.startsAt,
    endsAt: values.endsAt,
  };
}

const FUNDED_BY_HINT: Record<FormValues["fundedBy"], string> = {
  PLATFORM: "The marketplace absorbs the discount; sellers are paid on the full item price.",
  SELLER: "Deducted from the seller's payout for each discounted item - use for campaigns the makers agreed to.",
};

export function CouponForm({ mode, coupon, canManage }: { mode: "create" | "edit"; coupon?: CouponEditorData; canManage: boolean }) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [values, setValues] = React.useState<FormValues>(() => initialValues(coupon));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);
  const readOnly = !canManage || pending;

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: "" } : current));
    setDirty(true);
  }

  const summary = React.useMemo(() => {
    const scopeCount =
      values.appliesTo === "CATEGORIES"
        ? values.categories.length
        : values.appliesTo === "PRODUCTS"
          ? values.products.length
          : values.appliesTo === "SELLERS"
            ? values.sellers.length
            : 0;
    return couponSummary({
      type: values.type,
      value: values.type === "PERCENT" ? Number(values.percent) || 0 : (values.fixedPaise ?? 0),
      maxDiscountPaise: values.type === "PERCENT" ? values.maxDiscountPaise : null,
      minOrderPaise: values.minOrderPaise,
      appliesTo: values.appliesTo,
      scopeCount,
      excludedCount: values.excludedProducts.length,
      firstOrderOnly: values.firstOrderOnly,
      targetedCustomers: values.customers.length,
      usageLimit: values.usageLimit ? Number(values.usageLimit) : null,
      perCustomerLimit: values.perCustomerLimit ? Number(values.perCustomerLimit) : null,
      startsAt: values.startsAt ? istStartOfDay(values.startsAt) : null,
      endsAt: values.endsAt ? istEndOfDay(values.endsAt) : null,
      fundedBy: values.fundedBy,
      isPublic: values.isPublic,
    });
  }, [values]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly) return;

    const input = toInput(values);
    const parsed = couponFormSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      // The schema names raw fields; map them back onto the inputs that show them.
      if (fieldErrors.value) fieldErrors[values.type === "PERCENT" ? "percent" : "fixedPaise"] = fieldErrors.value;
      if (fieldErrors.categoryIds) fieldErrors.categories = fieldErrors.categoryIds;
      if (fieldErrors.productIds) fieldErrors.products = fieldErrors.productIds;
      if (fieldErrors.sellerIds) fieldErrors.sellers = fieldErrors.sellerIds;
      setErrors(fieldErrors);
      return;
    }

    const result = await run(
      () => (mode === "create" || !coupon ? createCouponAction(input) : updateCouponAction(coupon.id, input)),
      {
        onSuccess: (data) => {
          setDirty(false);
          if (mode === "create") router.push(`/admin/coupons/${data.id}` as Route);
          else router.refresh();
        },
      },
    );
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]" noValidate>
      <div className="space-y-4">
        <FormSection title="Basics" description="The code customers type, what you call it internally, and who pays for it.">
          <FormRowGroup columns={2}>
            <FormRow label="Code" htmlFor="coupon-code" required error={errors.code} hint="Letters, numbers, hyphens and underscores. Stored in uppercase.">
              <div className="flex gap-2">
                <Input
                  id="coupon-code"
                  value={values.code}
                  onChange={(event) => set("code", event.target.value.toUpperCase())}
                  disabled={readOnly}
                  aria-invalid={Boolean(errors.code) || undefined}
                  className="font-mono uppercase"
                  maxLength={32}
                  autoFocus={mode === "create"}
                />
                <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" disabled={readOnly} onClick={() => set("code", generateCouponCode())}>
                  <Wand2 /> Generate
                </Button>
              </div>
            </FormRow>
            <FormRow label="Name" htmlFor="coupon-name" required error={errors.name} hint="Shown in reports and order details.">
              <Input id="coupon-name" value={values.name} onChange={(event) => set("name", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.name) || undefined} maxLength={120} />
            </FormRow>
          </FormRowGroup>
          <FormRow label="Description" htmlFor="coupon-description" error={errors.description} hint="Optional. Public coupons may show this on the storefront.">
            <Textarea id="coupon-description" value={values.description} onChange={(event) => set("description", event.target.value)} disabled={readOnly} rows={2} maxLength={500} />
          </FormRow>
          <FormRowGroup columns={3}>
            <FormRow inline label="Active" htmlFor="coupon-active" hint="Off pauses the coupon without deleting it.">
              <Switch id="coupon-active" checked={values.isActive} onCheckedChange={(value) => set("isActive", value)} disabled={readOnly} />
            </FormRow>
            <FormRow inline label="Public" htmlFor="coupon-public" hint="Public coupons can be listed on the storefront; private ones only work when typed.">
              <Switch id="coupon-public" checked={values.isPublic} onCheckedChange={(value) => set("isPublic", value)} disabled={readOnly} />
            </FormRow>
            <FormRow label="Funded by" htmlFor="coupon-funded" hint={FUNDED_BY_HINT[values.fundedBy]}>
              <Select value={values.fundedBy} onValueChange={(value) => set("fundedBy", value as FormValues["fundedBy"])} disabled={readOnly}>
                <SelectTrigger id="coupon-funded" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PLATFORM">Platform</SelectItem>
                  <SelectItem value="SELLER">Sellers</SelectItem>
                </SelectContent>
              </Select>
            </FormRow>
          </FormRowGroup>
        </FormSection>

        <FormSection title="Discount" description="How much comes off, and any floor or ceiling.">
          <FormRowGroup columns={2}>
            <FormRow label="Type" htmlFor="coupon-type" required>
              <Select value={values.type} onValueChange={(value) => set("type", value as FormValues["type"])} disabled={readOnly}>
                <SelectTrigger id="coupon-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUPON_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {COUPON_TYPE_META[type].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
            {values.type === "PERCENT" ? (
              <FormRow label="Percentage" htmlFor="coupon-percent" required error={errors.percent} hint="Whole percent points, 1-100.">
                <div className="relative">
                  <Input id="coupon-percent" type="number" inputMode="numeric" min={1} max={100} step={1} value={values.percent} onChange={(event) => set("percent", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.percent) || undefined} className="pr-8" />
                  <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs">%</span>
                </div>
              </FormRow>
            ) : values.type === "FIXED" ? (
              <FormRow label="Amount off" htmlFor="coupon-fixed" required error={errors.fixedPaise}>
                <MoneyInput id="coupon-fixed" valuePaise={values.fixedPaise} onChangePaise={(paise) => set("fixedPaise", paise)} disabled={readOnly} invalid={Boolean(errors.fixedPaise)} allowEmpty />
              </FormRow>
            ) : (
              <FormRow label="Shipping" hint="Zeroes whatever shipping charge remains after free-shipping thresholds. Never waives the COD fee.">
                <p className="text-muted-foreground text-sm">Free standard shipping</p>
              </FormRow>
            )}
          </FormRowGroup>
          <FormRowGroup columns={2}>
            {values.type === "PERCENT" ? (
              <FormRow label="Maximum discount" htmlFor="coupon-max" error={errors.maxDiscountPaise} hint="Optional cap on the rupee value of the percentage.">
                <MoneyInput id="coupon-max" valuePaise={values.maxDiscountPaise} onChangePaise={(paise) => set("maxDiscountPaise", paise)} disabled={readOnly} invalid={Boolean(errors.maxDiscountPaise)} allowEmpty placeholder="No cap" />
              </FormRow>
            ) : null}
            <FormRow label="Minimum order" htmlFor="coupon-min" error={errors.minOrderPaise} hint="Checked against the item subtotal after promotions, before shipping.">
              <MoneyInput id="coupon-min" valuePaise={values.minOrderPaise} onChangePaise={(paise) => set("minOrderPaise", paise)} disabled={readOnly} invalid={Boolean(errors.minOrderPaise)} allowEmpty placeholder="No minimum" />
            </FormRow>
          </FormRowGroup>
        </FormSection>

        <FormSection title="Scope" description="Which items the discount is computed on. Category scope includes sub-categories.">
          <FormRow label="Applies to" htmlFor="coupon-applies" required>
            <Select value={values.appliesTo} onValueChange={(value) => set("appliesTo", value as FormValues["appliesTo"])} disabled={readOnly}>
              <SelectTrigger id="coupon-applies" className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUPON_APPLIES_TO.map((scope) => (
                  <SelectItem key={scope} value={scope}>
                    {COUPON_APPLIES_TO_META[scope].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          {values.appliesTo === "CATEGORIES" ? (
            <FormRow label="Categories" htmlFor="coupon-categories" required error={errors.categories}>
              <EntityPicker id="coupon-categories" kind="category" multiple value={values.categories} onChange={(refs) => set("categories", refs)} disabled={readOnly} invalid={Boolean(errors.categories)} placeholder="Add categories" />
            </FormRow>
          ) : null}
          {values.appliesTo === "PRODUCTS" ? (
            <FormRow label="Products" htmlFor="coupon-products" required error={errors.products}>
              <EntityPicker id="coupon-products" kind="product" multiple value={values.products} onChange={(refs) => set("products", refs)} disabled={readOnly} invalid={Boolean(errors.products)} placeholder="Add products" />
            </FormRow>
          ) : null}
          {values.appliesTo === "SELLERS" ? (
            <FormRow label="Sellers" htmlFor="coupon-sellers" required error={errors.sellers} hint="Seller-scoped coupons are usually seller-funded (B3).">
              <EntityPicker id="coupon-sellers" kind="seller" multiple value={values.sellers} onChange={(refs) => set("sellers", refs)} disabled={readOnly} invalid={Boolean(errors.sellers)} placeholder="Add sellers" />
            </FormRow>
          ) : null}
          <FormRow label="Excluded products" htmlFor="coupon-excluded" error={errors.excludedProductIds} hint="Never discounted, whatever the scope says.">
            <EntityPicker id="coupon-excluded" kind="product" multiple value={values.excludedProducts} onChange={(refs) => set("excludedProducts", refs)} disabled={readOnly} placeholder="Exclude products" />
          </FormRow>
        </FormSection>

        <FormSection title="Eligibility" description="Who may redeem the coupon.">
          <FormRow inline label="First order only" htmlFor="coupon-first" hint="Rejected for any customer or guest email with a previous non-cancelled order.">
            <Switch id="coupon-first" checked={values.firstOrderOnly} onCheckedChange={(value) => set("firstOrderOnly", value)} disabled={readOnly} />
          </FormRow>
          <FormRow label="Specific customers" htmlFor="coupon-customers" error={errors.customerIds} hint="Leave empty for everyone. Targeted coupons require the customer to be signed in.">
            <EntityPicker id="coupon-customers" kind="customer" multiple value={values.customers} onChange={(refs) => set("customers", refs)} disabled={readOnly} placeholder="Add customers" />
          </FormRow>
        </FormSection>

        <FormSection title="Limits" description="Redemption caps. The total limit is enforced atomically at checkout.">
          <FormRowGroup columns={2}>
            <FormRow label="Total uses" htmlFor="coupon-limit" error={errors.usageLimit} hint={coupon ? `${coupon.usageCount} used so far.` : "Leave empty for unlimited."}>
              <Input id="coupon-limit" type="number" inputMode="numeric" min={1} step={1} value={values.usageLimit} onChange={(event) => set("usageLimit", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.usageLimit) || undefined} placeholder="Unlimited" />
            </FormRow>
            <FormRow label="Per customer" htmlFor="coupon-per-customer" error={errors.perCustomerLimit} hint="Counted per signed-in customer.">
              <Input id="coupon-per-customer" type="number" inputMode="numeric" min={1} step={1} value={values.perCustomerLimit} onChange={(event) => set("perCustomerLimit", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.perCustomerLimit) || undefined} placeholder="Unlimited" />
            </FormRow>
          </FormRowGroup>
        </FormSection>

        <FormSection title="Schedule" description="Whole IST days: the start is 00:00 and the end 23:59:59 in India.">
          <FormRowGroup columns={2}>
            <FormRow label="Starts" htmlFor="coupon-starts" error={errors.startsAt}>
              <Input id="coupon-starts" type="date" value={values.startsAt} onChange={(event) => set("startsAt", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.startsAt) || undefined} />
            </FormRow>
            <FormRow label="Ends" htmlFor="coupon-ends" error={errors.endsAt}>
              <Input id="coupon-ends" type="date" value={values.endsAt} onChange={(event) => set("endsAt", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.endsAt) || undefined} min={values.startsAt || undefined} />
            </FormRow>
          </FormRowGroup>
          <FieldHint>Leave both empty for a coupon that never expires.</FieldHint>
        </FormSection>

        {canManage ? (
          <FormActions
            dirty={dirty}
            pending={pending}
            submitLabel={mode === "create" ? "Create coupon" : "Save changes"}
            onCancel={() => router.push("/admin/coupons" as Route)}
            warnOnLeave
          />
        ) : null}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <div className="surface space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="text-brand size-4" />
            <h3 className="text-sm font-semibold">In plain English</h3>
          </div>
          <p className="text-sm leading-relaxed">
            <span className="font-mono font-semibold">{values.code || "CODE"}</span>: {summary}
          </p>
          {coupon ? (
            <dl className="grid grid-cols-2 gap-2 border-t pt-3 text-xs">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <StatusPill label={COUPON_STATUS_META[coupon.status].label} tone={COUPON_STATUS_META[coupon.status].tone} />
              </dd>
              <dt className="text-muted-foreground">Redemptions</dt>
              <dd className="tabular-nums">{coupon.redemptions}</dd>
              <dt className="text-muted-foreground">Discount given</dt>
              <dd className="tabular-nums">{formatPaise(coupon.discountGivenPaise)}</dd>
              {coupon.createdByEmail ? (
                <>
                  <dt className="text-muted-foreground">Created by</dt>
                  <dd className="truncate">{coupon.createdByEmail}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
        </div>
        {coupon ? (
          <p className="text-muted-foreground text-xs">
            Redemptions and audit history are on the{" "}
            <Link href={`/admin/coupons/${coupon.id}?tab=usage` as Route} className="underline">
              Usage
            </Link>{" "}
            and{" "}
            <Link href={`/admin/coupons/${coupon.id}?tab=activity` as Route} className="underline">
              Activity
            </Link>{" "}
            tabs.
          </p>
        ) : null}
      </aside>
    </form>
  );
}
