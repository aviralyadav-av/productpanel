"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, Eye, GripVertical, ImageIcon, LayoutTemplate, Link2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "cn";

import { LINK_TYPE_META, type LinkType } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { useQueryNav } from "@/hooks/use-query-nav";
import { sectionDefinition } from "@/features/content/registry";

import { deleteSectionAction, duplicateSectionAction, reorderSectionsAction, setSectionEnabledAction } from "../actions";
import { formatWindow } from "../datetime";
import type { SectionBoardRow } from "../schemas";
import { AddSectionDialog } from "./add-section-dialog";
import { SCHEDULE_STATE_META } from "./schedule-state";

/**
 * The homepage board (blueprint §1 Homepage, E1): every section of page
 * `home` in storefront order. Dragging commits one `reorderSections` call per
 * drop with the full id list; the optimistic order snaps back on failure.
 * Row actions open the editor Sheet through the URL (`?section=<id>`).
 */

const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

function SortableRow({ id, disabled, label, children }: { id: string; disabled: boolean; label: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("flex items-center gap-3 px-3 py-2.5", isDragging && "bg-background ring-brand/40 relative z-10 rounded-md shadow-lg ring-2")}>
      {!disabled ? (
        <button ref={setActivatorNodeRef} type="button" className="text-muted-foreground hover:text-foreground -ml-1 cursor-grab touch-none px-1 active:cursor-grabbing" aria-label={`Drag to reorder ${label}`} {...attributes} {...listeners}>
          <GripVertical className="size-4" />
        </button>
      ) : null}
      {children}
    </li>
  );
}

export function SectionsBoard({ rows, canManage }: { rows: SectionBoardRow[]; canManage: boolean }) {
  const router = useRouter();
  const { hrefFor } = useQueryNav();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [adding, setAdding] = React.useState(false);
  const [order, setOrder] = React.useState(rows.map((row) => row.id));
  const [prevRows, setPrevRows] = React.useState(rows);
  if (rows !== prevRows) {
    setPrevRows(rows);
    setOrder(rows.map((row) => row.id));
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(order, from, to);
    setOrder(next);
    const result = await run(() => reorderSectionsAction({ ids: next }), { silent: true });
    if (!result.ok) setOrder(rows.map((row) => row.id));
    else router.refresh();
  }

  async function remove(row: SectionBoardRow) {
    const answer = await confirm({
      title: `Delete "${row.title}"?`,
      description: row.blockCount > 0 ? `Its ${row.blockCount} item${row.blockCount === 1 ? "" : "s"} go with it. The website stops receiving this section on the next cache refresh.` : "The website stops receiving this section on the next cache refresh. This cannot be undone.",
      confirmLabel: "Delete section",
      destructive: true,
    });
    if (!answer.ok) return;
    const result = await run(() => deleteSectionAction(row.id));
    if (result.ok) router.refresh();
  }

  const editHref = (id: string) => hrefFor({ section: id, pane: null }) as Route;
  const previewHref = (id: string) => hrefFor({ section: id, pane: "preview" }) as Route;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {rows.length} section{rows.length === 1 ? "" : "s"} · drag to change the order the website renders them in.
        </p>
        {canManage ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus /> Add section
          </Button>
        ) : null}
      </div>

      <div className="surface overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={LayoutTemplate}
            title="No homepage sections yet"
            description="Sections drive the storefront homepage: each one becomes an entry in GET /api/v1/home, in this order, with its items resolved server-side. Add a hero slider, a product strip or a newsletter block to start."
            action={canManage ? <Button size="sm" onClick={() => setAdding(true)}><Plus /> Add your first section</Button> : undefined}
          />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <ul className="divide-y">
                {order.map((id) => {
                  const row = byId.get(id);
                  if (!row) return null;
                  const definition = sectionDefinition(row.type);
                  const state = SCHEDULE_STATE_META[row.state];
                  const Icon = definition.icon;
                  const window = formatWindow(row.publishAt, row.unpublishAt);
                  return (
                    <SortableRow key={id} id={id} disabled={!canManage || pending} label={row.title}>
                      <span className={cn("bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md", row.state === "live" && "text-foreground")} title={definition.label}>
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={editHref(row.id)} className="truncate text-sm font-medium hover:underline" scroll={false}>
                            {row.title}
                          </Link>
                          <StatusPill label={row.typeLabel} tone={row.typeKnown ? "neutral" : "warning"} dot={false} />
                          <StatusPill label={state.label} tone={state.tone} />
                        </div>
                        {row.subtitle ? <p className="text-muted-foreground line-clamp-1 text-xs">{row.subtitle}</p> : null}
                        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                          <span>{row.sourceNote}</span>
                          {window ? <span>{window}</span> : null}
                          {row.linkType !== "NONE" ? (
                            <span className="inline-flex items-center gap-1">
                              <Link2 className="size-3" /> {LINK_TYPE_META[row.linkType as LinkType]?.label ?? row.linkType}
                              {row.buttonText ? ` · "${row.buttonText}"` : ""}
                            </span>
                          ) : null}
                          {row.hasImage ? (
                            <span className="inline-flex items-center gap-1">
                              <ImageIcon className="size-3" /> image
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="hidden shrink-0 items-center gap-2 sm:flex">
                        <Switch size="sm" checked={row.enabled} disabled={!canManage || pending} onCheckedChange={(value) => run(() => setSectionEnabledAction(row.id, value)).then((result) => result.ok && router.refresh())} aria-label={`${row.enabled ? "Disable" : "Enable"} ${row.title}`} />
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.title}`} disabled={pending}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={editHref(row.id)} scroll={false}>
                              <Pencil /> Edit
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={previewHref(row.id)} scroll={false}>
                              <Eye /> Preview
                            </Link>
                          </DropdownMenuItem>
                          {canManage ? (
                            <>
                              <DropdownMenuItem onSelect={() => run(() => duplicateSectionAction(row.id)).then((result) => result.ok && router.refresh())}>
                                <Copy /> Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onSelect={() => remove(row)}>
                                <Trash2 /> Delete
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </SortableRow>
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <AddSectionDialog open={adding} onOpenChange={setAdding} />
      {confirmDialog}
    </div>
  );
}
