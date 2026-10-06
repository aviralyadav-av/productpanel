"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormRow } from "@/components/shared/form-layout";
import { SlugInput } from "@/components/shared/slug-input";
import { useActionToast } from "@/components/shared/use-action-toast";
import { useQueryNav } from "@/hooks/use-query-nav";

import { createMenuAction, updateMenuAction } from "../actions";
import type { MenuSummary } from "../schemas";

/**
 * Create a custom menu, or rename an existing one. The SLUG is deliberately
 * frozen after creation: the storefront asks for a menu by slug
 * (`GET /api/v1/navigation/:slug`), so changing it would silently empty a
 * region of the website.
 */

export type MenuDialogTarget = { mode: "create" } | { mode: "edit"; menu: MenuSummary };

export function MenuDialog({
  target,
  onOpenChange,
}: {
  target: MenuDialogTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { navigate } = useQueryNav();
  const { pending, run } = useActionToast();
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const key = target ? (target.mode === "create" ? "create" : `edit:${target.menu.id}`) : null;
  const [seed, setSeed] = React.useState<string | null>(null);
  if (key !== seed) {
    setSeed(key);
    setName(target && target.mode === "edit" ? target.menu.name : "");
    setSlug(target && target.mode === "edit" ? target.menu.slug : "");
    setDescription(target && target.mode === "edit" ? (target.menu.description ?? "") : "");
    setErrors({});
  }

  if (!target) return null;
  const active = target;

  async function save() {
    setErrors({});
    const result = await run(
      () =>
        active.mode === "edit"
          ? updateMenuAction(active.menu.id, { name, description })
          : createMenuAction({ slug, name, description }),
      { onError: (failed) => setErrors(failed.fieldErrors ?? {}) },
    );
    if (result.ok) {
      onOpenChange(false);
      router.refresh();
      if (active.mode === "create") navigate({ menu: result.data.slug });
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{active.mode === "edit" ? `Rename "${active.menu.name}"` : "New menu"}</DialogTitle>
          <DialogDescription>
            {active.mode === "edit"
              ? "The slug is what the website asks for, so it stays as it is."
              : "A custom menu the website can fetch by slug, for a region the five built-in menus do not cover."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FormRow label="Name" htmlFor="menu-name" required error={errors.name}>
            <Input id="menu-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus aria-invalid={Boolean(errors.name) || undefined} />
          </FormRow>
          {active.mode === "create" ? (
            <FormRow label="Slug" htmlFor="menu-slug" required error={errors.slug} hint="Used in GET /api/v1/navigation/<slug>. It cannot be changed later.">
              <SlugInput id="menu-slug" sourceValue={name} value={slug} onChange={setSlug} disabled={pending} invalid={Boolean(errors.slug)} />
            </FormRow>
          ) : (
            <FormRow label="Slug" hint="Fixed for the life of the menu.">
              <code className="text-muted-foreground font-mono text-xs">{active.menu.slug}</code>
            </FormRow>
          )}
          <FormRow label="Description" htmlFor="menu-description" error={errors.description} hint="A note for whoever edits this next.">
            <Textarea id="menu-description" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
          </FormRow>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {active.mode === "edit" ? "Save menu" : "Create menu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
