"use client";

import * as React from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock } from "lucide-react";

import { CMS_PAGE_STATUS_META, CMS_PAGE_STATUSES, CMS_PAGE_TEMPLATE_META, CMS_PAGE_TEMPLATES, type CmsPageStatus, type CmsPageTemplate } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import { HtmlPreview } from "@/components/shared/html-preview";
import { useMediaPicker, type PickedAsset } from "@/components/shared/media-picker";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { SlugInput } from "@/components/shared/slug-input";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { createPageAction, pagePreviewUrlAction, updatePageAction } from "../actions";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "../datetime";
import { pageFormSchema, storefrontPageUrl, type PageEditorData, type PageFormInput } from "../schemas";
import { countWords, excerptFromHtml, formatReadingTime, readingMinutes } from "../text";
import { PreviewButton } from "./preview-button";
import { EMPTY_SEO, SeoSection, type SeoValues } from "./seo-section";

/**
 * Create / edit form for a CMS page (blueprint §4.8, §11.21/23/24, E5, E6).
 *
 * The slug follows the title on a new page and is locked once the page has
 * been published (its URL is out there) and always for system pages (E5).
 * Content is edited as HTML in the rich text editor; the server sanitises it
 * on save, so what the HTML preview tab shows after saving is the storefront
 * truth. Status changes are only offered to actors with `pages.publish`;
 * unpublishing a system page asks for confirmation because the footer and
 * checkout link to those pages.
 */

type FormValues = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  template: CmsPageTemplate;
  status: CmsPageStatus;
  publishedAt: string;
  showInFooter: boolean;
  seo: SeoValues;
};

function initialValues(page: PageEditorData | undefined): FormValues {
  return {
    title: page?.title ?? "",
    slug: page?.slug ?? "",
    excerpt: page?.excerpt ?? "",
    content: page?.content ?? "",
    template: page?.template ?? "DEFAULT",
    status: page?.status ?? "DRAFT",
    publishedAt: toDateTimeLocalValue(page?.publishedAt),
    showInFooter: page?.showInFooter ?? false,
    seo: page
      ? {
          metaTitle: page.metaTitle ?? "",
          metaDescription: page.metaDescription ?? "",
          metaKeywords: page.metaKeywords ?? "",
          canonicalUrl: page.canonicalUrl ?? "",
          ogImage: page.ogImage,
          noIndex: page.noIndex,
        }
      : EMPTY_SEO,
  };
}

function toInput(values: FormValues): PageFormInput {
  return {
    title: values.title,
    slug: values.slug,
    excerpt: values.excerpt,
    content: values.content,
    template: values.template,
    status: values.status,
    publishedAt: fromDateTimeLocalValue(values.publishedAt),
    showInFooter: values.showInFooter,
    metaTitle: values.seo.metaTitle,
    metaDescription: values.seo.metaDescription,
    metaKeywords: values.seo.metaKeywords,
    canonicalUrl: values.seo.canonicalUrl,
    ogImageMediaId: values.seo.ogImage?.id ?? null,
    noIndex: values.seo.noIndex,
  };
}

export function PageForm({
  mode,
  page,
  canManage,
  canPublish,
  storefrontBaseUrl,
}: {
  mode: "create" | "edit";
  page?: PageEditorData;
  canManage: boolean;
  canPublish: boolean;
  storefrontBaseUrl: string;
}) {
  const router = useRouter();
  const picker = useMediaPicker();
  const [confirm, confirmDialog] = useConfirm();
  const { pending, run } = useActionToast();
  const [values, setValues] = React.useState<FormValues>(() => initialValues(page));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);
  const [showLivePreview, setShowLivePreview] = React.useState(false);
  const readOnly = !canManage || pending;
  const isSystem = page?.isSystem ?? false;
  const slugLocked = isSystem || Boolean(page?.publishedAt);

  const words = React.useMemo(() => countWords(values.content), [values.content]);
  const minutes = readingMinutes(words);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: "" } : current));
    setDirty(true);
  }

  function setSeo(patch: Partial<SeoValues>) {
    setValues((current) => ({ ...current, seo: { ...current.seo, ...patch } }));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key === "ogImage" ? "ogImageMediaId" : key];
      return next;
    });
    setDirty(true);
  }

  async function pickImage(title: string): Promise<PickedAsset | null> {
    const picked = await picker.open({ accept: "image", multiple: false, title });
    return picked?.[0] ?? null;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly) return;

    const input = toInput(values);
    const parsed = pageFormSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    // §11.24: a system page can be unpublished, but the footer/checkout link to it - make sure it is deliberate.
    if (isSystem && page?.status === "PUBLISHED" && values.status !== "PUBLISHED") {
      const answer = await confirm({
        title: `Unpublish "${page.title}"?`,
        description: "This is a system page. The storefront footer, checkout and seller onboarding link to it; those links will lead to a not-found page until it is published again.",
        confirmLabel: "Unpublish anyway",
        destructive: true,
      });
      if (!answer.ok) return;
    }

    const result = await run(() => (mode === "create" || !page ? createPageAction(input) : updatePageAction(page.id, input)), {
      onSuccess: (data) => {
        setDirty(false);
        if (mode === "create") router.push(`/admin/pages/${data.id}` as Route);
        else router.refresh();
      },
    });
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  const status = CMS_PAGE_STATUS_META[values.status];
  const publicUrl = storefrontPageUrl(storefrontBaseUrl || "https://your-storefront", values.slug || "slug");

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]" noValidate>
      <div className="space-y-4">
        <FormSection title="Page" description="The title is the H1 the storefront renders; the excerpt is used for search results and list cards when no meta description is set.">
          <FormRow label="Title" htmlFor="page-title" required error={errors.title}>
            <Input id="page-title" value={values.title} onChange={(event) => set("title", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.title) || undefined} maxLength={200} autoFocus={mode === "create"} />
          </FormRow>
          <FormRow
            label={
              <span className="inline-flex items-center gap-1.5">
                Slug {isSystem ? <Lock className="text-muted-foreground size-3" aria-label="System page: slug locked" /> : null}
              </span>
            }
            htmlFor="page-slug"
            required
            error={errors.slug}
            hint={isSystem ? "System pages keep their address; the storefront routes to it by name." : slugLocked ? "Published: changing the address breaks existing links. Unlock only if you must." : "Follows the title until you edit it."}
          >
            <SlugInput id="page-slug" sourceValue={values.title} value={values.slug} onChange={(slug) => set("slug", slug)} locked={slugLocked} prefix="/pages/" disabled={readOnly || isSystem} invalid={Boolean(errors.slug)} />
          </FormRow>
          <FormRow label="Excerpt" htmlFor="page-excerpt" error={errors.excerpt} hint="One or two sentences. Leave empty to derive it from the content.">
            <Textarea id="page-excerpt" value={values.excerpt} onChange={(event) => set("excerpt", event.target.value)} disabled={readOnly} rows={2} maxLength={500} placeholder={excerptFromHtml(values.content) || undefined} />
          </FormRow>
          <FormRowGroup columns={2}>
            <FormRow label="Template" htmlFor="page-template" hint={CMS_PAGE_TEMPLATE_META[values.template].description ?? "How the storefront lays the page out."}>
              <Select value={values.template} onValueChange={(value) => set("template", value as CmsPageTemplate)} disabled={readOnly}>
                <SelectTrigger id="page-template" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CMS_PAGE_TEMPLATES.map((template) => (
                    <SelectItem key={template} value={template}>
                      {CMS_PAGE_TEMPLATE_META[template].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
            <FormRow inline label="Show in footer" htmlFor="page-footer" hint="Lists the page in the storefront footer's pages column.">
              <Switch id="page-footer" checked={values.showInFooter} onCheckedChange={(value) => set("showInFooter", value)} disabled={readOnly} />
            </FormRow>
          </FormRowGroup>
        </FormSection>

        <FormSection
          title="Content"
          description="Rich text. Images come from the media library so they are optimised and survive a storage move. Scripts, styles and unknown tags are stripped on save."
          actions={
            <Button type="button" variant="ghost" size="xs" onClick={() => setShowLivePreview((current) => !current)}>
              {showLivePreview ? <EyeOff /> : <Eye />} {showLivePreview ? "Hide preview" : "Live preview"}
            </Button>
          }
        >
          <FormRow label="Body" htmlFor="page-content" error={errors.content}>
            <RichTextEditor id="page-content" value={values.content} onChange={(html) => set("content", html)} onPickImage={picker.pickImage} disabled={readOnly} minHeight={360} placeholder="Write the page…" />
          </FormRow>
          <p className="text-muted-foreground text-[11px]" data-numeric>
            {words.toLocaleString("en-IN")} word{words === 1 ? "" : "s"} · {formatReadingTime(minutes)}
          </p>
          {showLivePreview ? <HtmlPreview html={values.content} title="Unsaved content preview" minHeight={320} /> : null}
        </FormSection>

        <SeoSection values={values.seo} onChange={setSeo} errors={errors} disabled={readOnly} onPickImage={() => pickImage("Choose a social image")} fallbackTitle={values.title} fallbackDescription={values.excerpt || excerptFromHtml(values.content)} url={publicUrl} idPrefix="page" />

        {canManage ? (
          <FormActions
            dirty={dirty}
            pending={pending}
            submitLabel={mode === "create" ? "Create page" : "Save changes"}
            onCancel={() => router.push("/admin/pages" as Route)}
            secondary={page ? <PreviewButton action={() => pagePreviewUrlAction(page.id)} /> : null}
            warnOnLeave
          />
        ) : null}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <FormSection title="Publishing" description={canPublish ? "Published pages are live immediately; archived pages return 404 but keep their content." : "You can edit content; publishing needs the 'Publish pages' permission."} className="lg:grid-cols-1 lg:gap-4">
          <FormRow label="Status" htmlFor="page-status" error={errors.status}>
            <div className="flex items-center gap-2">
              <Select value={values.status} onValueChange={(value) => set("status", value as CmsPageStatus)} disabled={readOnly || !canPublish}>
                <SelectTrigger id="page-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CMS_PAGE_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {CMS_PAGE_STATUS_META[value].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <StatusPill label={status.label} tone={status.tone} />
            </div>
          </FormRow>
          <FormRow label="Published at" htmlFor="page-published-at" error={errors.publishedAt} hint={values.status === "PUBLISHED" ? "Leave empty to stamp the moment you save." : "Kept as history; shown on the storefront when published."}>
            <Input id="page-published-at" type="datetime-local" value={values.publishedAt} onChange={(event) => set("publishedAt", event.target.value)} disabled={readOnly || !canPublish} />
          </FormRow>
          {isSystem ? (
            <p className="text-muted-foreground flex items-start gap-1.5 text-[11px] leading-relaxed">
              <Lock className="mt-0.5 size-3 shrink-0" /> System page: cannot be deleted, slug is fixed. Unpublishing warns because the storefront links here.
            </p>
          ) : null}
          {page ? (
            <dl className="grid grid-cols-2 gap-1 border-t pt-3 text-[11px]">
              <dt className="text-muted-foreground">Author</dt>
              <dd className="truncate">{page.author?.name ?? page.author?.email ?? "—"}</dd>
              <dt className="text-muted-foreground">Menu links</dt>
              <dd data-numeric>{page.usage.navigationItems}</dd>
              <dt className="text-muted-foreground">Banners</dt>
              <dd data-numeric>{page.usage.banners}</dd>
              <dt className="text-muted-foreground">Public URL</dt>
              <dd className="truncate font-mono">{storefrontPageUrl(storefrontBaseUrl || "", page.slug)}</dd>
            </dl>
          ) : null}
        </FormSection>
      </aside>

      {picker.element}
      {confirmDialog}
    </form>
  );
}
