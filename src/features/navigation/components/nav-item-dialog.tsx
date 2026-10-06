"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { NAVIGATION_ITEM_TYPES, NAVIGATION_ITEM_TYPE_META, type NavigationItemType } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { FormRow, FormRowGroup } from "@/components/shared/form-layout";
import { useActionToast } from "@/components/shared/use-action-toast";

import { createItemAction, updateItemAction } from "../actions";
import type { ItemInput, NavItemEditorData, NavTreeRow } from "../schemas";

/**
 * The item editor. Which target control appears is driven by `type`, and the
 * unused targets are deliberately KEPT in the draft while the dialog is open
 * so flipping CATEGORY → PRODUCT → CATEGORY does not lose the first pick; only
 * the column the chosen type needs is sent (the service clears the rest).
 *
 * `isMegaMenu` is offered only on a top-level item, because that is the only
 * place the storefront renders a mega panel.
 */

export type ItemDialogTarget =
  | { mode: "create"; menuId: string; parentId: string | null; parentLabel: string | null }
  | { mode: "edit"; item: NavItemEditorData; row: NavTreeRow; depth: number };

type Draft = {
  label: string;
  type: NavigationItemType;
  url: string;
  category: EntityRef | null;
  product: EntityRef | null;
  page: EntityRef | null;
  blogPost: EntityRef | null;
  iconName: string;
  badgeText: string;
  openInNewTab: boolean;
  isMegaMenu: boolean;
  isActive: boolean;
};

const EMPTY: Draft = {
  label: "",
  type: "URL",
  url: "",
  category: null,
  product: null,
  page: null,
  blogPost: null,
  iconName: "",
  badgeText: "",
  openInNewTab: false,
  isMegaMenu: false,
  isActive: true,
};

function draftFrom(target: ItemDialogTarget): Draft {
  if (target.mode === "create") return { ...EMPTY };
  const { item, row } = target;
  return {
    label: item.label,
    type: item.type,
    url: item.type === "URL" || (item.type === "BLOG" && !item.blogPost) ? (item.url ?? "") : "",
    category: item.category,
    product: item.product,
    page: item.page,
    blogPost: item.blogPost,
    iconName: item.iconName ?? "",
    badgeText: item.badgeText ?? "",
    openInNewTab: item.openInNewTab,
    isMegaMenu: item.isMegaMenu,
    isActive: row.isActive,
  };
}


const TYPE_HINT: Record<NavigationItemType, string> = {
  CATEGORY: "Resolves to /c/<category-path> and follows the category if it is renamed.",
  PRODUCT: "Resolves to /p/<product-slug>. Hidden by the website while the product is unpublished.",
  PAGE: "Resolves to /pages/<slug> of a CMS page.",
  BLOG: "Pick a post (resolves to /blog/<slug>) or leave it empty to link the blog index.",
  URL: "Any http(s) address, or a site path like /sale.",
  HOME: "The storefront home page.",
};

export function NavItemDialog({
  target,
  onOpenChange,
  canManage,
}: {
  target: ItemDialogTarget | null;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // Re-seed whenever a different row opens the dialog.
  const key = target ? (target.mode === "create" ? `new:${target.parentId ?? "root"}` : `edit:${target.item.id}`) : null;
  const [seed, setSeed] = React.useState<string | null>(null);
  if (key !== seed) {
    setSeed(key);
    setDraft(target ? draftFrom(target) : EMPTY);
    setErrors({});
  }

  if (!target) return null;
  const active = target;

  const depth = target.mode === "edit" ? target.depth : target.parentId ? 1 : 0;
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft((current) => ({ ...current, [field]: value }));
  const readOnly = !canManage;

  function toInput(): ItemInput {
    return {
      menuId: active.mode === "create" ? active.menuId : active.item.menuId,
      parentId: active.mode === "create" ? active.parentId : active.item.parentId,
      label: draft.label,
      type: draft.type,
      url: draft.type === "URL" || draft.type === "BLOG" ? draft.url : null,
      categoryId: draft.category?.id ?? null,
      productId: draft.product?.id ?? null,
      pageId: draft.page?.id ?? null,
      blogPostId: draft.type === "BLOG" ? (draft.blogPost?.id ?? null) : null,
      iconName: draft.iconName,
      badgeText: draft.badgeText,
      openInNewTab: draft.openInNewTab,
      isMegaMenu: depth === 0 ? draft.isMegaMenu : false,
      isActive: draft.isActive,
    };
  }

  async function save() {
    setErrors({});
    const input = toInput();
    const result = await run(() => (active.mode === "edit" ? updateItemAction(active.item.id, input) : createItemAction(input)), {
      onError: (failed) => setErrors(failed.fieldErrors ?? {}),
    });
    if (result.ok) {
      onOpenChange(false);
      router.refresh();
    }
  }

  const title =
    target.mode === "edit"
      ? `Edit "${target.item.label}"`
      : target.parentLabel
        ? `New link under "${target.parentLabel}"`
        : "New menu link";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{TYPE_HINT[draft.type]}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FormRow label="Label" htmlFor="nav-label" required error={errors.label} hint="What shoppers read in the menu.">
            <Input
              id="nav-label"
              value={draft.label}
              onChange={(event) => set("label", event.target.value)}
              disabled={readOnly}
              aria-invalid={Boolean(errors.label) || undefined}
              autoFocus
            />
          </FormRow>

          <FormRow label="Links to" htmlFor="nav-type" error={errors.type}>
            <Select value={draft.type} onValueChange={(value) => set("type", value as NavigationItemType)} disabled={readOnly}>
              <SelectTrigger id="nav-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NAVIGATION_ITEM_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {NAVIGATION_ITEM_TYPE_META[type].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>

          {draft.type === "CATEGORY" ? (
            <FormRow label="Category" htmlFor="nav-category" required error={errors.categoryId}>
              <EntityPicker id="nav-category" kind="category" value={draft.category} onChange={(ref) => set("category", ref)} disabled={readOnly} invalid={Boolean(errors.categoryId)} placeholder="Choose a category" />
            </FormRow>
          ) : null}

          {draft.type === "PRODUCT" ? (
            <FormRow label="Product" htmlFor="nav-product" required error={errors.productId}>
              <EntityPicker id="nav-product" kind="product" value={draft.product} onChange={(ref) => set("product", ref)} disabled={readOnly} invalid={Boolean(errors.productId)} placeholder="Choose a product" />
            </FormRow>
          ) : null}

          {draft.type === "PAGE" ? (
            <FormRow label="Page" htmlFor="nav-page" required error={errors.pageId}>
              <EntityPicker id="nav-page" kind="page" value={draft.page} onChange={(ref) => set("page", ref)} disabled={readOnly} invalid={Boolean(errors.pageId)} placeholder="Choose a page" />
            </FormRow>
          ) : null}

          {draft.type === "BLOG" ? (
            <>
              <FormRow label="Blog post" htmlFor="nav-blog" error={errors.blogPostId} hint="Leave empty to link the blog index instead.">
                <EntityPicker id="nav-blog" kind="blog" value={draft.blogPost} onChange={(ref) => set("blogPost", ref)} disabled={readOnly} placeholder="Choose a post (optional)" />
              </FormRow>
              {!draft.blogPost ? (
                <FormRow label="Or a post slug" htmlFor="nav-blog-slug" error={errors.url} hint="Stored as-is; blank links /blog.">
                  <Input id="nav-blog-slug" value={draft.url} onChange={(event) => set("url", event.target.value)} placeholder="diwali-gifting-guide" disabled={readOnly} className="font-mono" aria-invalid={Boolean(errors.url) || undefined} />
                </FormRow>
              ) : null}
            </>
          ) : null}

          {draft.type === "URL" ? (
            <FormRow label="URL" htmlFor="nav-url" required error={errors.url} hint="https://… or a site path like /sale.">
              <Input id="nav-url" value={draft.url} onChange={(event) => set("url", event.target.value)} placeholder="/sale" disabled={readOnly} aria-invalid={Boolean(errors.url) || undefined} />
            </FormRow>
          ) : null}

          <FormRowGroup columns={2}>
            <FormRow label="Icon name" htmlFor="nav-icon" error={errors.iconName} hint="A lucide icon name, e.g. sparkles.">
              <Input id="nav-icon" value={draft.iconName} onChange={(event) => set("iconName", event.target.value)} placeholder="sparkles" disabled={readOnly} />
            </FormRow>
            <FormRow label="Badge text" htmlFor="nav-badge" error={errors.badgeText} hint="Small ribbon: New, Sale…">
              <Input id="nav-badge" value={draft.badgeText} onChange={(event) => set("badgeText", event.target.value)} placeholder="New" disabled={readOnly} />
            </FormRow>
          </FormRowGroup>

          <FormRow label="Open in a new tab" htmlFor="nav-newtab" inline>
            <Switch id="nav-newtab" checked={draft.openInNewTab} onCheckedChange={(value) => set("openInNewTab", value)} disabled={readOnly} />
          </FormRow>

          {depth === 0 ? (
            <FormRow label="Mega menu" htmlFor="nav-mega" inline hint="The website renders this entry's children as a wide panel instead of a dropdown.">
              <Switch id="nav-mega" checked={draft.isMegaMenu} onCheckedChange={(value) => set("isMegaMenu", value)} disabled={readOnly} />
            </FormRow>
          ) : null}

          <FormRow label="Visible" htmlFor="nav-active" inline hint="Hidden items stay here but are left out of the public menu.">
            <Switch id="nav-active" checked={draft.isActive} onCheckedChange={(value) => set("isActive", value)} disabled={readOnly} />
          </FormRow>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          {canManage ? (
            <Button onClick={save} disabled={pending}>
              {target.mode === "edit" ? "Save link" : "Add link"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
