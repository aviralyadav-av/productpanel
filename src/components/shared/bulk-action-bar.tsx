"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2, X } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";

export type BulkAction = {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void | Promise<void>;
  destructive?: boolean;
  /** Permission code the actor needs; pass `permissions` to have it filtered. */
  permission?: string;
  disabled?: boolean;
};

/**
 * Floats above the bottom edge while rows are selected and disappears when
 * they are not. It floats rather than sitting in the toolbar because the
 * operator selects rows while scrolled deep into the list and should not have
 * to scroll back up to act on them.
 *
 * Actions run one at a time: a second click while one is pending is ignored,
 * because "archive 40 products" and "delete 40 products" racing each other is
 * exactly the failure mode bulk actions exist to prevent.
 */
export function BulkActionBar({
  count,
  actions,
  onClear,
  permissions,
  itemLabel = "selected",
  className,
}: {
  count: number;
  actions: BulkAction[];
  onClear: () => void;
  /** The actor's permission codes. When given, actions the actor lacks are hidden. */
  permissions?: ReadonlySet<string> | readonly string[];
  itemLabel?: string;
  className?: string;
}) {
  const [pendingLabel, setPendingLabel] = React.useState<string | null>(null);

  if (count === 0) return null;

  const allowed = new Set(permissions ?? []);
  const visible = permissions
    ? actions.filter((action) => !action.permission || allowed.has(action.permission))
    : actions;

  async function run(action: BulkAction) {
    if (pendingLabel) return;
    setPendingLabel(action.label);
    try {
      await action.onSelect();
    } finally {
      setPendingLabel(null);
    }
  }

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className={cn(
        "bg-popover text-popover-foreground ring-foreground/10 animate-in fade-in-0 slide-in-from-bottom-2 fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center gap-1 rounded-lg px-2 py-1.5 shadow-md ring-1",
        className,
      )}
    >
      <span
        data-numeric
        className="border-r px-2 text-xs font-medium whitespace-nowrap"
      >
        {count} {itemLabel}
      </span>
      {visible.map((action) => {
        const Icon = action.icon;
        const isPending = pendingLabel === action.label;
        return (
          <Button
            key={action.label}
            type="button"
            size="sm"
            variant={action.destructive ? "destructive" : "ghost"}
            disabled={action.disabled || pendingLabel !== null}
            onClick={() => run(action)}
          >
            {isPending ? (
              <Loader2 className="animate-spin" />
            ) : Icon ? (
              <Icon />
            ) : null}
            {action.label}
          </Button>
        );
      })}
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={onClear}
        aria-label="Clear selection"
        disabled={pendingLabel !== null}
      >
        <X />
      </Button>
    </div>
  );
}
