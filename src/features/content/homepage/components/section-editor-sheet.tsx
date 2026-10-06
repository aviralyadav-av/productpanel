"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { LINK_TYPES, LINK_TYPE_META, type LinkType } from "@/lib/enums";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EntityPicker, type EntityKind as PickerKind, type EntityRef } from "@/components/shared/entity-picker";
import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import { useMediaPicker, type PickedAsset } from "@/components/shared/media-picker";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { useQueryNav } from "@/hooks/use-query-nav";
import { sectionDefinition } from "@/features/content/registry";
import { MediaField } from "@/features/banners/components/media-field";

import { updateSectionAction } from "../actions";
import { fromDateTimeLocal, toDateTimeLocal } from "../datetime";
import type { SectionEditorData, SectionUpdateInput } from "../schemas";
import { BlocksEditor } from "./blocks-editor";
import { SCHEDULE_STATE_META } from "./schedule-state";
import { SectionForm, fieldStateToPayload, initialFieldState, type FieldState } from "./section-form";

/**
 * The section editor: a Sheet opened by `?section=<id>` (URL state, so a link
 * to "this section's editor" can be shared and Back closes it). Three panes:
 * Settings (common columns + the registry's fields), Items (repeatable types)
 * and Preview (rendered server-side, handed in as a node). Saving writes the
 * common columns and the payload in one action; blocks save on their own.
 */

type CommonDraft = {
  title: string;
  subtitle: string;
  enabled: boolean;
  publishAt: string;
  unpublishAt: string;
  image: PickedAsset | null;
  linkType: LinkType;
  linkUrl: string;
  linkTarget: EntityRef | null;
  buttonText: string;
};

function commonFrom(section: SectionEditorData): CommonDraft {
  return {
    title: section.title,
    subtitle: section.subtitle ?? "",
    enabled: section.enabled,
    publishAt: toDateTimeLocal(section.publishAt),
    unpublishAt: toDateTimeLocal(section.unpublishAt),
    image: section.image,
    linkType: section.linkType,
    linkUrl: section.linkType === "URL" ? (section.linkUrl ?? "") : "",
    linkTarget: section.linkTarget,
    buttonText: section.buttonText ?? "",
  };
}

function linkKind(linkType: LinkType): PickerKind | null {
  switch (linkType) {
    case "CATEGORY":
      return "category";
    case "PRODUCT":
      return "product";
    case "PAGE":
      return "page";
    case "BLOG":
      return "blog";
    default:
      return null;
  }
}

export type EditorPane = "settings" | "items" | "preview";

export function SectionEditorSheet({
  section,
  canManage,
  pane,
  preview,
}: {
  section: SectionEditorData;
  canManage: boolean;
  pane: EditorPane;
  /** Server-rendered <SectionPreview>; re-rendered on every router.refresh(). */
  preview: React.ReactNode;
}) {
  const router = useRouter();
  const { navigate } = useQueryNav();
  const { pending, run } = useActionToast();
  const picker = useMediaPicker();
  const definition = sectionDefinition(section.type);
  const state = SCHEDULE_STATE_META[section.state];

  const [common, setCommon] = React.useState<CommonDraft>(() => commonFrom(section));
  const [fields, setFields] = React.useState<FieldState>(() => initialFieldState(definition.fields, section.payload, section.refs, section.media));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);

  // Server data changed (another save, a block edit): re-seed the draft.
  const [seed, setSeed] = React.useState(section.updatedAt);
  if (seed !== section.updatedAt) {
    setSeed(section.updatedAt);
    setCommon(commonFrom(section));
    setFields(initialFieldState(definition.fields, section.payload, section.refs, section.media));
    setDirty(false);
  }

  const set = <K extends keyof CommonDraft>(key: K, value: CommonDraft[K]) => {
    setCommon((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const pickMedia = React.useCallback(
    async (title = "Choose an image") => {
      const picked = await picker.open({ accept: "image", multiple: false, title });
      return picked?.[0] ?? null;
    },
    [picker],
  );

  const close = () => navigate({ section: null, pane: null });
  const tab = pane === "items" && !definition.repeatable ? "settings" : pane;

  async function save() {
    setErrors({});
    const input: SectionUpdateInput = {
      common: {
        title: common.title,
        subtitle: common.subtitle,
        enabled: common.enabled,
        publishAt: fromDateTimeLocal(common.publishAt),
        unpublishAt: fromDateTimeLocal(common.unpublishAt),
        imageMediaId: common.image?.id ?? null,
        linkType: definition.supportsLink ? common.linkType : "NONE",
        linkUrl: common.linkType === "URL" ? common.linkUrl : null,
        linkTargetId: linkKind(common.linkType) ? (common.linkTarget?.id ?? null) : null,
        buttonText: common.buttonText,
      },
      payload: fieldStateToPayload(definition.fields, fields),
    };
    const result = await run(() => updateSectionAction(section.id, input), {
      onError: (failed) => {
        const flat: Record<string, string> = {};
        for (const [key, message] of Object.entries(failed.fieldErrors ?? {})) flat[key.replace(/^common\./, "")] = message;
        setErrors(flat);
      },
    });
    if (result.ok) {
      setDirty(false);
      router.refresh();
    }
  }

  const readOnly = !canManage;
  const targetKind = linkKind(common.linkType);
  const Icon = definition.icon;

  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="pb-0">
          <div className="flex items-center gap-2">
            <span className="bg-muted flex size-7 items-center justify-center rounded-md">
              <Icon className="size-4" />
            </span>
            <SheetTitle className="truncate">{section.title}</SheetTitle>
            <StatusPill label={state.label} tone={state.tone} />
          </div>
          <SheetDescription>
            {definition.label} · <code className="font-mono text-[11px]">{section.key}</code>
            {definition.description ? ` — ${definition.description}` : ""}
          </SheetDescription>
        </SheetHeader>

        <Tabs value={tab} onValueChange={(value) => navigate({ pane: value === "settings" ? null : value })} className="px-4 pb-6">
          <TabsList>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            {definition.repeatable ? <TabsTrigger value="items">Items ({section.blocks.length})</TabsTrigger> : null}
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-6 pt-4">
            <FormSection title="Section" description="How the section is titled and when it shows.">
              <FormRow label="Title" htmlFor="section-title" required error={errors.title}>
                <Input id="section-title" value={common.title} onChange={(event) => set("title", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.title) || undefined} />
              </FormRow>
              <FormRow label="Subtitle" htmlFor="section-subtitle" error={errors.subtitle}>
                <Textarea id="section-subtitle" rows={2} value={common.subtitle} onChange={(event) => set("subtitle", event.target.value)} disabled={readOnly} />
              </FormRow>
              <FormRow label="Enabled" htmlFor="section-enabled" inline hint={state.description}>
                <Switch id="section-enabled" checked={common.enabled} onCheckedChange={(value) => set("enabled", value)} disabled={readOnly} />
              </FormRow>
              <FormRowGroup columns={2}>
                <FormRow label="Publish from" htmlFor="section-publish" error={errors.publishAt} hint="Blank = immediately.">
                  <Input id="section-publish" type="datetime-local" value={common.publishAt} onChange={(event) => set("publishAt", event.target.value)} disabled={readOnly} />
                </FormRow>
                <FormRow label="Unpublish at" htmlFor="section-unpublish" error={errors.unpublishAt} hint="Blank = never expires.">
                  <Input id="section-unpublish" type="datetime-local" value={common.unpublishAt} onChange={(event) => set("unpublishAt", event.target.value)} disabled={readOnly} min={common.publishAt || undefined} />
                </FormRow>
              </FormRowGroup>
              <FormRow label="Image" htmlFor="section-image" error={errors.imageMediaId} hint="Optional section artwork, sent as `image`.">
                <MediaField value={common.image} onChange={(asset) => set("image", asset)} onPick={() => pickMedia("Choose the section image")} disabled={readOnly} />
              </FormRow>
            </FormSection>

            {definition.supportsLink ? (
              <FormSection title="Call to action" description="The 'view all' link the storefront renders next to the title.">
                <FormRowGroup columns={2}>
                  <FormRow label="Link type" htmlFor="section-link-type">
                    <Select value={common.linkType} onValueChange={(value) => { set("linkType", value as LinkType); set("linkTarget", null); }} disabled={readOnly}>
                      <SelectTrigger id="section-link-type" className="w-full">
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
                  <FormRow label="Button label" htmlFor="section-button" error={errors.buttonText}>
                    <Input id="section-button" value={common.buttonText} onChange={(event) => set("buttonText", event.target.value)} placeholder="View all" disabled={readOnly} />
                  </FormRow>
                </FormRowGroup>
                {common.linkType === "URL" ? (
                  <FormRow label="Link URL" htmlFor="section-link-url" required error={errors.linkUrl} hint="https://… or a site path like /new">
                    <Input id="section-link-url" value={common.linkUrl} onChange={(event) => set("linkUrl", event.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.linkUrl) || undefined} />
                  </FormRow>
                ) : null}
                {targetKind ? (
                  <FormRow label={`Link ${LINK_TYPE_META[common.linkType].label.toLowerCase()}`} htmlFor="section-link-target" required error={errors.linkTargetId}>
                    <EntityPicker id="section-link-target" kind={targetKind} value={common.linkTarget} onChange={(ref) => set("linkTarget", ref)} disabled={readOnly} invalid={Boolean(errors.linkTargetId)} placeholder={`Choose a ${targetKind}`} />
                  </FormRow>
                ) : null}
              </FormSection>
            ) : null}

            {definition.fields.length > 0 ? (
              <FormSection title={`${definition.label} settings`} description="Type-specific options. Sent to the website as `settings`.">
                <SectionForm fields={definition.fields} state={fields} onChange={(next) => { setFields(next); setDirty(true); }} errors={errors} disabled={readOnly} idPrefix="section" pickMedia={pickMedia} pickImage={picker.pickImage} />
              </FormSection>
            ) : null}

            {canManage ? <FormActions dirty={dirty} pending={pending} onSubmit={save} onCancel={close} submitLabel="Save section" /> : null}
          </TabsContent>

          {definition.repeatable ? (
            <TabsContent value="items" className="pt-4">
              <BlocksEditor sectionId={section.id} type={section.type} blocks={section.blocks} canManage={canManage} pickMedia={pickMedia} pickImage={picker.pickImage} />
            </TabsContent>
          ) : null}

          <TabsContent value="preview" className="pt-4">
            {preview}
          </TabsContent>
        </Tabs>
        {picker.element}
      </SheetContent>
    </Sheet>
  );
}
