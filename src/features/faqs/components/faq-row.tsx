"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Star, Trash2, X } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useActionToast } from "@/components/shared/use-action-toast";
import { htmlToText } from "@/features/pages/text";

import { setFaqFlagAction, updateFaqAction } from "../actions";
import { checkFaqDraft, toFaqDraft, type FaqDraft } from "../draft";
import type { FaqRow } from "../schemas";
import { FaqFields } from "./faq-fields";

/**
 * One question on the board: a compact row that expands into the full editor
 * in place. Editing a FAQ is a two-field change ninety percent of the time,
 * so a route change would be pure overhead; the row keeps its position in the
 * list while it is open, which is the context the operator needs.
 *
 * The enabled switch and the featured star write immediately (one audited
 * action each) - they are toggles, not form fields, and an operator hiding a
 * wrong answer should not have to find a Save button.
 */
export function FaqSortableRow({
  row,
  groups,
  canManage,
  dragDisabled,
  editing,
  onEditingChange,
  onDelete,
}: {
  row: FaqRow;
  groups: string[];
  canManage: boolean;
  /** True while a filter is narrowing the list: a partial order must not be saved. */
  dragDisabled: boolean;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onDelete: (row: FaqRow) => void;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: !canManage || dragDisabled || editing,
  });

  const [draft, setDraft] = React.useState<FaqDraft>(() => toFaqDraft(row));
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!editing) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opening the editor re-seeds from the server row
    setDraft(toFaqDraft(row));
    setErrors({});
  }, [editing, row]);

  function patch(changes: Partial<FaqDraft>) {
    setDraft((current) => ({ ...current, ...changes }));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(changes)) delete next[key];
      return next;
    });
  }

  async function save() {
    const checked = checkFaqDraft(draft);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    const result = await run(() => updateFaqAction(row.id, checked.input), {
      onSuccess: () => {
        onEditingChange(false);
        router.refresh();
      },
    });
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  async function toggle(flag: "enabled" | "isFeatured", value: boolean) {
    await run(() => setFaqFlagAction(row.id, flag, value), { onSuccess: () => router.refresh() });
  }

  const excerpt = htmlToText(row.answer);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("bg-card px-3 py-2.5", isDragging && "ring-brand/40 relative z-10 rounded-md ring-2", !row.enabled && !editing && "opacity-70")}
    >
      <div className="flex items-start gap-2">
        {canManage ? (
          <button
            ref={setActivatorNodeRef}
            type="button"
            className={cn("text-muted-foreground hover:text-foreground mt-0.5 flex items-center px-0.5", dragDisabled || editing ? "cursor-not-allowed opacity-40" : "cursor-grab touch-none active:cursor-grabbing")}
            aria-label={dragDisabled ? "Clear the filters to reorder" : `Drag to reorder ${row.question}`}
            disabled={dragDisabled || editing}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {row.isFeatured ? <Star className="text-warning size-3 shrink-0 fill-current" aria-label="Featured" /> : null}
            <span className="text-sm font-medium">{row.question}</span>
          </div>
          {!editing && excerpt ? <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-relaxed">{excerpt}</p> : null}
        </div>

        {canManage ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={row.isFeatured ? `Unfeature ${row.question}` : `Feature ${row.question}`}
              aria-pressed={row.isFeatured}
              disabled={pending}
              onClick={() => void toggle("isFeatured", !row.isFeatured)}
            >
              <Star className={cn(row.isFeatured && "text-warning fill-current")} />
            </Button>
            <Switch
              checked={row.enabled}
              onCheckedChange={(enabled) => void toggle("enabled", enabled)}
              disabled={pending}
              aria-label={row.enabled ? `Hide ${row.question} from the storefront` : `Show ${row.question} on the storefront`}
              className="mx-1"
            />
            <Button variant="ghost" size="icon-xs" aria-label={editing ? "Close editor" : `Edit ${row.question}`} disabled={pending} onClick={() => onEditingChange(!editing)}>
              {editing ? <X /> : <Pencil />}
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label={`Delete ${row.question}`} disabled={pending} onClick={() => onDelete(row)}>
              <Trash2 />
            </Button>
          </div>
        ) : (
          <span className="text-muted-foreground shrink-0 text-[11px]">{row.enabled ? "Live" : "Hidden"}</span>
        )}
      </div>

      {editing ? (
        <form
          className="border-border/70 mt-3 space-y-3 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FaqFields idPrefix={`faq-${row.id}`} values={draft} onChange={patch} groups={groups} errors={errors} disabled={pending} />
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onEditingChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              Save question
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
