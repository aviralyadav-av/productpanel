"use client";

import * as React from "react";
import { Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocalStorage } from "@/hooks/use-local-storage";

export type ColumnDef = {
  key: string;
  label: string;
  defaultHidden?: boolean;
  /** Columns the operator must not hide (the title, the checkbox). */
  locked?: boolean;
};

const STORAGE_PREFIX = "dt:columns:";

/**
 * Which columns of a table the operator has hidden, remembered per table in
 * localStorage. This is a per-browser convenience, not data: it is not synced
 * to the server, and losing it costs nothing but a click.
 *
 * Only the *deviation* from defaults is stored (an explicit hidden list), so a
 * column added to the table later shows up for everyone at its default.
 *
 * @example
 *   const columns = useColumnVisibility("orders", ORDER_COLUMNS);
 *   {columns.isVisible("customer") ? <Th>Customer</Th> : null}
 *   <ColumnVisibilityMenu {...columns.menuProps} />
 */
export function useColumnVisibility(tableKey: string, columns: ColumnDef[]) {
  const defaults = React.useMemo(
    () => columns.filter((column) => column.defaultHidden).map((column) => column.key),
    [columns],
  );
  const [hidden, setHidden, hydrated] = useLocalStorage<string[] | null>(
    `${STORAGE_PREFIX}${tableKey}`,
    null,
  );
  const effective = hidden ?? defaults;

  const isVisible = React.useCallback(
    (key: string) => !effective.includes(key),
    [effective],
  );

  const setVisible = React.useCallback(
    (key: string, visible: boolean) =>
      setHidden((current) => {
        const base = current ?? defaults;
        return visible ? base.filter((item) => item !== key) : [...new Set([...base, key])];
      }),
    [setHidden, defaults],
  );

  const reset = React.useCallback(() => setHidden(null), [setHidden]);

  return {
    isVisible,
    setVisible,
    reset,
    hydrated,
    hiddenKeys: effective,
    visibleCount: columns.filter((column) => !effective.includes(column.key)).length,
    menuProps: { tableKey, columns, isVisible, setVisible, reset },
  };
}

export function ColumnVisibilityMenu({
  columns,
  isVisible,
  setVisible,
  reset,
  className,
}: {
  tableKey: string;
  columns: ColumnDef[];
  isVisible: (key: string) => boolean;
  setVisible: (key: string, visible: boolean) => void;
  reset?: () => void;
  className?: string;
}) {
  const hiddenCount = columns.filter((column) => !isVisible(column.key)).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={className}
          aria-label="Choose columns"
        >
          <Settings2 />
          Columns
          {hiddenCount > 0 ? (
            <span data-numeric className="text-muted-foreground">
              ({hiddenCount} hidden)
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs">Show columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.key}
            checked={isVisible(column.key)}
            disabled={column.locked}
            onCheckedChange={(checked) => setVisible(column.key, checked === true)}
            // Keep the menu open so several columns can be toggled in one go.
            onSelect={(event) => event.preventDefault()}
            className="text-xs"
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
        {reset ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-xs" onSelect={reset}>
              Reset to defaults
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
