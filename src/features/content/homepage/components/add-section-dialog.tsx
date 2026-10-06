"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "cn";

import { BANNER_PLACEMENT_META, CONTENT_SECTION_TYPES, type BannerPlacement, type ContentSectionType } from "@/lib/enums";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useActionToast } from "@/components/shared/use-action-toast";
import { useQueryNav } from "@/hooks/use-query-nav";
import { SECTION_REGISTRY, type SectionDefinition } from "@/features/content/registry";

import { createSectionAction } from "../actions";

/**
 * "Add section": every registry type with its description and where its items
 * come from - a Banner placement, a catalog rule, or the section's own items -
 * so the operator picks the right building block instead of guessing from a
 * name. Creating opens the editor straight away (the row starts disabled).
 */

function feedNote(definition: SectionDefinition): string {
  const defaults = definition.sectionSchema.safeParse({});
  const payload = defaults.success ? defaults.data : {};
  switch (definition.resolver) {
    case "banners": {
      const placement = typeof payload.placement === "string" ? payload.placement : "HOME_HERO";
      return `Fed by Banners → ${BANNER_PLACEMENT_META[placement as BannerPlacement]?.label ?? placement}`;
    }
    case "categories":
      return "Fed by Categories (Featured flag or a picked list)";
    case "products":
      return "Fed by Products (rule or a picked list)";
    case "collection":
      return "Fed by picked products, a category and/or a tag";
    case "sellers":
      return "Fed by Sellers (rating or a picked list)";
    case "testimonials":
      return "Fed by approved reviews flagged Testimonial";
    case "featuredReviews":
      return "Fed by approved reviews flagged Featured";
    case "blocks":
      return `Holds its own ${definition.blockNoun}s (${definition.minBlocks}–${definition.maxBlocks})`;
    case "footer":
      return "Fed by the Footer tab and menus footer-1..3";
    case "stored":
    default:
      return "Content is entered on the section itself";
  }
}

export function AddSectionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { navigate } = useQueryNav();
  const { pending, run } = useActionToast();
  const [busy, setBusy] = React.useState<ContentSectionType | null>(null);

  async function create(type: ContentSectionType) {
    setBusy(type);
    const result = await run(() => createSectionAction({ type }));
    setBusy(null);
    if (result.ok) {
      onOpenChange(false);
      router.refresh();
      navigate({ section: result.data.id, pane: null });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a homepage section</DialogTitle>
          <DialogDescription>New sections land at the bottom, disabled, so you can fill them in before they go live.</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2 sm:grid-cols-2">
          {CONTENT_SECTION_TYPES.map((type) => {
            const definition = SECTION_REGISTRY[type];
            const Icon = definition.icon;
            return (
              <li key={type}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => create(type)}
                  className={cn(
                    "hover:bg-muted focus-visible:ring-ring flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60",
                    busy === type && "bg-muted",
                  )}
                >
                  <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 space-y-0.5">
                    <span className="block text-sm font-medium">{definition.label}</span>
                    <span className="text-muted-foreground block text-xs leading-relaxed">{definition.description}</span>
                    <span className="text-brand block text-[11px]">{feedNote(definition)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
