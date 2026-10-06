"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, Eye, EyeOff, GripVertical, ImageIcon, Link2Off, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "cn";

import { LINK_TYPE_META } from "@/lib/enums";
import { formatNumber } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { formatIstWindow } from "@/features/coupons/dates";

import { deleteBannerAction, duplicateBannerAction, reorderBannersAction, resetBannerCountersAction, toggleBannerAction } from "../actions";
import { BANNER_STATUS_META, type BannerCardRow, type BannerGroup } from "../schemas";
import { BannerPreview } from "./banner-preview";

/**
 * The banner board: one sortable card list per placement (blueprint §1
 * Banners, E1). Dragging is enabled only when the board is unfiltered - a
 * position is meaningful only against the full list for that placement - and
 * the new order is committed with one `reorderBanners` call per drop. The
 * optimistic order is kept until the server responds; a failure snaps back.
 */

function bannerHref(id: string): Route {
  return `/admin/banners/${id}` as Route;
}

/** @dnd-kit/modifiers is not a dependency; a vertical list only needs the y component. */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

function SortableCard({ row, canManage, sortable, children }: { row: BannerCardRow; canManage: boolean; sortable: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled: !sortable });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("surface flex gap-3 p-3", isDragging && "ring-brand/40 relative z-10 shadow-lg ring-2")}>
      {canManage && sortable ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="text-muted-foreground hover:text-foreground -ml-1 flex cursor-grab touch-none items-center self-stretch px-1 active:cursor-grabbing"
          aria-label={`Drag to reorder ${row.title}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      ) : null}
      {children}
    </li>
  );
}

function BannerCard({ row, canManage, pending, onToggle, onDuplicate, onReset, onDelete }: {
  row: BannerCardRow;
  canManage: boolean;
  pending: boolean;
  onToggle: () => void;
  onDuplicate: () => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const status = BANNER_STATUS_META[row.status];
  const preview = {
    title: row.title,
    subtitle: row.subtitle,
    placement: row.placement,
    imageUrl: row.media?.thumbnailUrl ?? row.media?.url ?? null,
    mobileImageUrl: row.mobileMedia?.thumbnailUrl ?? row.mobileMedia?.url ?? null,
    altText: row.altText,
    buttonText: row.buttonText,
    textColor: row.textColor,
    bgColor: row.bgColor,
  };
  return (
    <>
      <div className="flex shrink-0 items-start gap-2">
        <BannerPreview banner={preview} compact className="w-32 sm:w-44" />
        <BannerPreview banner={preview} variant="mobile" compact className="hidden w-14 sm:block" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={bannerHref(row.id)} className="truncate text-sm font-medium hover:underline">
            {row.title}
          </Link>
          <StatusPill label={status.label} tone={status.tone} />
          {!row.linkResolves ? <StatusPill label="Link target unavailable" tone="warning" /> : null}
        </div>
        {row.subtitle ? <p className="text-muted-foreground line-clamp-1 text-xs">{row.subtitle}</p> : null}
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1">
            {row.linkType === "NONE" ? <Link2Off className="size-3" /> : null}
            {row.linkType === "NONE" ? LINK_TYPE_META.NONE.label : row.linkLabel}
          </span>
          <span>{formatIstWindow(row.startsAt, row.endsAt) === "always" ? "No schedule" : formatIstWindow(row.startsAt, row.endsAt)}</span>
          <span data-numeric>
            {formatNumber(row.impressionCount)} views · {formatNumber(row.clickCount)} clicks
          </span>
          {!row.media ? (
            <span className="inline-flex items-center gap-1">
              <ImageIcon className="size-3" /> no image
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-start">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.title}`} disabled={pending}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={bannerHref(row.id)}>
                <Pencil /> {canManage ? "Edit" : "View"}
              </Link>
            </DropdownMenuItem>
            {canManage ? (
              <>
                <DropdownMenuItem onSelect={onToggle}>
                  {row.isActive ? (
                    <>
                      <EyeOff /> Hide
                    </>
                  ) : (
                    <>
                      <Eye /> Show
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onDuplicate}>
                  <Copy /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onReset}>
                  <RotateCcw /> Reset counters
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}

function PlacementGroup({ group, canManage, sortable }: { group: BannerGroup; canManage: boolean; sortable: boolean }) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const { run, pending } = useActionToast();
  const [order, setOrder] = React.useState(() => group.rows.map((row) => row.id));

  // Server re-renders (a new banner, a toggle) hand down fresh rows; adopt them.
  const serverKey = group.rows.map((row) => row.id).join("|");
  const [seenKey, setSeenKey] = React.useState(serverKey);
  if (seenKey !== serverKey) {
    setSeenKey(serverKey);
    setOrder(group.rows.map((row) => row.id));
  }

  const rowsById = new Map(group.rows.map((row) => [row.id, row]));
  const ordered = order.map((id) => rowsById.get(id)).filter((row): row is BannerCardRow => Boolean(row));

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
    const result = await run(() => reorderBannersAction({ placement: group.placement, ids: next }), { silent: true });
    if (!result.ok) setOrder(previous);
    else router.refresh();
  }

  const refresh = () => router.refresh();
  const remove = async (row: BannerCardRow) => {
    const result = await confirm({
      title: `Delete "${row.title}"?`,
      description: "The banner disappears from the storefront immediately. This cannot be undone.",
      confirmLabel: "Delete banner",
      destructive: true,
    });
    if (!result.ok) return;
    await run(() => deleteBannerAction(row.id), { onSuccess: refresh });
  };

  return (
    <section className="space-y-2" aria-labelledby={`placement-${group.placement}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id={`placement-${group.placement}`} className="text-sm font-semibold">
            {group.label} <span className="text-muted-foreground font-normal">· {group.liveCount} live of {group.rows.length}</span>
          </h2>
          <p className="text-muted-foreground text-xs">{group.description}</p>
        </div>
        {canManage ? (
          <Button asChild variant="outline" size="xs">
            <Link href={`/admin/banners/new?placement=${group.placement}` as Route}>Add to {group.label}</Link>
          </Button>
        ) : null}
      </div>
      {ordered.length === 0 ? (
        <div className="surface">
          <EmptyState icon={ImageIcon} title="Nothing here yet" description={`No banners in ${group.label}.`} compact />
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {ordered.map((row) => (
                <SortableCard key={row.id} row={row} canManage={canManage} sortable={sortable}>
                  <BannerCard
                    row={row}
                    canManage={canManage}
                    pending={pending}
                    onToggle={() => void run(() => toggleBannerAction(row.id, !row.isActive), { onSuccess: refresh })}
                    onDuplicate={() => void run(() => duplicateBannerAction(row.id), { onSuccess: refresh })}
                    onReset={() => void run(() => resetBannerCountersAction(row.id), { onSuccess: refresh })}
                    onDelete={() => void remove(row)}
                  />
                </SortableCard>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      {confirmDialog}
    </section>
  );
}

export function BannerBoard({ groups, canManage, filtered }: { groups: BannerGroup[]; canManage: boolean; filtered: boolean }) {
  const visible = filtered ? groups.filter((group) => group.rows.length > 0) : groups;
  if (visible.length === 0) {
    return (
      <div className="surface">
        <EmptyState icon={ImageIcon} title="No banners match these filters" description="Try clearing the search or the status tab." />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {filtered && canManage ? <p className="text-muted-foreground text-xs">Clear the filters to drag banners into a new order.</p> : null}
      {visible.map((group) => (
        <PlacementGroup key={group.placement} group={group} canManage={canManage} sortable={canManage && !filtered} />
      ))}
    </div>
  );
}
