"use client";

import { ImagePlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import type { PickedAsset } from "@/components/shared/media-picker";
import { ProductThumb } from "@/components/shared/product-thumb";

/**
 * The SEO block shared by CMS pages and blog posts: meta title/description
 * with length meters, keywords, canonical URL, an OG image from the media
 * library and a noindex switch, plus a Google-style snippet preview so the
 * operator sees the truncation before a search engine does.
 *
 * Controlled and shape-agnostic: the parent hands in `values` and receives
 * one `onChange(patch)` per edit, so it plugs into any form state.
 */
export type SeoValues = {
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
  canonicalUrl: string;
  ogImage: PickedAsset | null;
  noIndex: boolean;
};

export const EMPTY_SEO: SeoValues = { metaTitle: "", metaDescription: "", metaKeywords: "", canonicalUrl: "", ogImage: null, noIndex: false };

export function SeoSection({
  values,
  onChange,
  errors = {},
  disabled,
  onPickImage,
  fallbackTitle,
  fallbackDescription,
  url,
  idPrefix = "seo",
  showNoIndex = true,
  showOgImage = true,
}: {
  values: SeoValues;
  onChange: (patch: Partial<SeoValues>) => void;
  errors?: Record<string, string | undefined>;
  disabled?: boolean;
  onPickImage: () => Promise<PickedAsset | null>;
  /** What the snippet shows when the meta fields are empty (the page title / excerpt). */
  fallbackTitle: string;
  fallbackDescription: string;
  /** The public URL the snippet displays. */
  url: string;
  idPrefix?: string;
  showNoIndex?: boolean;
  /**
   * Off for entities that have no `ogImageMediaId` column - a blog post's
   * featured image IS its social image. Offering a picker whose value the
   * service would silently drop is worse than not offering one at all.
   */
  showOgImage?: boolean;
}) {
  const title = values.metaTitle || fallbackTitle;
  const description = values.metaDescription || fallbackDescription;

  return (
    <FormSection
      id="seo"
      title="SEO"
      description="Search-engine title and description fall back to the title and excerpt. Keep the title under 60 characters and the description under 160 so neither is cut."
    >
      <FormRow
        label={
          <span className="flex items-center gap-2">
            Meta title <LengthMeter value={values.metaTitle.length} ideal={60} max={160} />
          </span>
        }
        htmlFor={`${idPrefix}-meta-title`}
        error={errors.metaTitle}
      >
        <Input id={`${idPrefix}-meta-title`} value={values.metaTitle} onChange={(event) => onChange({ metaTitle: event.target.value })} maxLength={160} placeholder={fallbackTitle} disabled={disabled} />
      </FormRow>
      <FormRow
        label={
          <span className="flex items-center gap-2">
            Meta description <LengthMeter value={values.metaDescription.length} ideal={160} max={320} />
          </span>
        }
        htmlFor={`${idPrefix}-meta-description`}
        error={errors.metaDescription}
      >
        <Textarea id={`${idPrefix}-meta-description`} rows={3} value={values.metaDescription} onChange={(event) => onChange({ metaDescription: event.target.value })} maxLength={320} placeholder={fallbackDescription} disabled={disabled} />
      </FormRow>
      <FormRowGroup columns={2}>
        <FormRow label="Keywords" htmlFor={`${idPrefix}-meta-keywords`} error={errors.metaKeywords} hint="Comma-separated. Most engines ignore these; some site searches do not.">
          <Input id={`${idPrefix}-meta-keywords`} value={values.metaKeywords} onChange={(event) => onChange({ metaKeywords: event.target.value })} maxLength={500} disabled={disabled} placeholder="handmade, diy, gifts" />
        </FormRow>
        <FormRow label="Canonical URL" htmlFor={`${idPrefix}-canonical`} error={errors.canonicalUrl} hint="Only when this content is a copy of another address.">
          <Input id={`${idPrefix}-canonical`} value={values.canonicalUrl} onChange={(event) => onChange({ canonicalUrl: event.target.value })} placeholder="https://" disabled={disabled} aria-invalid={Boolean(errors.canonicalUrl) || undefined} />
        </FormRow>
      </FormRowGroup>
      <FormRowGroup columns={2}>
        {showOgImage ? (
          <FormRow label="Social image" error={errors.ogImageMediaId} hint="Shown when the link is shared. 1200 × 630 works everywhere.">
            <div className="flex items-center gap-2">
              {values.ogImage ? <ProductThumb src={values.ogImage.thumbnailUrl ?? values.ogImage.url} alt={values.ogImage.alt ?? values.ogImage.filename} size={40} /> : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={async () => {
                  const picked = await onPickImage();
                  if (picked) onChange({ ogImage: picked });
                }}
              >
                <ImagePlus /> {values.ogImage ? "Replace" : "Choose"}
              </Button>
              {values.ogImage ? (
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove social image" disabled={disabled} onClick={() => onChange({ ogImage: null })}>
                  <X />
                </Button>
              ) : null}
            </div>
          </FormRow>
        ) : null}
        {showNoIndex ? (
          <FormRow inline label="Hide from search engines" htmlFor={`${idPrefix}-noindex`} hint="Adds noindex. Use for thank-you pages and internal notices.">
            <Switch id={`${idPrefix}-noindex`} checked={values.noIndex} onCheckedChange={(noIndex) => onChange({ noIndex })} disabled={disabled} />
          </FormRow>
        ) : null}
      </FormRowGroup>
      <SeoSnippet title={title} url={url} description={description} noIndex={values.noIndex} />
    </FormSection>
  );
}

/** A search-result card as Google renders it, with the same truncation rules. */
export function SeoSnippet({ title, url, description, noIndex }: { title: string; url: string; description: string; noIndex?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-muted-foreground mb-1 flex items-center justify-between text-[11px] uppercase tracking-wide">
        Snippet preview
        {noIndex ? <span className="text-warning normal-case tracking-normal">noindex — will not be listed</span> : null}
      </p>
      <p className="truncate text-sm font-medium text-[#1a0dab] dark:text-[#8ab4f8]">{title || "Title"}</p>
      <p className="text-muted-foreground truncate text-xs">{url}</p>
      <p className="line-clamp-2 text-xs">{description || "A description will appear here."}</p>
    </div>
  );
}

function LengthMeter({ value, ideal, max }: { value: number; ideal: number; max: number }) {
  const tone = value === 0 ? "text-muted-foreground" : value <= ideal ? "text-success" : value <= max ? "text-warning" : "text-destructive";
  return (
    <span className={`text-[10px] font-normal tabular-nums ${tone}`} data-numeric>
      {value}/{ideal}
    </span>
  );
}
