"use client";

import * as React from "react";

import { Checkbox } from "@/components/ui/checkbox";

/**
 * Bulk selection for URL-driven tables.
 *
 * The rows come from the server, so selection is the one piece of list state
 * that genuinely belongs in React: it is per-tab, transient, and must survive
 * a revalidation without surviving a navigation. Selection is keyed by row id
 * rather than index so a background refresh that reorders rows cannot silently
 * change what "delete selected" would act on.
 *
 * @example
 *   const selection = useRowSelection(rows.map((r) => r.id));
 *   <Th width="2rem"><RowCheckbox {...selection.headerProps} label="Select all on this page" /></Th>
 *   <Td><RowCheckbox {...selection.rowProps(row.id)} label={`Select ${row.title}`} /></Td>
 *   <BulkActionBar count={selection.count} onClear={selection.clear} actions={...} />
 */
export function useRowSelection(pageIds: readonly string[]) {
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // Rows that left the page (filter change, deletion) drop out of the selection
  // so the count never claims more than the operator can see.
  const pageKey = pageIds.join(" ");
  const visibleSelected = React.useMemo(() => {
    const onPage = new Set(pageIds);
    const next = new Set<string>();
    for (const id of selected) if (onPage.has(id)) next.add(id);
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pageKey is the stable identity of pageIds
  }, [selected, pageKey]);

  const allSelected = pageIds.length > 0 && visibleSelected.size === pageIds.length;
  const someSelected = visibleSelected.size > 0 && !allSelected;

  const toggle = React.useCallback((id: string, checked?: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      const shouldSelect = checked ?? !next.has(id);
      if (shouldSelect) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleAll = React.useCallback(
    (checked?: boolean) => {
      setSelected((current) => {
        const next = new Set(current);
        const shouldSelect = checked ?? !pageIds.every((id) => next.has(id));
        for (const id of pageIds) {
          if (shouldSelect) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pageKey is the stable identity of pageIds
    [pageKey],
  );

  const clear = React.useCallback(() => setSelected(new Set()), []);

  return {
    selectedIds: [...visibleSelected],
    count: visibleSelected.size,
    isSelected: (id: string) => visibleSelected.has(id),
    allSelected,
    someSelected,
    toggle,
    toggleAll,
    clear,
    /** Spread onto the header RowCheckbox. */
    headerProps: {
      checked: allSelected ? true : someSelected ? ("indeterminate" as const) : false,
      onCheckedChange: (checked: boolean | "indeterminate") =>
        toggleAll(checked === true),
      disabled: pageIds.length === 0,
    },
    /** Spread onto a body RowCheckbox. */
    rowProps: (id: string) => ({
      checked: visibleSelected.has(id),
      onCheckedChange: (checked: boolean | "indeterminate") =>
        toggle(id, checked === true),
    }),
  };
}

export type RowSelection = ReturnType<typeof useRowSelection>;

/**
 * The checkbox cell. Stops click propagation so a row-level onClick (open the
 * detail page) does not fire when the operator is only ticking the box.
 */
export function RowCheckbox({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean | "indeterminate";
  onCheckedChange: (checked: boolean | "indeterminate") => void;
  /** Screen-reader label, e.g. "Select order #1042". */
  label: string;
  disabled?: boolean;
}) {
  return (
    <span
      className="flex items-center"
      onClick={(event) => event.stopPropagation()}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
      />
    </span>
  );
}
