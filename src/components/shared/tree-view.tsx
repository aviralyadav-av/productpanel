"use client";

import * as React from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, GripVertical } from "lucide-react";
import { cn } from "cn";

import {
  applyMove,
  flattenTree,
  subtreeHeight,
  type FlatItem,
  type TreeItem,
} from "./tree-utils";

export type TreeRowState = {
  depth: number;
  isDragging: boolean;
  collapsed: boolean;
  toggle: () => void;
  hasChildren: boolean;
};

export type TreeMove = { id: string; parentId: string | null; position: number };

export type TreeViewProps<T extends TreeItem> = {
  items: T[];
  renderRow: (item: T, state: TreeRowState) => React.ReactNode;
  /** Called once per drop. Reject (throw) to roll the optimistic move back. */
  onMove: (move: TreeMove) => Promise<void> | void;
  /** Deepest allowed level, 0-based. Categories use 2 (three levels). */
  maxDepth?: number;
  indentPx?: number;
  collapsible?: boolean;
  disabled?: boolean;
  /** Start with every branch collapsed. */
  defaultCollapsed?: boolean;
  className?: string;
  emptyState?: React.ReactNode;
  /** Human name for screen-reader announcements ("Picked up Handbags"). */
  getLabel?: (item: T) => string;
};

/**
 * Drag-and-drop tree for categories and navigation (blueprint G5).
 *
 * The SortableTree pattern: the tree is flattened to the rows that are
 * currently visible, dnd-kit sorts that flat list vertically, and the
 * *horizontal* drag offset decides the depth - dragging right nests under the
 * row above, dragging left un-nests. That projection is clamped so a node
 * cannot be dropped deeper than `maxDepth` (its own subtree counts) or become
 * its own descendant. Children travel with their parent because the parent's
 * subtree is excluded from the flat list while it is being dragged.
 *
 * The move is applied optimistically and reverted if `onMove` throws, so the
 * UI feels immediate while the server remains the source of truth for
 * `path`/`depth`.
 *
 * @example
 *   <TreeView items={categories} maxDepth={2}
 *     renderRow={(c, { hasChildren }) => <span>{c.name}{hasChildren ? ` (${c.childCount})` : ""}</span>}
 *     onMove={(move) => reorderCategories([move])} />
 */
export function TreeView<T extends TreeItem>({
  items,
  renderRow,
  onMove,
  maxDepth = Number.POSITIVE_INFINITY,
  indentPx = 24,
  collapsible = true,
  disabled = false,
  defaultCollapsed = false,
  className,
  emptyState,
  getLabel,
}: TreeViewProps<T>) {
  // Optimistic copy of the items; re-synced whenever the server hands us a
  // new array (the reorder action revalidates the page).
  const [local, setLocal] = React.useState(items);
  const [prevItems, setPrevItems] = React.useState(items);
  if (items !== prevItems) {
    setPrevItems(items);
    setLocal(items);
  }

  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() =>
    defaultCollapsed
      ? new Set(items.filter((item) => items.some((child) => child.parentId === item.id)).map((i) => i.id))
      : new Set(),
  );
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);
  const [offsetLeft, setOffsetLeft] = React.useState(0);

  const flat = React.useMemo(
    () => flattenTree(local, { collapsedIds: collapsed, excludeId: activeId }),
    [local, collapsed, activeId],
  );
  const ids = React.useMemo(() => flat.map((row) => row.item.id), [flat]);

  const projected =
    activeId && overId
      ? getProjection(flat, local, activeId, overId, offsetLeft, indentPx, maxDepth)
      : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const toggle = React.useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function reset() {
    setActiveId(null);
    setOverId(null);
    setOffsetLeft(0);
    document.body.style.removeProperty("cursor");
  }

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id));
    setOverId(String(active.id));
    document.body.style.setProperty("cursor", "grabbing");
  }

  function handleDragMove({ delta }: DragMoveEvent) {
    setOffsetLeft(delta.x);
  }

  function handleDragOver({ over }: DragOverEvent) {
    setOverId(over ? String(over.id) : null);
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    const result = projected;
    reset();
    if (!over || !result) return;

    const id = String(active.id);
    const { parentId, position } = result;
    const current = local.find((item) => item.id === id);
    if (!current) return;

    // Nothing changed: same parent, same slot. Skip the round trip.
    const currentIndex = local
      .filter((item) => item.parentId === current.parentId)
      .sort((a, b) => a.position - b.position)
      .findIndex((item) => item.id === id);
    if (current.parentId === parentId && currentIndex === position) return;

    const previous = local;
    setLocal(applyMove(local, { id, parentId, position }));
    try {
      await onMove({ id, parentId, position });
    } catch {
      setLocal(previous);
    }
  }

  const activeRow = activeId ? flat.find((row) => row.item.id === activeId) ?? null : null;

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${labelFor(active.id)}.`,
    onDragOver: ({ active }) =>
      projected
        ? `${labelFor(active.id)} will move to level ${projected.depth + 1}, position ${projected.position + 1}.`
        : undefined,
    onDragEnd: ({ active }) =>
      projected
        ? `${labelFor(active.id)} moved to level ${projected.depth + 1}, position ${projected.position + 1}.`
        : `${labelFor(active.id)} was dropped.`,
    onDragCancel: ({ active }) => `Moving ${labelFor(active.id)} was cancelled.`,
  };

  function labelFor(id: UniqueIdentifier) {
    const item = local.find((row) => row.id === String(id));
    return item && getLabel ? getLabel(item) : `item ${String(id)}`;
  }

  if (local.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={{ announcements }}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={reset}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul role="tree" className={cn("flex flex-col", className)}>
          {flat.map((row) => {
            const isActive = row.item.id === activeId;
            const depth = isActive && projected ? projected.depth : row.depth;
            return (
              <TreeRow
                key={row.item.id}
                row={row}
                depth={depth}
                indentPx={indentPx}
                collapsible={collapsible}
                collapsed={collapsed.has(row.item.id)}
                onToggle={() => toggle(row.item.id)}
                disabled={disabled}
                isGhost={isActive}
              >
                {renderRow(row.item, {
                  depth,
                  isDragging: isActive,
                  collapsed: collapsed.has(row.item.id),
                  toggle: () => toggle(row.item.id),
                  hasChildren: row.hasChildren,
                })}
              </TreeRow>
            );
          })}
        </ul>
      </SortableContext>

      <DragOverlay dropAnimation={null}>
        {activeRow ? (
          <div className="bg-popover ring-foreground/10 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs shadow-md ring-1">
            <GripVertical className="text-muted-foreground size-3.5" />
            {renderRow(activeRow.item, {
              depth: projected?.depth ?? activeRow.depth,
              isDragging: true,
              collapsed: collapsed.has(activeRow.item.id),
              toggle: () => undefined,
              hasChildren: activeRow.hasChildren,
            })}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function TreeRow<T extends TreeItem>({
  row,
  depth,
  indentPx,
  collapsible,
  collapsed,
  onToggle,
  disabled,
  isGhost,
  children,
}: {
  row: FlatItem<T>;
  depth: number;
  indentPx: number;
  collapsible: boolean;
  collapsed: boolean;
  onToggle: () => void;
  disabled: boolean;
  isGhost: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setDraggableNodeRef, setDroppableNodeRef, transform, transition } =
    useSortable({ id: row.item.id, disabled });

  return (
    <li
      ref={setDroppableNodeRef}
      role="treeitem"
      aria-selected={false}
      aria-level={depth + 1}
      aria-expanded={row.hasChildren ? !collapsed : undefined}
      style={{ paddingLeft: depth * indentPx }}
      className="list-none"
    >
      <div
        ref={setDraggableNodeRef}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        className={cn(
          "group/row hover:bg-accent/40 flex items-center gap-1 border-b px-2 py-1.5 text-xs transition-colors",
          isGhost && "bg-brand-muted/40 opacity-60",
        )}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label="Drag to reorder"
          className={cn(
            "text-muted-foreground/60 hover:text-foreground flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md touch-none active:cursor-grabbing disabled:cursor-default disabled:opacity-40",
          )}
        >
          <GripVertical className="size-3.5" />
        </button>

        {collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            disabled={!row.hasChildren}
            aria-label={collapsed ? "Expand" : "Collapse"}
            className={cn(
              "text-muted-foreground hover:text-foreground flex size-5 shrink-0 items-center justify-center rounded-md",
              !row.hasChildren && "invisible",
            )}
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", !collapsed && "rotate-90")}
            />
          </button>
        ) : null}

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * Where the dragged row would land: the depth implied by the horizontal drag
 * offset, bounded by what the neighbours allow, and the parent/position that
 * depth implies in the reordered flat list.
 */
function getProjection<T extends TreeItem>(
  flat: FlatItem<T>[],
  all: readonly T[],
  activeId: string,
  overId: string,
  dragOffset: number,
  indentPx: number,
  maxDepth: number,
): { depth: number; parentId: string | null; position: number } | null {
  const overIndex = flat.findIndex((row) => row.item.id === overId);
  const activeIndex = flat.findIndex((row) => row.item.id === activeId);
  if (overIndex < 0 || activeIndex < 0) return null;

  const activeRow = flat[activeIndex];
  const reordered = arrayMove(flat, activeIndex, overIndex);
  const previous = reordered[overIndex - 1];
  const next = reordered[overIndex + 1];

  const dragDepth = Math.round(dragOffset / indentPx);
  const projectedDepth = activeRow.depth + dragDepth;

  // The row above sets how deep we may go (one level under it); the row below
  // sets how shallow (it must still find a parent above it).
  const upper = previous ? previous.depth + 1 : 0;
  const lower = next ? next.depth : 0;
  // The dragged subtree has to fit under maxDepth as well.
  const allowedByMax = maxDepth - subtreeHeight(all, activeId);

  let depth = Math.min(projectedDepth, upper, allowedByMax);
  depth = Math.max(depth, lower);
  if (depth < 0) depth = 0;

  let parentId: string | null = null;
  if (depth === 0 || !previous) {
    parentId = null;
  } else if (depth === previous.depth) {
    parentId = previous.item.parentId;
  } else if (depth > previous.depth) {
    parentId = previous.item.id;
  } else {
    parentId =
      reordered
        .slice(0, overIndex)
        .reverse()
        .find((row) => row.depth === depth)?.item.parentId ?? null;
  }

  // Position = index among the visible siblings sharing the new parent, in
  // the reordered list up to and including the active row.
  const position = reordered
    .slice(0, overIndex)
    .filter((row) => row.item.id !== activeId && rowParentAtDepth(row, depth) === parentId).length;

  return { depth, parentId, position };
}

/** A row is a sibling candidate only if it sits at the projected depth. */
function rowParentAtDepth<T extends TreeItem>(row: FlatItem<T>, depth: number) {
  return row.depth === depth ? row.item.parentId : Symbol.for("no-match");
}

