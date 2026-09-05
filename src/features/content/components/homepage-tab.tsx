"use client";

import * as React from "react";
import { ChevronDown, LayoutTemplate, Plus, SquarePen, Trash2 } from "lucide-react";
import { cn } from "cn";

import { EmptyState } from "@/components/shared/empty-state";
import { ProductThumb } from "@/components/shared/product-thumb";
import { StatusPill } from "@/components/shared/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { formatIstDateTime } from "@/lib/dates";
import {
  createBlock,
  deleteBlock,
  reorderBlocks,
  reorderSections,
  toggleBlock,
  toggleSection,
  updateBlock,
  updateSectionPayload,
} from "../actions";
import type { BlockRow, SectionRow } from "../queries";
import {
  blockLabel,
  emptyBlockPayload,
  payloadToFormValues,
  sectionDefinition,
  type SectionDefinition,
} from "../registry";
import {
  MoveButtons,
  PayloadEditorSheet,
  moveInList,
  useActionToast,
} from "./section-editor";

/**
 * The homepage, as the operator thinks of it: an ordered stack of sections,
 * each one switchable, each repeatable one holding its own ordered items.
 * Every row renders from the registry, so this file knows nothing about what a
 * "hero" or a "reel" actually is.
 */
export function HomepageTab({ sections }: { sections: SectionRow[] }) {
  const { pending, run } = useActionToast();

  function moveSection(index: number, direction: -1 | 1) {
    const ids = sections.map((section) => section.id);
    const next = moveInList(ids, index, index + direction);
    if (next === ids) return;
    run(() => reorderSections({ ids: next }));
  }

  if (sections.length === 0) {
    return (
      <EmptyState
        icon={LayoutTemplate}
        title="No homepage sections"
        description="Nothing has been seeded into ContentSection yet. Run npm run db:seed to import the storefront's home.json."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground border-warning/30 bg-warning-muted/40 rounded-lg border px-3 py-2 text-xs leading-relaxed">
        These sections are stored here, but the live storefront still renders
        its own static files — nothing on this tab reaches shoppers until
        <code className="bg-background/60 mx-1 rounded border px-1 py-0.5 font-mono text-[11px]">
          src/api/*.js
        </code>
        in the storefront is repointed at this admin&apos;s API.
      </p>

      <div className="surface divide-y overflow-hidden">
        {sections.map((section, index) => (
          <SectionCard
            key={section.id}
            section={section}
            pending={pending}
            canMoveUp={index > 0}
            canMoveDown={index < sections.length - 1}
            onMoveUp={() => moveSection(index, -1)}
            onMoveDown={() => moveSection(index, 1)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SectionCard({
  section,
  pending,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  section: SectionRow;
  pending: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const definition = sectionDefinition(section.type);
  const Icon = definition.icon;

  const [open, setOpen] = React.useState(false);
  const [editingSection, setEditingSection] = React.useState(false);
  const [editingBlockId, setEditingBlockId] = React.useState<string | null>(
    null,
  );
  const [creating, setCreating] = React.useState(false);
  const { pending: rowPending, run } = useActionToast();

  const busy = pending || rowPending;
  const editingBlock =
    section.blocks.find((block) => block.id === editingBlockId) ?? null;

  function moveBlock(index: number, direction: -1 | 1) {
    const ids = section.blocks.map((block) => block.id);
    const next = moveInList(ids, index, index + direction);
    if (next === ids) return;
    run(() => reorderBlocks({ sectionId: section.id, ids: next }));
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded">
          <Icon className="size-3.5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-xs font-medium">{section.title}</p>
            {!section.enabled ? (
              <StatusPill label="Off" tone="neutral" />
            ) : null}
            {definition.type === "unknown" ? (
              <StatusPill label="Unknown type" tone="warning" />
            ) : null}
          </div>
          <p className="text-muted-foreground truncate text-[11px]">
            <span className="font-mono">{section.key}</span> ·{" "}
            {definition.description}
          </p>
        </div>

        {definition.repeatable ? (
          <span
            data-numeric
            className="text-muted-foreground hidden shrink-0 text-[11px] sm:block"
          >
            {section.blocks.length} {definition.blockNoun}
            {section.blocks.length === 1 ? "" : "s"}
          </span>
        ) : null}

        <MoveButtons
          label={section.title}
          disabled={busy}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onUp={onMoveUp}
          onDown={onMoveDown}
        />

        <Switch
          checked={section.enabled}
          disabled={busy}
          aria-label={`Enable ${section.title}`}
          onCheckedChange={(checked) =>
            run(() => toggleSection({ id: section.id, enabled: checked }))
          }
        />

        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={busy || definition.type === "unknown"}
          onClick={() => setEditingSection(true)}
        >
          <SquarePen />
          Edit
        </Button>

        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={open ? "Collapse section" : "Expand section"}
          >
            <ChevronDown
              className={cn("transition-transform", open && "rotate-180")}
            />
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div className="bg-muted/30 border-t">
          {definition.repeatable ? (
            <BlockList
              section={section}
              definition={definition}
              busy={busy}
              onEdit={setEditingBlockId}
              onMove={moveBlock}
              onToggle={(id, enabled) =>
                run(() => toggleBlock({ id, enabled }))
              }
              onDelete={(id) => run(() => deleteBlock({ id }))}
              onAdd={() => setCreating(true)}
            />
          ) : (
            <SingletonSummary section={section} definition={definition} />
          )}

          <p className="text-muted-foreground border-t px-3 py-1.5 text-[11px]">
            Last changed {formatIstDateTime(section.updatedAt)}
          </p>
        </div>
      </CollapsibleContent>

      {/* Section settings ------------------------------------------------- */}
      <PayloadEditorSheet
        open={editingSection}
        onOpenChange={setEditingSection}
        title={section.title}
        description={definition.description}
        fields={definition.fields}
        payload={section.payload}
        emptyNote={
          definition.repeatable
            ? `${definition.label} has no settings of its own — edit its ${definition.blockNoun}s in the list instead.`
            : "This section has no editable settings."
        }
        onSave={(values) =>
          updateSectionPayload({ id: section.id, values })
        }
      />

      {/* Edit one block ---------------------------------------------------- */}
      {editingBlock ? (
        <BlockSheet
          key={editingBlock.id}
          definition={definition}
          block={editingBlock}
          open
          onOpenChange={(next) => {
            if (!next) setEditingBlockId(null);
          }}
        />
      ) : null}

      {/* Add a block ------------------------------------------------------- */}
      <PayloadEditorSheet
        open={creating}
        onOpenChange={setCreating}
        title={`New ${definition.blockNoun}`}
        description={`Added to the end of ${section.title}.`}
        fields={definition.blockFields}
        payload={emptyBlockPayload(definition)}
        onSave={(payload) => createBlock({ sectionId: section.id, payload })}
      />
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------

function BlockSheet({
  definition,
  block,
  open,
  onOpenChange,
}: {
  definition: SectionDefinition;
  block: BlockRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <PayloadEditorSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${definition.blockNoun}`}
      description={
        block.legacyId
          ? `Imported from the storefront as "${block.legacyId}".`
          : undefined
      }
      fields={definition.blockFields}
      payload={block.payload}
      onSave={(payload) => updateBlock({ id: block.id, payload })}
    />
  );
}

// ---------------------------------------------------------------------------

function BlockList({
  section,
  definition,
  busy,
  onEdit,
  onMove,
  onToggle,
  onDelete,
  onAdd,
}: {
  section: SectionRow;
  definition: SectionDefinition;
  busy: boolean;
  onEdit: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  const atMax = section.blocks.length >= definition.maxBlocks;

  return (
    <div>
      {section.blocks.length === 0 ? (
        <p className="text-muted-foreground px-3 py-4 text-center text-xs">
          No {definition.blockNoun}s yet.
        </p>
      ) : (
        <ul className="divide-y">
          {section.blocks.map((block, index) => (
            <li key={block.id} className="flex items-center gap-2 px-3 py-2">
              {definition.previewKey ? (
                <ProductThumb
                  src={String(block.payload[definition.previewKey] ?? "")}
                  alt={blockLabel(definition, block.payload, index)}
                  size={32}
                />
              ) : (
                <span
                  data-numeric
                  className="text-muted-foreground w-5 shrink-0 text-center text-[11px]"
                >
                  {index + 1}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-xs",
                    !block.enabled && "text-muted-foreground line-through",
                  )}
                >
                  {blockLabel(definition, block.payload, index)}
                </p>
                <p className="text-muted-foreground truncate text-[11px]">
                  {blockSubtitle(definition, block.payload)}
                </p>
              </div>

              <MoveButtons
                label={definition.blockNoun}
                disabled={busy}
                canMoveUp={index > 0}
                canMoveDown={index < section.blocks.length - 1}
                onUp={() => onMove(index, -1)}
                onDown={() => onMove(index, 1)}
              />

              <Switch
                size="sm"
                checked={block.enabled}
                disabled={busy}
                aria-label={`Show ${definition.blockNoun} ${index + 1}`}
                onCheckedChange={(checked) => onToggle(block.id, checked)}
              />

              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={busy}
                aria-label={`Edit ${definition.blockNoun} ${index + 1}`}
                onClick={() => onEdit(block.id)}
              >
                <SquarePen />
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy}
                    aria-label={`Delete ${definition.blockNoun} ${index + 1}`}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Delete this {definition.blockNoun}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {blockLabel(definition, block.payload, index)} will be
                      removed from {section.title}. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onDelete(block.id)}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        <p className="text-muted-foreground text-[11px]">
          {atMax
            ? `${definition.label} holds at most ${definition.maxBlocks}.`
            : `Up to ${definition.maxBlocks} ${definition.blockNoun}s.`}
        </p>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={busy || atMax}
          onClick={onAdd}
        >
          <Plus />
          Add {definition.blockNoun}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Singletons have no children, so the drawer shows their current settings. */
function SingletonSummary({
  section,
  definition,
}: {
  section: SectionRow;
  definition: SectionDefinition;
}) {
  if (definition.fields.length === 0) {
    return (
      <p className="text-muted-foreground px-3 py-4 text-xs">
        {definition.type === "unknown"
          ? "This section type is not in the registry, so its payload is left untouched."
          : "This section has no editable settings."}
      </p>
    );
  }

  const values = payloadToFormValues(definition.fields, section.payload);

  return (
    <dl className="divide-y">
      {definition.fields.map((field) => {
        const value = values[field.name];
        const display =
          typeof value === "boolean" ? (value ? "On" : "Off") : value;

        return (
          <div key={field.name} className="flex gap-3 px-3 py-1.5">
            <dt className="text-muted-foreground w-32 shrink-0 text-[11px]">
              {field.label}
            </dt>
            <dd className="min-w-0 flex-1 truncate text-[11px]">
              {display ? display : <span className="text-muted-foreground">—</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** The second line of a block row: the first filled field that is not the title. */
function blockSubtitle(
  definition: SectionDefinition,
  payload: Record<string, unknown>,
): string {
  for (const field of definition.blockFields) {
    if (field.name === definition.blockTitleKey) continue;
    const value = payload[field.name];
    if (typeof value === "string" && value.trim()) {
      return `${field.label}: ${value.replace(/\s+/g, " ").trim()}`;
    }
  }
  return "No other details set";
}
