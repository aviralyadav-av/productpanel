"use client";

import * as React from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Star } from "lucide-react";

import { BLOG_STATUS_META, BLOG_STATUSES, type BlogStatus } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/shared/combobox";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import { HtmlPreview } from "@/components/shared/html-preview";
import { useMediaPicker, type PickedAsset } from "@/components/shared/media-picker";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { SlugInput } from "@/components/shared/slug-input";
import { StatusPill } from "@/components/shared/status-badge";
import { TagInput } from "@/components/shared/tag-input";
import { useActionToast } from "@/components/shared/use-action-toast";

import { MediaField } from "@/features/banners/components/media-field";
import { PreviewButton } from "@/features/pages/components/preview-button";
import { EMPTY_SEO, SeoSection, type SeoValues } from "@/features/pages/components/seo-section";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "@/features/pages/datetime";
import type { AuthorOption } from "@/features/pages/schemas";
import { countWords, excerptFromHtml, formatReadingTime, normalizeTags, readingMinutes } from "@/features/pages/text";

import { blogPreviewUrlAction, createBlogPostAction, updateBlogPostAction } from "../actions";
import { blogPostFormSchema, effectiveBlogStatus, storefrontBlogUrl, type BlogCategoryRow, type BlogPostEditorData, type BlogPostFormInput } from "../schemas";

/**
 * Create / edit form for a blog post (blueprint §4.8, §11.21/23, E6).
 *
 * Reading time is derived live from the body and stored on save; the author
 * defaults to the acting admin and is snapshotted as `authorName`. SCHEDULED
 * requires a future date - the storefront flips it live on its own, no job.
 * Related products / categories are EntityPicker chips; only ids persist.
 */

type FormValues = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  featuredImage: PickedAsset | null;
  categoryId: string | null;
  tags: string[];
  authorId: string | null;
  status: BlogStatus;
  publishedAt: string;
  isFeatured: boolean;
  relatedProducts: EntityRef[];
  relatedCategories: EntityRef[];
  seo: SeoValues;
};

function initialValues(post: BlogPostEditorData | undefined, actorId: string): FormValues {
  return {
    title: post?.title ?? "",
    slug: post?.slug ?? "",
    excerpt: post?.excerpt ?? "",
    content: post?.content ?? "",
    featuredImage: post?.featuredImage ?? null,
    categoryId: post?.categoryId ?? null,
    tags: post?.tags ?? [],
    authorId: post ? post.authorId : actorId,
    status: post?.status ?? "DRAFT",
    publishedAt: toDateTimeLocalValue(post?.publishedAt),
    isFeatured: post?.isFeatured ?? false,
    relatedProducts: post?.relatedProducts ?? [],
    relatedCategories: post?.relatedCategories ?? [],
    seo: post
      ? { metaTitle: post.metaTitle ?? "", metaDescription: post.metaDescription ?? "", metaKeywords: post.metaKeywords ?? "", canonicalUrl: post.canonicalUrl ?? "", ogImage: null, noIndex: false }
      : EMPTY_SEO,
  };
}

function toInput(values: FormValues): BlogPostFormInput {
  return {
    title: values.title,
    slug: values.slug,
    excerpt: values.excerpt,
    content: values.content,
    featuredImageMediaId: values.featuredImage?.id ?? null,
    categoryId: values.categoryId,
    tags: values.tags,
    authorId: values.authorId,
    status: values.status,
    publishedAt: fromDateTimeLocalValue(values.publishedAt),
    isFeatured: values.isFeatured,
    metaTitle: values.seo.metaTitle,
    metaDescription: values.seo.metaDescription,
    metaKeywords: values.seo.metaKeywords,
    canonicalUrl: values.seo.canonicalUrl,
    relatedProductIds: values.relatedProducts.map((ref) => ref.id),
    relatedCategoryIds: values.relatedCategories.map((ref) => ref.id),
  };
}

export function PostForm({
  mode,
  post,
  categories,
  authors,
  actorId,
  tagSuggestions,
  canManage,
  canPublish,
  storefrontBaseUrl,
}: {
  mode: "create" | "edit";
  post?: BlogPostEditorData;
  categories: BlogCategoryRow[];
  authors: AuthorOption[];
  actorId: string;
  tagSuggestions: string[];
  canManage: boolean;
  canPublish: boolean;
  storefrontBaseUrl: string;
}) {
  const router = useRouter();
  const picker = useMediaPicker();
  const { pending, run } = useActionToast();
  const [values, setValues] = React.useState<FormValues>(() => initialValues(post, actorId));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);
  const [showLivePreview, setShowLivePreview] = React.useState(false);
  const readOnly = !canManage || pending;
  const slugLocked = Boolean(post?.publishedAt);

  const words = React.useMemo(() => countWords(values.content), [values.content]);
  const minutes = readingMinutes(words);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: "" } : current));
    setDirty(true);
  }

  function setSeo(patch: Partial<SeoValues>) {
    setValues((current) => ({ ...current, seo: { ...current.seo, ...patch } }));
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
    const parsed = blogPostFormSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    const result = await run(() => (mode === "create" || !post ? createBlogPostAction(input) : updateBlogPostAction(post.id, input)), {
      onSuccess: (data) => {
        setDirty(false);
        if (mode === "create") router.push(`/admin/blog/${data.id}` as Route);
        else router.refresh();
      },
    });
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  const status = BLOG_STATUS_META[values.status];
  const effective = effectiveBlogStatus({ status: values.status, publishedAt: values.publishedAt ? new Date(values.publishedAt) : null });
  const publicUrl = storefrontBlogUrl(storefrontBaseUrl || "https://your-storefront", values.slug || "slug");
  const categoryOptions = categories.map((category) => ({ value: category.id, label: category.name, description: category.isActive ? undefined : "inactive" }));
  const authorOptions = authors.map((author) => ({ value: author.id, label: author.name ?? author.email, description: author.name ? author.email : undefined }));

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]" noValidate>
      <div className="space-y-4">
        <FormSection title="Post" description="Title, address and the short excerpt shown on cards and in search results.">
          <FormRow label="Title" htmlFor="post-title" required error={errors.title}>
            <Input id="post-title" value={values.title} onChange={(event) => set("title", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.title) || undefined} maxLength={200} autoFocus={mode === "create"} />
          </FormRow>
          <FormRow label="Slug" htmlFor="post-slug" required error={errors.slug} hint={slugLocked ? "Published: changing the address breaks shared links. Unlock only if you must." : "Follows the title until you edit it."}>
            <SlugInput id="post-slug" sourceValue={values.title} value={values.slug} onChange={(slug) => set("slug", slug)} locked={slugLocked} prefix="/blog/" disabled={readOnly} invalid={Boolean(errors.slug)} />
          </FormRow>
          <FormRow label="Excerpt" htmlFor="post-excerpt" error={errors.excerpt} hint="Leave empty to derive it from the first lines of the post.">
            <Textarea id="post-excerpt" value={values.excerpt} onChange={(event) => set("excerpt", event.target.value)} disabled={readOnly} rows={2} maxLength={500} placeholder={excerptFromHtml(values.content) || undefined} />
          </FormRow>
          <FormRow label="Featured image" error={errors.featuredImageMediaId} hint="Shown on cards and as the social image. 1200 × 630 or wider.">
            <MediaField value={values.featuredImage} onChange={(asset) => set("featuredImage", asset)} onPick={() => pickImage("Choose the featured image")} disabled={readOnly} emptyLabel="No featured image" />
          </FormRow>
        </FormSection>

        <FormSection
          title="Content"
          description="Rich text; images from the media library. Scripts and unknown tags are stripped on save."
          actions={
            <Button type="button" variant="ghost" size="xs" onClick={() => setShowLivePreview((current) => !current)}>
              {showLivePreview ? <EyeOff /> : <Eye />} {showLivePreview ? "Hide preview" : "Live preview"}
            </Button>
          }
        >
          <FormRow label="Body" htmlFor="post-content" error={errors.content}>
            <RichTextEditor id="post-content" value={values.content} onChange={(html) => set("content", html)} onPickImage={picker.pickImage} disabled={readOnly} minHeight={400} placeholder="Write the post…" />
          </FormRow>
          <p className="text-muted-foreground text-[11px]" data-numeric>
            {words.toLocaleString("en-IN")} word{words === 1 ? "" : "s"} · {formatReadingTime(minutes)} (stored as readingMinutes on save)
          </p>
          {showLivePreview ? <HtmlPreview html={values.content} title="Unsaved content preview" minHeight={320} /> : null}
        </FormSection>

        <FormSection title="Organisation" description="Category and tags drive the storefront's blog filters; related products and categories render as cards under the post.">
          <FormRowGroup columns={2}>
            <FormRow label="Category" htmlFor="post-category" error={errors.categoryId}>
              <SearchableSelect id="post-category" options={categoryOptions} value={values.categoryId} onChange={(value) => set("categoryId", value)} placeholder="Uncategorised" allowClear disabled={readOnly} invalid={Boolean(errors.categoryId)} />
            </FormRow>
            <FormRow label="Author" htmlFor="post-author" error={errors.authorId} hint={post?.authorName ? `Byline currently "${post.authorName}"; re-saving refreshes it from the chosen admin.` : "Defaults to you. The name is snapshotted at save time."}>
              <SearchableSelect id="post-author" options={authorOptions} value={values.authorId} onChange={(value) => set("authorId", value)} placeholder="Choose an author" allowClear disabled={readOnly} />
            </FormRow>
          </FormRowGroup>
          <FormRow label="Tags" htmlFor="post-tags" error={errors.tags} hint="Lowercase; suggestions come from tags already in use.">
            <TagInput id="post-tags" value={values.tags} onChange={(tags) => set("tags", normalizeTags(tags))} suggestions={tagSuggestions} maxTags={20} disabled={readOnly} normalize={(tag) => tag.trim().toLowerCase()} placeholder="Add a tag and press Enter" />
          </FormRow>
          <FormRowGroup columns={2}>
            <FormRow label="Related products" htmlFor="post-products" error={errors.relatedProductIds}>
              <EntityPicker id="post-products" kind="product" multiple value={values.relatedProducts} onChange={(refs) => set("relatedProducts", refs)} disabled={readOnly} placeholder="Add products" />
            </FormRow>
            <FormRow label="Related categories" htmlFor="post-categories" error={errors.relatedCategoryIds}>
              <EntityPicker id="post-categories" kind="category" multiple value={values.relatedCategories} onChange={(refs) => set("relatedCategories", refs)} disabled={readOnly} placeholder="Add categories" />
            </FormRow>
          </FormRowGroup>
        </FormSection>

        <SeoSection values={values.seo} onChange={setSeo} errors={errors} disabled={readOnly} onPickImage={() => pickImage("Choose a social image")} fallbackTitle={values.title} fallbackDescription={values.excerpt || excerptFromHtml(values.content)} url={publicUrl} idPrefix="post" showNoIndex={false} showOgImage={false} />

        {canManage ? (
          <FormActions
            dirty={dirty}
            pending={pending}
            submitLabel={mode === "create" ? "Create post" : "Save changes"}
            onCancel={() => router.push("/admin/blog" as Route)}
            secondary={post ? <PreviewButton action={() => blogPreviewUrlAction(post.id)} /> : null}
            warnOnLeave
          />
        ) : null}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <FormSection title="Publishing" description={canPublish ? "Scheduled posts go live at the chosen time without any further action." : "You can edit content; publishing needs the 'Publish blog' permission."} className="lg:grid-cols-1 lg:gap-4">
          <FormRow label="Status" htmlFor="post-status" error={errors.status}>
            <div className="flex items-center gap-2">
              <Select value={values.status} onValueChange={(value) => set("status", value as BlogStatus)} disabled={readOnly || !canPublish}>
                <SelectTrigger id="post-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BLOG_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {BLOG_STATUS_META[value].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <StatusPill label={status.label} tone={status.tone} />
            </div>
            {effective !== values.status ? <p className="text-warning mt-1 text-[11px]">The storefront will treat this as {BLOG_STATUS_META[effective].label.toLowerCase()} given the date below.</p> : null}
          </FormRow>
          <FormRow label={values.status === "SCHEDULED" ? "Goes live at" : "Published at"} htmlFor="post-published-at" required={values.status === "SCHEDULED"} error={errors.publishedAt} hint={values.status === "SCHEDULED" ? "Must be in the future." : values.status === "PUBLISHED" ? "Leave empty to stamp the moment you save." : "Kept as history."}>
            <Input id="post-published-at" type="datetime-local" value={values.publishedAt} onChange={(event) => set("publishedAt", event.target.value)} disabled={readOnly || !canPublish} aria-invalid={Boolean(errors.publishedAt) || undefined} />
          </FormRow>
          <FormRow inline label={<span className="inline-flex items-center gap-1"><Star className="size-3" /> Featured</span>} htmlFor="post-featured" hint="Pinned to the top of the blog index and eligible for homepage sections.">
            <Switch id="post-featured" checked={values.isFeatured} onCheckedChange={(value) => set("isFeatured", value)} disabled={readOnly} />
          </FormRow>
          {post ? (
            <dl className="grid grid-cols-2 gap-1 border-t pt-3 text-[11px]">
              <dt className="text-muted-foreground">Views</dt>
              <dd data-numeric>{post.viewCount.toLocaleString("en-IN")}</dd>
              <dt className="text-muted-foreground">Reading time</dt>
              <dd>{formatReadingTime(post.readingMinutes)}</dd>
              <dt className="text-muted-foreground">Byline</dt>
              <dd className="truncate">{post.authorName ?? "—"}</dd>
              <dt className="text-muted-foreground">Public URL</dt>
              <dd className="truncate font-mono">{storefrontBlogUrl(storefrontBaseUrl || "", post.slug)}</dd>
            </dl>
          ) : null}
        </FormSection>
      </aside>

      {picker.element}
    </form>
  );
}
