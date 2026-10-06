"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";

import { BANNER_PLACEMENTS, BANNER_PLACEMENT_META, LINK_TYPES, LINK_TYPE_META, type BannerPlacement, type LinkType } from "@/lib/enums";
import { formatNumber } from "@/lib/money";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import { useMediaPicker, type PickedAsset } from "@/components/shared/media-picker";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { istEndOfDay, istStartOfDay, toDateInputValue } from "@/features/coupons/dates";

import { createBannerAction, updateBannerAction } from "../actions";
import { placementInfo } from "../placements";
import { BANNER_STATUS_META, bannerFormSchema, deriveBannerStatus, type BannerEditorData, type BannerFormInput } from "../schemas";
import { BannerPreview } from "./banner-preview";
import { MediaField } from "./media-field";

/**
 * Create / edit form for a banner (blueprint §4.7, §11.25/26, E1) with a live
 * desktop + mobile preview. Media is referenced by ID; the link target is one
 * of URL / category / product / page / blog post, each with its own picker.
 */

type FormValues = {
  title: string;
  subtitle: string;
  placement: BannerPlacement;
  media: PickedAsset | null;
  mobileMedia: PickedAsset | null;
  altText: string;
  linkType: LinkType;
  linkUrl: string;
  category: EntityRef | null;
  product: EntityRef | null;
  page: EntityRef | null;
  blogPost: EntityRef | null;
  buttonText: string;
  textColor: string;
  bgColor: string;
  position: string;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
};

function initialValues(banner: BannerEditorData | undefined, defaultPlacement: BannerPlacement): FormValues {
  return {
    title: banner?.title ?? "",
    subtitle: banner?.subtitle ?? "",
    placement: banner?.placement ?? defaultPlacement,
    media: banner?.media ?? null,
    mobileMedia: banner?.mobileMedia ?? null,
    altText: banner?.altText ?? "",
    linkType: banner?.linkType ?? "NONE",
    linkUrl: banner?.linkType === "URL" ? (banner.linkUrl ?? "") : "",
    category: banner?.category ?? null,
    product: banner?.product ?? null,
    page: banner?.page ?? null,
    blogPost: banner?.blogPost ?? null,
    buttonText: banner?.buttonText ?? "",
    textColor: banner?.textColor ?? "",
    bgColor: banner?.bgColor ?? "",
    position: banner ? String(banner.position) : "",
    isActive: banner?.isActive ?? true,
    startsAt: toDateInputValue(banner?.startsAt),
    endsAt: toDateInputValue(banner?.endsAt),
  };
}

function toInput(values: FormValues): BannerFormInput {
  return {
    title: values.title,
    subtitle: values.subtitle,
    placement: values.placement,
    mediaId: values.media?.id ?? null,
    mobileMediaId: values.mobileMedia?.id ?? null,
    altText: values.altText,
    linkType: values.linkType,
    linkUrl: values.linkUrl,
    categoryId: values.category?.id ?? null,
    productId: values.product?.id ?? null,
    pageId: values.page?.id ?? null,
    blogPostId: values.blogPost?.id ?? null,
    buttonText: values.buttonText,
    textColor: values.textColor,
    bgColor: values.bgColor,
    position: values.position === "" ? null : Number(values.position),
    isActive: values.isActive,
    startsAt: values.startsAt,
    endsAt: values.endsAt,
  };
}

const ERROR_ALIASES: Record<string, string> = { mediaId: "media", mobileMediaId: "mobileMedia", categoryId: "category", productId: "product", pageId: "page", blogPostId: "blogPost" };

export function BannerForm({
  mode,
  banner,
  canManage,
  defaultPlacement = "HOME_HERO",
}: {
  mode: "create" | "edit";
  banner?: BannerEditorData;
  canManage: boolean;
  defaultPlacement?: BannerPlacement;
}) {
  const router = useRouter();
  const picker = useMediaPicker();
  const { pending, run } = useActionToast();
  const [values, setValues] = React.useState<FormValues>(() => initialValues(banner, defaultPlacement));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);
  const readOnly = !canManage || pending;
  const info = placementInfo(values.placement);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: "" } : current));
    setDirty(true);
  }

  async function pickImage(title: string): Promise<PickedAsset | null> {
    const picked = await picker.open({ accept: "image", multiple: false, title });
    return picked?.[0] ?? null;
  }

  const preview = {
    title: values.title,
    subtitle: values.subtitle || null,
    placement: values.placement,
    imageUrl: values.media?.url ?? null,
    mobileImageUrl: values.mobileMedia?.url ?? null,
    altText: values.altText || null,
    buttonText: values.buttonText || null,
    textColor: values.textColor || null,
    bgColor: values.bgColor || null,
  };
  const previewStatus = deriveBannerStatus({
    isActive: values.isActive,
    startsAt: values.startsAt ? istStartOfDay(values.startsAt) : null,
    endsAt: values.endsAt ? istEndOfDay(values.endsAt) : null,
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly) return;

    const input = toInput(values);
    const parsed = bannerFormSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        const alias = ERROR_ALIASES[key] ?? key;
        if (alias && !fieldErrors[alias]) fieldErrors[alias] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    const result = await run(() => (mode === "create" || !banner ? createBannerAction(input) : updateBannerAction(banner.id, input)), {
      onSuccess: (data) => {
        setDirty(false);
        if (mode === "create") router.push(`/admin/banners/${data.id}` as Route);
        else router.refresh();
      },
    });
    if (!result.ok && result.fieldErrors) {
      const mapped: Record<string, string> = {};
      for (const [key, message] of Object.entries(result.fieldErrors)) mapped[ERROR_ALIASES[key] ?? key] = message;
      setErrors(mapped);
    }
  }

  const colorField = (key: "textColor" | "bgColor", id: string) => (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={`${key === "textColor" ? "Text" : "Background"} colour swatch`}
        value={/^#[0-9a-fA-F]{6}$/.test(values[key]) ? values[key] : key === "textColor" ? "#ffffff" : "#1f2937"}
        onChange={(event) => set(key, event.target.value)}
        disabled={readOnly}
        className="size-8 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
      />
      <Input id={id} value={values[key]} onChange={(event) => set(key, event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors[key]) || undefined} placeholder="#rrggbb" className="font-mono" maxLength={7} />
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" noValidate>
      <div className="space-y-4">
        <FormSection title="Content" description="What the banner says and where it appears.">
          <FormRowGroup columns={2}>
            <FormRow label="Title" htmlFor="banner-title" required error={errors.title}>
              <Input id="banner-title" value={values.title} onChange={(event) => set("title", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.title) || undefined} maxLength={120} autoFocus={mode === "create"} />
            </FormRow>
            <FormRow label="Placement" htmlFor="banner-placement" required hint={info.description}>
              <Select value={values.placement} onValueChange={(value) => set("placement", value as BannerPlacement)} disabled={readOnly}>
                <SelectTrigger id="banner-placement" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BANNER_PLACEMENTS.map((placement) => (
                    <SelectItem key={placement} value={placement}>
                      {BANNER_PLACEMENT_META[placement].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
          </FormRowGroup>
          <FormRow label="Subtitle" htmlFor="banner-subtitle" error={errors.subtitle}>
            <Textarea id="banner-subtitle" value={values.subtitle} onChange={(event) => set("subtitle", event.target.value)} disabled={readOnly} rows={2} maxLength={240} />
          </FormRow>
          <FormRowGroup columns={2}>
            <FormRow label="Button text" htmlFor="banner-button" error={errors.buttonText} hint="Leave empty for no button.">
              <Input id="banner-button" value={values.buttonText} onChange={(event) => set("buttonText", event.target.value)} disabled={readOnly} maxLength={40} />
            </FormRow>
            <FormRow label="Alt text" htmlFor="banner-alt" error={errors.altText} hint="Describes the image for screen readers and search engines.">
              <Input id="banner-alt" value={values.altText} onChange={(event) => set("altText", event.target.value)} disabled={readOnly} maxLength={200} />
            </FormRow>
          </FormRowGroup>
        </FormSection>

        <FormSection title="Creative" description={`Recommended: ${info.recommended}. The mobile image falls back to the desktop one.`}>
          <FormRow label="Desktop image" required={!info.imageOptional} error={errors.media}>
            <MediaField value={values.media} onChange={(asset) => set("media", asset)} onPick={() => pickImage("Choose the desktop image")} disabled={readOnly} hint={info.recommended} />
          </FormRow>
          <FormRow label="Mobile image" error={errors.mobileMedia} hint="Optional square or portrait crop for small screens.">
            <MediaField value={values.mobileMedia} onChange={(asset) => set("mobileMedia", asset)} onPick={() => pickImage("Choose the mobile image")} disabled={readOnly} />
          </FormRow>
          <FormRowGroup columns={2}>
            <FormRow label="Text colour" htmlFor="banner-text-color" error={errors.textColor} hint="Defaults to white over an image.">
              {colorField("textColor", "banner-text-color")}
            </FormRow>
            <FormRow label="Background colour" htmlFor="banner-bg-color" error={errors.bgColor} hint="Shown behind the text, or instead of an image.">
              {colorField("bgColor", "banner-bg-color")}
            </FormRow>
          </FormRowGroup>
        </FormSection>

        <FormSection title="Link" description="Where a tap takes the customer. Targets that are unpublished or deleted render without a link (§11.25).">
          <FormRow label="Link type" htmlFor="banner-link-type">
            <Select value={values.linkType} onValueChange={(value) => set("linkType", value as LinkType)} disabled={readOnly}>
              <SelectTrigger id="banner-link-type" className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LINK_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {LINK_TYPE_META[type].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          {values.linkType === "URL" ? (
            <FormRow label="URL" htmlFor="banner-url" required error={errors.linkUrl} hint="An https:// address or a storefront path starting with /.">
              <Input id="banner-url" value={values.linkUrl} onChange={(event) => set("linkUrl", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.linkUrl) || undefined} placeholder="/sale" />
            </FormRow>
          ) : null}
          {values.linkType === "CATEGORY" ? (
            <FormRow label="Category" htmlFor="banner-category" required error={errors.category}>
              <EntityPicker id="banner-category" kind="category" value={values.category} onChange={(ref) => set("category", ref)} disabled={readOnly} invalid={Boolean(errors.category)} placeholder="Choose a category" />
            </FormRow>
          ) : null}
          {values.linkType === "PRODUCT" ? (
            <FormRow label="Product" htmlFor="banner-product" required error={errors.product}>
              <EntityPicker id="banner-product" kind="product" value={values.product} onChange={(ref) => set("product", ref)} disabled={readOnly} invalid={Boolean(errors.product)} placeholder="Choose a product" />
            </FormRow>
          ) : null}
          {values.linkType === "PAGE" ? (
            <FormRow label="Page" htmlFor="banner-page" required error={errors.page}>
              <EntityPicker id="banner-page" kind="page" value={values.page} onChange={(ref) => set("page", ref)} disabled={readOnly} invalid={Boolean(errors.page)} placeholder="Choose a page" />
            </FormRow>
          ) : null}
          {values.linkType === "BLOG" ? (
            <FormRow label="Blog post" htmlFor="banner-blog" required error={errors.blogPost}>
              <EntityPicker id="banner-blog" kind="blog" value={values.blogPost} onChange={(ref) => set("blogPost", ref)} disabled={readOnly} invalid={Boolean(errors.blogPost)} placeholder="Choose a post" />
            </FormRow>
          ) : null}
        </FormSection>

        <FormSection title="Schedule & order" description="Whole IST days. The storefront switches at each boundary automatically.">
          <FormRowGroup columns={3}>
            <FormRow label="Starts" htmlFor="banner-starts" error={errors.startsAt}>
              <Input id="banner-starts" type="date" value={values.startsAt} onChange={(event) => set("startsAt", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.startsAt) || undefined} />
            </FormRow>
            <FormRow label="Ends" htmlFor="banner-ends" error={errors.endsAt}>
              <Input id="banner-ends" type="date" value={values.endsAt} onChange={(event) => set("endsAt", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.endsAt) || undefined} min={values.startsAt || undefined} />
            </FormRow>
            <FormRow label="Position" htmlFor="banner-position" error={errors.position} hint="Leave empty to append; drag on the board to fine-tune.">
              <Input id="banner-position" type="number" inputMode="numeric" min={0} step={1} value={values.position} onChange={(event) => set("position", event.target.value)} disabled={readOnly} placeholder="Last" />
            </FormRow>
          </FormRowGroup>
          <FormRow inline label="Visible" htmlFor="banner-active" hint="Off hides the banner regardless of schedule.">
            <Switch id="banner-active" checked={values.isActive} onCheckedChange={(value) => set("isActive", value)} disabled={readOnly} />
          </FormRow>
        </FormSection>

        {canManage ? (
          <FormActions dirty={dirty} pending={pending} submitLabel={mode === "create" ? "Create banner" : "Save changes"} onCancel={() => router.push("/admin/banners" as Route)} warnOnLeave />
        ) : null}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <div className="surface space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Preview</h3>
            <StatusPill label={BANNER_STATUS_META[previewStatus].label} tone={BANNER_STATUS_META[previewStatus].tone} />
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground text-[11px] uppercase tracking-wide">Desktop</p>
            <BannerPreview banner={preview} />
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground text-[11px] uppercase tracking-wide">Mobile</p>
            <BannerPreview banner={preview} variant="mobile" className="mx-auto w-40" />
          </div>
          {banner ? (
            <dl className="grid grid-cols-2 gap-2 border-t pt-3 text-xs">
              <dt className="text-muted-foreground">Impressions</dt>
              <dd className="tabular-nums">{formatNumber(banner.impressionCount)}</dd>
              <dt className="text-muted-foreground">Clicks</dt>
              <dd className="tabular-nums">
                {formatNumber(banner.clickCount)}
                {banner.impressionCount > 0 ? <span className="text-muted-foreground"> ({((banner.clickCount / banner.impressionCount) * 100).toFixed(1)}%)</span> : null}
              </dd>
            </dl>
          ) : null}
        </div>
      </aside>

      {picker.element}
    </form>
  );
}
