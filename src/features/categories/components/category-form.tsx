"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { TriangleAlert } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import { useMediaPicker, type PickedAsset } from "@/components/shared/media-picker";
import { SlugInput } from "@/components/shared/slug-input";
import { useActionToast } from "@/components/shared/use-action-toast";

import { createCategoryAction, updateCategoryAction } from "../actions";
import type { CategoryMedia, CategoryMediaKey, CategoryOption } from "../queries";
import { categoryInputSchema, storefrontCategoryPath, type CategoryInput } from "../schemas";
import type { CategoryRecord } from "../service";
import { CategoryTreeSelect } from "./category-tree-select";
import { CategoryIconPreview } from "./icon-preview";
import { MediaField } from "./media-field";

/**
 * Create / edit form for a category (blueprint §1 Categories, A9, §11.23).
 *
 * The form validates with the SAME zod schema the server enforces, so the
 * red outline the operator sees is produced by exactly the rule that would
 * reject the save. Media is referenced by ID and displayed from the picked
 * asset; the slug is derived from the name on create and locked on edit
 * because changing it rewrites every descendant's storefront URL (A9) - the
 * unlock affordance says so.
 */

type FormValues = {
  name: string;
  slug: string;
  parentId: string | null;
  description: string;
  position: string;
  isActive: boolean;
  isFeatured: boolean;
  iconName: string;
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
  canonicalUrl: string;
  noIndex: boolean;
};

const EMPTY_MEDIA: CategoryMedia = { imageMediaId: null, iconMediaId: null, bannerMediaId: null, ogImageMediaId: null };

function initialValues(category: CategoryRecord | undefined, defaultParentId: string | null): FormValues {
  return {
    name: category?.name ?? "",
    slug: category?.slug ?? "",
    parentId: category?.parentId ?? defaultParentId,
    description: category?.description ?? "",
    position: category ? String(category.position) : "",
    isActive: category?.isActive ?? true,
    isFeatured: category?.isFeatured ?? false,
    iconName: category?.iconName ?? "",
    metaTitle: category?.metaTitle ?? "",
    metaDescription: category?.metaDescription ?? "",
    metaKeywords: category?.metaKeywords ?? "",
    canonicalUrl: category?.canonicalUrl ?? "",
    noIndex: category?.noIndex ?? false,
  };
}

export function CategoryForm({
  mode,
  category,
  media: initialMedia,
  categories,
  defaultParentId = null,
  canManage,
}: {
  mode: "create" | "edit";
  category?: CategoryRecord;
  media?: CategoryMedia;
  categories: CategoryOption[];
  defaultParentId?: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const picker = useMediaPicker();
  const { pending, run } = useActionToast();

  const [values, setValues] = React.useState<FormValues>(() => initialValues(category, defaultParentId));
  const [media, setMedia] = React.useState<CategoryMedia>(initialMedia ?? EMPTY_MEDIA);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);
  const readOnly = !canManage || pending;

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: "" } : current));
    setDirty(true);
  }

  function setAsset(key: CategoryMediaKey, asset: PickedAsset | null) {
    setMedia((current) => ({ ...current, [key]: asset }));
    setDirty(true);
  }

  async function pickImage(): Promise<PickedAsset | null> {
    const picked = await picker.open({ accept: "image", multiple: false, title: "Choose an image" });
    return picked?.[0] ?? null;
  }

  const slugChanged = mode === "edit" && category ? values.slug !== category.slug : false;
  const parentChanged = mode === "edit" && category ? values.parentId !== category.parentId : false;

  const parentPath = React.useMemo(() => {
    const parent = values.parentId ? categories.find((option) => option.id === values.parentId) : null;
    // Options carry slugs, not full paths; the preview joins the ancestor slugs.
    if (!parent) return "";
    const segments: string[] = [];
    let cursor: CategoryOption | undefined = parent;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      segments.unshift(cursor.slug);
      cursor = cursor.parentId ? categories.find((option) => option.id === cursor?.parentId) : undefined;
    }
    return `/${segments.join("/")}`;
  }, [values.parentId, categories]);
  const previewPath = storefrontCategoryPath(`${parentPath}/${values.slug || "…"}`.replace(/^\/+/, ""));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly) return;

    const input: CategoryInput = {
      name: values.name,
      slug: values.slug || undefined,
      parentId: values.parentId,
      description: values.description,
      position: values.position === "" ? undefined : Number(values.position),
      isActive: values.isActive,
      isFeatured: values.isFeatured,
      imageMediaId: media.imageMediaId?.id ?? null,
      iconMediaId: media.iconMediaId?.id ?? null,
      bannerMediaId: media.bannerMediaId?.id ?? null,
      iconName: values.iconName,
      metaTitle: values.metaTitle,
      metaDescription: values.metaDescription,
      metaKeywords: values.metaKeywords,
      canonicalUrl: values.canonicalUrl,
      ogImageMediaId: media.ogImageMediaId?.id ?? null,
      noIndex: values.noIndex,
    };
    const parsed = categoryInputSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    const result = await run(
      () => (mode === "create" ? createCategoryAction(parsed.data) : updateCategoryAction(category!.id, parsed.data)),
      {
        onSuccess: (saved) => {
          setDirty(false);
          if (mode === "create") router.push(`/admin/categories/${saved.id}` as Route);
          else router.refresh();
        },
      },
    );
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <FormSection title="Basics" description="Name, position in the tree and visibility.">
        <FormRowGroup columns={2}>
          <FormRow label="Name" htmlFor="cat-name" required error={errors.name}>
            <Input
              id="cat-name"
              value={values.name}
              onChange={(event) => set("name", event.target.value)}
              disabled={readOnly}
              aria-invalid={Boolean(errors.name) || undefined}
              maxLength={120}
              autoFocus={mode === "create"}
            />
          </FormRow>
          <FormRow
            label="Slug"
            htmlFor="cat-slug"
            error={errors.slug}
            hint={
              slugChanged ? (
                <span className="text-warning inline-flex items-center gap-1">
                  <TriangleAlert className="size-3" /> Changing the slug rewrites the storefront path of this category and every sub-category.
                </span>
              ) : (
                <>
                  Storefront path: <span className="font-mono">{previewPath}</span>
                </>
              )
            }
          >
            <SlugInput
              id="cat-slug"
              sourceValue={values.name}
              value={values.slug}
              onChange={(slug) => set("slug", slug)}
              locked={mode === "edit"}
              disabled={readOnly}
              invalid={Boolean(errors.slug)}
            />
          </FormRow>
        </FormRowGroup>

        <FormRowGroup columns={2}>
          <FormRow
            label="Parent category"
            htmlFor="cat-parent"
            error={errors.parentId}
            hint={
              parentChanged
                ? "Moving re-parents the whole subtree; products under it pick up the new attribute set and their facets are rebuilt in the background."
                : "Leave empty for a top-level category. A category cannot be placed under itself or its descendants."
            }
          >
            <CategoryTreeSelect
              id="cat-parent"
              value={values.parentId}
              onChange={(parentId) => set("parentId", parentId)}
              categories={categories}
              excludeId={category?.id}
              allowNone
              noneLabel="No parent (top level)"
              disabled={readOnly}
              invalid={Boolean(errors.parentId)}
            />
          </FormRow>
          <FormRow label="Position" htmlFor="cat-position" error={errors.position} hint="Order among siblings; lower comes first. Leave empty to append.">
            <Input
              id="cat-position"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={values.position}
              onChange={(event) => set("position", event.target.value)}
              disabled={readOnly}
              className="max-w-32"
            />
          </FormRow>
        </FormRowGroup>

        <FormRow label="Description" htmlFor="cat-description" error={errors.description} hint="Shown at the top of the category page on the storefront.">
          <Textarea
            id="cat-description"
            value={values.description}
            onChange={(event) => set("description", event.target.value)}
            disabled={readOnly}
            rows={3}
            maxLength={2000}
          />
        </FormRow>

        <FormRowGroup columns={2}>
          <FormRow inline label="Active" htmlFor="cat-active" hint="Disabled categories and everything under them disappear from the storefront; products stay published but unreachable by category.">
            <Switch id="cat-active" checked={values.isActive} onCheckedChange={(value) => set("isActive", value)} disabled={readOnly} />
          </FormRow>
          <FormRow inline label="Featured" htmlFor="cat-featured" hint="Eligible for featured-category sections on the homepage.">
            <Switch id="cat-featured" checked={values.isFeatured} onCheckedChange={(value) => set("isFeatured", value)} disabled={readOnly} />
          </FormRow>
        </FormRowGroup>
      </FormSection>

      <FormSection title="Media" description="Referenced from the media library; replacing a file there updates the storefront everywhere it is used.">
        <FormRowGroup columns={3}>
          <FormRow label="Image" hint="Category card / tile.">
            <MediaField value={media.imageMediaId} onChange={(asset) => setAsset("imageMediaId", asset)} onPick={pickImage} disabled={readOnly} />
          </FormRow>
          <FormRow label="Icon" hint="Small icon for menus; falls back to the icon name below.">
            <MediaField value={media.iconMediaId} onChange={(asset) => setAsset("iconMediaId", asset)} onPick={pickImage} disabled={readOnly} />
          </FormRow>
          <FormRow label="Banner" hint="Wide header image for the category page.">
            <MediaField value={media.bannerMediaId} onChange={(asset) => setAsset("bannerMediaId", asset)} onPick={pickImage} disabled={readOnly} />
          </FormRow>
        </FormRowGroup>
        <FormRow
          label="Icon name"
          htmlFor="cat-icon-name"
          error={errors.iconName}
          hint={
            <>
              A lucide icon in kebab-case (<span className="font-mono">shopping-bag</span>) or an emoji. Used when no icon image is set.
            </>
          }
        >
          <div className="flex items-center gap-2">
            <Input
              id="cat-icon-name"
              value={values.iconName}
              onChange={(event) => set("iconName", event.target.value)}
              disabled={readOnly}
              maxLength={60}
              className="max-w-xs"
              placeholder="e.g. palette"
            />
            <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded border">
              <CategoryIconPreview iconName={values.iconName} size={16} />
            </div>
          </div>
        </FormRow>
      </FormSection>

      <FormSection title="SEO" description="Search-engine metadata for the storefront category page.">
        <FormRowGroup columns={2}>
          <FormRow label="Meta title" htmlFor="cat-meta-title" error={errors.metaTitle} hint={`${values.metaTitle.length}/160 · defaults to the name`}>
            <Input id="cat-meta-title" value={values.metaTitle} onChange={(event) => set("metaTitle", event.target.value)} disabled={readOnly} maxLength={160} />
          </FormRow>
          <FormRow label="Canonical URL" htmlFor="cat-canonical" error={errors.canonicalUrl} hint="Only when this page duplicates another URL.">
            <Input id="cat-canonical" value={values.canonicalUrl} onChange={(event) => set("canonicalUrl", event.target.value)} disabled={readOnly} placeholder="https://…" />
          </FormRow>
        </FormRowGroup>
        <FormRow label="Meta description" htmlFor="cat-meta-description" error={errors.metaDescription} hint={`${values.metaDescription.length}/320`}>
          <Textarea id="cat-meta-description" value={values.metaDescription} onChange={(event) => set("metaDescription", event.target.value)} disabled={readOnly} rows={2} maxLength={320} />
        </FormRow>
        <FormRowGroup columns={2}>
          <FormRow label="Meta keywords" htmlFor="cat-meta-keywords" error={errors.metaKeywords} hint="Comma-separated; most engines ignore these.">
            <Input id="cat-meta-keywords" value={values.metaKeywords} onChange={(event) => set("metaKeywords", event.target.value)} disabled={readOnly} maxLength={500} />
          </FormRow>
          <FormRow label="Social image (og:image)" hint="1200×630 works best.">
            <MediaField value={media.ogImageMediaId} onChange={(asset) => setAsset("ogImageMediaId", asset)} onPick={pickImage} disabled={readOnly} size={44} />
          </FormRow>
        </FormRowGroup>
        <FormRow inline label="Hide from search engines (noindex)" htmlFor="cat-noindex" hint="Also leaves the page out of the sitemap.">
          <Switch id="cat-noindex" checked={values.noIndex} onCheckedChange={(value) => set("noIndex", value)} disabled={readOnly} />
        </FormRow>

        <div className="bg-muted/40 rounded-md border p-3">
          <p className="text-muted-foreground mb-1 text-[11px] font-medium uppercase tracking-wide">Search snippet preview</p>
          <p className="truncate text-sm font-medium text-[#1a0dab] dark:text-[#8ab4f8]">{values.metaTitle || values.name || "Category title"}</p>
          <p className="truncate font-mono text-[11px] text-[#006621] dark:text-[#5fb36a]">{previewPath}</p>
          <p className="text-muted-foreground line-clamp-2 text-xs">
            {values.metaDescription || values.description || "Add a meta description to control how this page appears in results."}
          </p>
        </div>
      </FormSection>

      {canManage ? (
        <FormActions
          dirty={dirty}
          pending={pending}
          submitLabel={mode === "create" ? "Create category" : "Save changes"}
          onCancel={() => router.push("/admin/categories")}
        />
      ) : null}

      {picker.element}
    </form>
  );
}
