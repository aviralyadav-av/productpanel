"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderOpen, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { FormRow } from "@/components/shared/form-layout";
import { SlugInput } from "@/components/shared/slug-input";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { createBlogCategoryAction, deleteBlogCategoryAction, reorderBlogCategoriesAction, updateBlogCategoryAction } from "../actions";
import { blogCategoryFormSchema, type BlogCategoryFormInput, type BlogCategoryRow } from "../schemas";

/**
 * /admin/blog/categories: one sortable list with inline create/edit dialogs.
 * Order is `position`, committed with one reorder call per drop (optimistic,
 * snaps back on failure). Deleting a category leaves its posts uncategorised
 * (FK SetNull) - the confirm says how many.
 */

const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

type Draft = { name: string; slug: string; description: string; isActive: boolean };
const EMPTY_DRAFT: Draft = { name: "", slug: "", description: "", isActive: true };

function SortableRow({ row, canManage, children }: { row: BlogCategoryRow; canManage: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled: !canManage });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("flex items-center gap-3 px-3 py-2.5", isDragging && "bg-accent/40 ring-brand/40 relative z-10 rounded-md ring-2")}>
      {canManage ? (
        <button ref={setActivatorNodeRef} type="button" className="text-muted-foreground hover:text-foreground -ml-1 flex cursor-grab touch-none items-center px-1 active:cursor-grabbing" aria-label={`Drag to reorder ${row.name}`} {...attributes} {...listeners}>
          <GripVertical className="size-4" />
        </button>
      ) : null}
      {children}
    </li>
  );
}

export function CategoriesManager({ rows, canManage }: { rows: BlogCategoryRow[]; canManage: boolean }) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [order, setOrder] = React.useState(() => rows.map((row) => row.id));
  const [editing, setEditing] = React.useState<{ id: string | null; draft: Draft } | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const serverKey = rows.map((row) => row.id).join(" ");
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the server order wins after a refresh
    setOrder(rows.map((row) => row.id));
  }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = order.map((id) => byId.get(id)).filter((row): row is BlogCategoryRow => Boolean(row));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const previous = order;
    const next = arrayMove(order, from, to);
    setOrder(next);
    const result = await run(() => reorderBlogCategoriesAction({ ids: next }), { silent: true });
    if (!result.ok) setOrder(previous);
    else router.refresh();
  }

  function openCreate() {
    setErrors({});
    setEditing({ id: null, draft: EMPTY_DRAFT });
  }
  function openEdit(row: BlogCategoryRow) {
    setErrors({});
    setEditing({ id: row.id, draft: { name: row.name, slug: row.slug, description: row.description ?? "", isActive: row.isActive } });
  }

  async function save() {
    if (!editing) return;
    const input: BlogCategoryFormInput = { name: editing.draft.name, slug: editing.draft.slug || undefined, description: editing.draft.description, isActive: editing.draft.isActive };
    const parsed = blogCategoryFormSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    const result = await run(() => (editing.id ? updateBlogCategoryAction(editing.id, input) : createBlogCategoryAction(input)), {
      onSuccess: () => {
        setEditing(null);
        router.refresh();
      },
    });
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  async function remove(row: BlogCategoryRow) {
    const answer = await confirm({
      title: `Delete "${row.name}"?`,
      description: row.postCount > 0 ? `${row.postCount} post${row.postCount === 1 ? "" : "s"} in this category will become uncategorised. The posts themselves are kept.` : "This category has no posts.",
      confirmLabel: "Delete category",
      destructive: true,
    });
    if (!answer.ok) return;
    await run(() => deleteBlogCategoryAction(row.id), { onSuccess: () => router.refresh() });
  }

  const setDraft = (patch: Partial<Draft>) => {
    setEditing((current) => (current ? { ...current, draft: { ...current.draft, ...patch } } : current));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key];
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">{canManage ? "Drag to set the order the storefront lists categories in." : "The order shown is the storefront order."}</p>
        {canManage ? (
          <Button size="sm" onClick={openCreate}>
            <Plus /> New category
          </Button>
        ) : null}
      </div>

      <div className="surface overflow-hidden">
        {ordered.length === 0 ? (
          <EmptyState icon={FolderOpen} title="No categories yet" description="Categories group posts on the storefront blog index. Posts without one are still listed." compact />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={handleDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <ul className="divide-y">
                {ordered.map((row) => (
                  <SortableRow key={row.id} row={row} canManage={canManage}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{row.name}</span>
                        <StatusPill label={row.isActive ? "Active" : "Hidden"} tone={row.isActive ? "success" : "neutral"} />
                      </div>
                      <p className="text-muted-foreground truncate text-[11px]">
                        <span className="font-mono">/blog?category={row.slug}</span>
                        {row.description ? ` · ${row.description}` : ""}
                      </p>
                    </div>
                    <Link href={`/admin/blog?categoryId=${row.id}` as Route} className="text-muted-foreground hover:text-foreground shrink-0 text-xs tabular-nums hover:underline" data-numeric>
                      {row.postCount} post{row.postCount === 1 ? "" : "s"}
                      <span className="text-muted-foreground/70"> · {row.publishedCount} live</span>
                    </Link>
                    {canManage ? (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button variant="ghost" size="icon-xs" aria-label={`Edit ${row.name}`} disabled={pending} onClick={() => openEdit(row)}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-xs" aria-label={`Delete ${row.name}`} disabled={pending} onClick={() => void remove(row)}>
                          <Trash2 />
                        </Button>
                      </div>
                    ) : null}
                  </SortableRow>
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">{editing?.id ? "Edit category" : "New category"}</DialogTitle>
            <DialogDescription className="text-xs">A name and an address; the description is optional and shows on the storefront category header.</DialogDescription>
          </DialogHeader>
          {editing ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <FormRow label="Name" htmlFor="blog-category-name" required error={errors.name}>
                <Input id="blog-category-name" value={editing.draft.name} onChange={(event) => setDraft({ name: event.target.value })} maxLength={80} autoFocus aria-invalid={Boolean(errors.name) || undefined} />
              </FormRow>
              <FormRow label="Slug" htmlFor="blog-category-slug" error={errors.slug} hint={editing.id ? "Changing it changes the storefront filter URL." : "Follows the name until edited."}>
                <SlugInput id="blog-category-slug" sourceValue={editing.draft.name} value={editing.draft.slug} onChange={(slug) => setDraft({ slug })} locked={Boolean(editing.id)} prefix="category=" invalid={Boolean(errors.slug)} />
              </FormRow>
              <FormRow label="Description" htmlFor="blog-category-description" error={errors.description}>
                <Textarea id="blog-category-description" value={editing.draft.description} onChange={(event) => setDraft({ description: event.target.value })} rows={2} maxLength={300} />
              </FormRow>
              <FormRow inline label="Active" htmlFor="blog-category-active" hint="Hidden categories are not offered as storefront filters; their posts stay visible.">
                <Switch id="blog-category-active" checked={editing.draft.isActive} onCheckedChange={(isActive) => setDraft({ isActive })} />
              </FormRow>
              <DialogFooter>
                <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={pending}>
                  {editing.id ? "Save" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  );
}
