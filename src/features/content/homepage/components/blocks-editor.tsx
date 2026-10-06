"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { FormRow, FormRowGroup } from "@/components/shared/form-layout";
import type { PickedAsset } from "@/components/shared/media-picker";
import { ProductThumb } from "@/components/shared/product-thumb";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { emptyBlockPayload, sectionDefinition, type SectionDefinition } from "@/features/content/registry";
import { MediaField } from "@/features/banners/components/media-field";

import { addBlockAction, deleteBlockAction, reorderBlocksAction, updateBlockAction } from "../actions";
import { fromDateTimeLocal, toDateTimeLocal } from "../datetime";
import type { BlockEditorRow, BlockInput } from "../schemas";
import { SCHEDULE_STATE_META } from "./schedule-state";
import { SectionForm, fieldStateToPayload, initialFieldState, type FieldState } from "./section-form";

/**
 * Items of a repeatable section (trust_badges, announcement_bar): an ordered
 * sortable list with enable / edit / delete, and one dialog for add + edit.
 * Each block is saved on its own the moment the dialog is confirmed - blocks
 * are rows, not a JSON array on the section, so the save is per row and the
 * page refresh re-reads them.
 */

const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

type BlockDraft = {
  fields: FieldState;
  media: PickedAsset | null;
  enabled: boolean;
  publishAt: string;
  unpublishAt: string;
};

function draftFrom(definition: SectionDefinition, block: BlockEditorRow | null): BlockDraft {
  return {
    fields: initialFieldState(definition.blockFields, block?.payload ?? emptyBlockPayload(definition)),
    media: block?.media ?? null,
    enabled: block?.enabled ?? true,
    publishAt: toDateTimeLocal(block?.publishAt),
    unpublishAt: toDateTimeLocal(block?.unpublishAt),
  };
}

function toInput(definition: SectionDefinition, draft: BlockDraft): BlockInput {
  return {
    payload: fieldStateToPayload(definition.blockFields, draft.fields),
    enabled: draft.enabled,
    publishAt: fromDateTimeLocal(draft.publishAt),
    unpublishAt: fromDateTimeLocal(draft.unpublishAt),
    mediaId: draft.media?.id ?? null,
  };
}

function SortableBlock({ id, disabled, children }: { id: string; disabled: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("flex items-center gap-2 px-2 py-2", isDragging && "bg-muted relative z-10 rounded-md shadow")}>
      {!disabled ? (
        <button ref={setActivatorNodeRef} type="button" className="text-muted-foreground hover:text-foreground cursor-grab touch-none px-0.5 active:cursor-grabbing" aria-label="Drag to reorder" {...attributes} {...listeners}>
          <GripVertical className="size-4" />
        </button>
      ) : null}
      {children}
    </li>
  );
}

export function BlocksEditor({
  sectionId,
  type,
  blocks,
  canManage,
  pickMedia,
  pickImage,
}: {
  sectionId: string;
  type: string;
  blocks: BlockEditorRow[];
  canManage: boolean;
  pickMedia: (title?: string) => Promise<PickedAsset | null>;
  pickImage: () => Promise<{ url: string; alt?: string } | null>;
}) {
  const router = useRouter();
  const definition = sectionDefinition(type);
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [order, setOrder] = React.useState(blocks.map((block) => block.id));
  const [prevBlocks, setPrevBlocks] = React.useState(blocks);
  if (blocks !== prevBlocks) {
    setPrevBlocks(blocks);
    setOrder(blocks.map((block) => block.id));
  }
  const [editing, setEditing] = React.useState<{ block: BlockEditorRow | null; draft: BlockDraft } | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const byId = new Map(blocks.map((block) => [block.id, block]));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const atMax = blocks.length >= definition.maxBlocks;

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(order, from, to);
    setOrder(next);
    const result = await run(() => reorderBlocksAction(sectionId, next), { silent: true });
    if (!result.ok) setOrder(blocks.map((block) => block.id));
    else router.refresh();
  }

  async function save() {
    if (!editing) return;
    setErrors({});
    const input = toInput(definition, editing.draft);
    const result = await run(() => (editing.block ? updateBlockAction(sectionId, editing.block.id, input) : addBlockAction(sectionId, input)), {
      onError: (failed) => setErrors(failed.fieldErrors ?? {}),
    });
    if (result.ok) {
      setEditing(null);
      router.refresh();
    }
  }

  async function toggle(block: BlockEditorRow, enabled: boolean) {
    const result = await run(() =>
      updateBlockAction(sectionId, block.id, {
        payload: block.payload,
        enabled,
        publishAt: block.publishAt,
        unpublishAt: block.unpublishAt,
        mediaId: block.media?.id ?? null,
      }),
    );
    if (result.ok) router.refresh();
  }

  async function remove(block: BlockEditorRow) {
    const answer = await confirm({
      title: `Remove this ${definition.blockNoun}?`,
      description: `"${block.label}" disappears from the storefront as soon as the cache refreshes.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!answer.ok) return;
    const result = await run(() => deleteBlockAction(sectionId, block.id));
    if (result.ok) router.refresh();
  }

  const noun = definition.blockNoun;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {blocks.length} of {definition.maxBlocks} {noun}s{definition.minBlocks > 0 && blocks.length < definition.minBlocks ? ` · at least ${definition.minBlocks} needed for the section to show anything` : ""}
        </p>
        {canManage ? (
          <Button size="sm" variant="outline" disabled={atMax || pending} onClick={() => setEditing({ block: null, draft: draftFrom(definition, null) })}>
            <Plus /> Add {noun}
          </Button>
        ) : null}
      </div>

      {blocks.length === 0 ? (
        <EmptyState compact icon={definition.icon} title={`No ${noun}s yet`} description={`Each ${noun} becomes one item in the storefront's ${definition.label.toLowerCase()}.`} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ul className="divide-y rounded-md border">
              {order.map((id) => {
                const block = byId.get(id);
                if (!block) return null;
                const state = SCHEDULE_STATE_META[block.state];
                return (
                  <SortableBlock key={id} id={id} disabled={!canManage || pending}>
                    {block.media ? <ProductThumb src={block.media.thumbnailUrl ?? block.media.url} alt="" size={32} className="rounded" /> : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{block.label}</p>
                      <div className="flex items-center gap-2">
                        <StatusPill label={state.label} tone={state.tone} />
                      </div>
                    </div>
                    <Switch size="sm" checked={block.enabled} disabled={!canManage || pending} onCheckedChange={(value) => toggle(block, value)} aria-label={`${block.enabled ? "Disable" : "Enable"} ${block.label}`} />
                    <Button variant="ghost" size="icon-xs" aria-label={`Edit ${block.label}`} onClick={() => setEditing({ block, draft: draftFrom(definition, block) })}>
                      <Pencil />
                    </Button>
                    {canManage ? (
                      <Button variant="ghost" size="icon-xs" aria-label={`Remove ${block.label}`} disabled={pending} onClick={() => remove(block)}>
                        <Trash2 className="text-destructive" />
                      </Button>
                    ) : null}
                  </SortableBlock>
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.block ? `Edit ${noun}` : `New ${noun}`}</DialogTitle>
            <DialogDescription>{definition.description}</DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="space-y-4">
              <SectionForm fields={definition.blockFields} state={editing.draft.fields} onChange={(fields) => setEditing({ ...editing, draft: { ...editing.draft, fields } })} errors={errors} disabled={!canManage} idPrefix="block" pickMedia={pickMedia} pickImage={pickImage} />
              <FormRow label="Image" htmlFor="block-media" hint="Optional artwork for this item; sent to the storefront as `image`.">
                <MediaField value={editing.draft.media} onChange={(media) => setEditing({ ...editing, draft: { ...editing.draft, media } })} onPick={() => pickMedia(`Choose ${noun} image`)} disabled={!canManage} />
              </FormRow>
              <FormRow label="Enabled" htmlFor="block-enabled" inline hint="Disabled items stay here but are not sent to the website.">
                <Switch id="block-enabled" checked={editing.draft.enabled} onCheckedChange={(enabled) => setEditing({ ...editing, draft: { ...editing.draft, enabled } })} disabled={!canManage} />
              </FormRow>
              <FormRowGroup columns={2}>
                <FormRow label="Publish from" htmlFor="block-publish" error={errors.publishAt} hint="Blank = immediately.">
                  <Input id="block-publish" type="datetime-local" value={editing.draft.publishAt} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, publishAt: event.target.value } })} disabled={!canManage} />
                </FormRow>
                <FormRow label="Unpublish at" htmlFor="block-unpublish" error={errors.unpublishAt} hint="Blank = never.">
                  <Input id="block-unpublish" type="datetime-local" value={editing.draft.unpublishAt} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, unpublishAt: event.target.value } })} disabled={!canManage} min={editing.draft.publishAt || undefined} />
                </FormRow>
              </FormRowGroup>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            {canManage ? (
              <Button onClick={save} disabled={pending}>
                {editing?.block ? "Save item" : `Add ${noun}`}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  );
}
