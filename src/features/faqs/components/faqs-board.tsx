"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronDown, ChevronUp, HelpCircle, MoreHorizontal, Plus, Tags, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/shared/combobox";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { FormRow } from "@/components/shared/form-layout";
import { useActionToast } from "@/components/shared/use-action-toast";

import { deleteFaqAction, deleteFaqGroupAction, renameFaqGroupAction, reorderFaqGroupsAction, reorderFaqsAction } from "../actions";
import { DEFAULT_FAQ_GROUP, normalizeGroupName, type FaqBoardData, type FaqGroupView, type FaqRow } from "../schemas";
import { NewFaqDialog } from "./faq-dialog";
import { FaqSortableRow } from "./faq-row";

/**
 * /admin/faqs - the whole screen below the toolbar.
 *
 * The board is grouped because the storefront accordion is grouped, and the
 * only ordering the storefront honours is `position`. Questions are dragged
 * within their group (one `reorderFaqs` call per drop, optimistic and snapping
 * back on failure); groups move with the arrows, because a nested drag surface
 * inside a drag surface is a coin toss for pointer users and unusable for
 * keyboard ones.
 *
 * Two rules the operator can see: while any filter is on, dragging is disabled
 * (a partial list must never be saved as the full order), and "remove group"
 * never deletes questions - it moves them to a group the operator picks.
 */

const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

export function FaqsBoard({ data, canManage, filtered }: { data: FaqBoardData; canManage: boolean; filtered: boolean }) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();

  const groupNames = data.allGroups.map((group) => group.group);
  const [order, setOrder] = React.useState<Record<string, string[]>>(() => Object.fromEntries(data.groups.map((group) => [group.group, group.items.map((item) => item.id)])));
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creatingIn, setCreatingIn] = React.useState<string | undefined>(undefined);
  const [creating, setCreating] = React.useState(false);
  const [renaming, setRenaming] = React.useState<{ from: string; to: string; error?: string } | null>(null);
  const [removing, setRemoving] = React.useState<{ group: string; moveTo: string; error?: string } | null>(null);

  const serverKey = data.groups.map((group) => `${group.group}:${group.items.map((item) => item.id).join(",")}`).join("|");
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the server order always wins after a refresh
    setOrder(Object.fromEntries(data.groups.map((group) => [group.group, group.items.map((item) => item.id)])));
  }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  async function handleDragEnd(group: FaqGroupView, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const current = order[group.group] ?? group.items.map((item) => item.id);
    const from = current.indexOf(String(active.id));
    const to = current.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(current, from, to);
    setOrder((state) => ({ ...state, [group.group]: next }));
    const result = await run(() => reorderFaqsAction({ group: group.group, ids: next }), { silent: true });
    if (!result.ok) setOrder((state) => ({ ...state, [group.group]: current }));
    else router.refresh();
  }

  async function moveGroup(group: string, direction: -1 | 1) {
    const index = groupNames.indexOf(group);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= groupNames.length) return;
    const next = arrayMove(groupNames, index, target);
    await run(() => reorderFaqGroupsAction({ groups: next }), { onSuccess: () => router.refresh() });
  }

  async function removeQuestion(row: FaqRow) {
    const answer = await confirm({
      title: `Delete "${row.question}"?`,
      description: "The question and its answer are removed from the storefront immediately. This cannot be undone.",
      confirmLabel: "Delete question",
      destructive: true,
    });
    if (!answer.ok) return;
    await run(() => deleteFaqAction(row.id), { onSuccess: () => router.refresh() });
  }

  async function submitRename() {
    if (!renaming) return;
    const to = normalizeGroupName(renaming.to);
    if (to === renaming.from) {
      setRenaming({ ...renaming, error: "Choose a different name." });
      return;
    }
    const merging = groupNames.includes(to);
    if (merging) {
      const answer = await confirm({
        title: `Merge into "${to}"?`,
        description: `"${to}" already exists. Every question in "${renaming.from}" moves into it, after the questions already there.`,
        confirmLabel: "Merge groups",
      });
      if (!answer.ok) return;
    }
    const result = await run(() => renameFaqGroupAction({ from: renaming.from, to }), {
      onSuccess: () => {
        setRenaming(null);
        router.refresh();
      },
    });
    if (!result.ok) setRenaming((state) => (state ? { ...state, error: result.fieldErrors?.to ?? result.error } : state));
  }

  async function submitRemoveGroup() {
    if (!removing) return;
    const moveTo = normalizeGroupName(removing.moveTo);
    if (moveTo === removing.group) {
      setRemoving({ ...removing, error: "Pick a different destination group." });
      return;
    }
    const result = await run(() => deleteFaqGroupAction({ group: removing.group, moveTo }), {
      onSuccess: () => {
        setRemoving(null);
        router.refresh();
      },
    });
    if (!result.ok) setRemoving((state) => (state ? { ...state, error: result.fieldErrors?.moveTo ?? result.error } : state));
  }

  function openCreate(group?: string) {
    setCreatingIn(group);
    setCreating(true);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {data.shown === data.total ? `${data.total} question${data.total === 1 ? "" : "s"} in ${data.allGroups.length} group${data.allGroups.length === 1 ? "" : "s"}.` : `${data.shown} of ${data.total} questions shown.`}
          {canManage ? (filtered ? " Clear the filters to drag questions into order." : " Drag a question to reorder it inside its group.") : ""}
        </p>
        {canManage ? (
          <Button size="sm" onClick={() => openCreate()}>
            <Plus /> New FAQ
          </Button>
        ) : null}
      </div>

      {data.groups.length === 0 ? (
        <div className="surface">
          <EmptyState
            icon={HelpCircle}
            title={filtered ? "No questions match these filters" : "No FAQs yet"}
            description={filtered ? "Try a different search or clear the group filter." : "FAQs power the storefront's accordion and the FAQ-template CMS page. Add the questions support answers most often."}
            action={canManage && !filtered ? <Button size="sm" onClick={() => openCreate()}>Add the first question</Button> : undefined}
          />
        </div>
      ) : (
        data.groups.map((group) => {
          const ids = order[group.group] ?? group.items.map((item) => item.id);
          const byId = new Map(group.items.map((item) => [item.id, item]));
          const ordered = ids.map((id) => byId.get(id)).filter((item): item is FaqRow => Boolean(item));
          const index = groupNames.indexOf(group.group);

          return (
            <section key={group.group} className="surface overflow-hidden">
              <header className="bg-muted/40 flex items-center gap-2 border-b px-3 py-2">
                <Tags className="text-muted-foreground size-3.5 shrink-0" />
                <h2 className="truncate text-xs font-semibold">{group.group}</h2>
                <span className="text-muted-foreground shrink-0 text-[11px]" data-numeric>
                  {group.items.length === group.total ? `${group.total}` : `${group.items.length} of ${group.total}`} · {group.enabled} live
                </span>
                <div className="flex-1" />
                {canManage ? (
                  <>
                    <Button variant="ghost" size="icon-xs" aria-label={`Move group ${group.group} up`} disabled={pending || filtered || index <= 0} onClick={() => void moveGroup(group.group, -1)}>
                      <ChevronUp />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label={`Move group ${group.group} down`} disabled={pending || filtered || index < 0 || index >= groupNames.length - 1} onClick={() => void moveGroup(group.group, 1)}>
                      <ChevronDown />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={`Actions for group ${group.group}`} disabled={pending}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openCreate(group.group)}>
                          <Plus /> Add a question here
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setRenaming({ from: group.group, to: group.group })}>
                          <Tags /> Rename group
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setRemoving({ group: group.group, moveTo: groupNames.find((name) => name !== group.group) ?? DEFAULT_FAQ_GROUP })}
                          disabled={groupNames.length < 2}
                        >
                          <Trash2 /> Remove group…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                ) : null}
              </header>

              <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={(event) => void handleDragEnd(group, event)}>
                <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                  <ul className="divide-y">
                    {ordered.map((row) => (
                      <FaqSortableRow
                        key={row.id}
                        row={row}
                        groups={groupNames}
                        canManage={canManage}
                        dragDisabled={filtered || pending}
                        editing={editingId === row.id}
                        onEditingChange={(editing) => setEditingId(editing ? row.id : null)}
                        onDelete={(target) => void removeQuestion(target)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            </section>
          );
        })
      )}

      <NewFaqDialog open={creating} onOpenChange={setCreating} groups={groupNames} defaultGroup={creatingIn} />

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Rename group</DialogTitle>
            <DialogDescription className="text-xs">Every question in this group keeps its order. Using the name of another group merges the two.</DialogDescription>
          </DialogHeader>
          {renaming ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitRename();
              }}
            >
              <FormRow label="Name" htmlFor="faq-group-rename" required error={renaming.error}>
                <Input id="faq-group-rename" value={renaming.to} onChange={(event) => setRenaming({ from: renaming.from, to: event.target.value })} maxLength={60} autoFocus aria-invalid={Boolean(renaming.error) || undefined} />
              </FormRow>
              <DialogFooter>
                <Button type="button" variant="outline" size="sm" onClick={() => setRenaming(null)} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={pending}>
                  Rename
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Remove group “{removing?.group}”</DialogTitle>
            <DialogDescription className="text-xs">Questions are never deleted with their group - choose where they go.</DialogDescription>
          </DialogHeader>
          {removing ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitRemoveGroup();
              }}
            >
              <FormRow label="Move its questions to" htmlFor="faq-group-move-to" required error={removing.error}>
                <SearchableSelect
                  id="faq-group-move-to"
                  options={groupNames.filter((name) => name !== removing.group).map((name) => ({ value: name, label: name }))}
                  value={removing.moveTo}
                  onChange={(value) => setRemoving({ group: removing.group, moveTo: value ?? DEFAULT_FAQ_GROUP })}
                  placeholder="Choose a group"
                  invalid={Boolean(removing.error)}
                />
              </FormRow>
              <DialogFooter>
                <Button type="button" variant="outline" size="sm" onClick={() => setRemoving(null)} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={pending}>
                  Move and remove group
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
