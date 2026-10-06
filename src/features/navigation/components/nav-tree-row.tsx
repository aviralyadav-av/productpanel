"use client";

import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, ExternalLink, MoreHorizontal, Pencil, Plus, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { cn } from "cn";

import { NAVIGATION_ITEM_TYPE_META } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { StatusPill } from "@/components/shared/status-badge";

import type { NavTreeRow } from "../schemas";

/**
 * One row of the menu tree. The availability warning (§11.25) is the point of
 * this row: an item pointing at a deleted, unpublished or disabled target is
 * still rendered by the website (greyed out), so the admin has to say so
 * loudly and link straight to the record that needs fixing.
 */
export function NavTreeRowView({
  row,
  canManage,
  pending,
  depth,
  onEdit,
  onAddChild,
  onToggle,
  onDelete,
}: {
  row: NavTreeRow;
  canManage: boolean;
  pending: boolean;
  depth: number;
  onEdit: (row: NavTreeRow) => void;
  onAddChild: (row: NavTreeRow) => void;
  onToggle: (row: NavTreeRow, isActive: boolean) => void;
  onDelete: (row: NavTreeRow) => void;
}) {
  const meta = NAVIGATION_ITEM_TYPE_META[row.type];
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={cn("truncate text-sm font-medium hover:underline", !row.isActive && "text-muted-foreground line-through")}
            onClick={() => onEdit(row)}
          >
            {row.label}
          </button>
          <StatusPill label={meta.label} tone={meta.tone} dot={false} />
          {row.isMegaMenu && depth === 0 ? <StatusPill label="Mega menu" tone="info" dot={false} /> : null}
          {row.badgeText ? <StatusPill label={row.badgeText} tone="warning" dot={false} /> : null}
          {!row.available ? (
            <span
              className="text-warning inline-flex items-center gap-1 text-[11px]"
              title={row.availabilityNote ?? "The website will render this link inactive."}
            >
              <AlertTriangle className="size-3" /> {row.availabilityNote ?? "Target unavailable"}
            </span>
          ) : null}
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
          <span className="truncate">{row.targetLabel}</span>
          {row.publicUrl ? <code className="truncate font-mono">{row.publicUrl}</code> : null}
          {row.openInNewTab ? (
            <span className="inline-flex items-center gap-1">
              <ExternalLink className="size-3" /> new tab
            </span>
          ) : null}
          {row.iconName ? <span>icon: {row.iconName}</span> : null}
        </div>
      </div>

      <Switch
        size="sm"
        checked={row.isActive}
        disabled={!canManage || pending}
        onCheckedChange={(value) => onToggle(row, value)}
        aria-label={`${row.isActive ? "Hide" : "Show"} ${row.label}`}
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.label}`} disabled={pending}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onEdit(row)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          {canManage ? (
            <DropdownMenuItem onSelect={() => onAddChild(row)}>
              <Plus /> Add child link
            </DropdownMenuItem>
          ) : null}
          {row.adminHref ? (
            <DropdownMenuItem asChild>
              <Link href={row.adminHref as Route}>
                <SquareArrowOutUpRight /> Open target
              </Link>
            </DropdownMenuItem>
          ) : null}
          {canManage ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete(row)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
