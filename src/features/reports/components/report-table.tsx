"use client";

import * as React from "react";
import { TableProperties } from "lucide-react";

import type { PageMeta } from "@/lib/list-params";
import { ColumnVisibilityMenu, useColumnVisibility, type ColumnDef } from "@/components/shared/column-visibility";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/list-controls";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { SortableTh } from "@/components/shared/sortable-th";

import type { ReportColumn, ReportRow } from "../types";
import { ReportCell, formatCellText, isNumericColumn } from "./report-cell";

/**
 * The one table all thirteen reports render into.
 *
 * Sorting and paging are URL navigation (SortableTh, PaginationBar) because
 * the rows come from a Server Component that re-queries from searchParams -
 * so a sorted, paged report is a shareable link and the back button undoes a
 * sort. Column visibility is the exception: it is a per-browser preference,
 * kept in localStorage by useColumnVisibility, and never narrows the export.
 *
 * Below `md` the table becomes cards: the first column is the card title and
 * every other visible column becomes a labelled field, which keeps a
 * twelve-column finance report readable on a phone without a horizontal
 * scrollbar the width of a desk.
 */
export function ReportTable({
  reportKey,
  columns,
  rows,
  meta,
  sort,
  order,
  hasFilters,
}: {
  reportKey: string;
  columns: readonly ReportColumn[];
  rows: ReportRow[];
  meta: PageMeta;
  sort: string;
  order: "asc" | "desc";
  hasFilters: boolean;
}) {
  const defs: ColumnDef[] = React.useMemo(
    () =>
      columns.map((column) => ({
        key: column.key,
        label: column.label,
        defaultHidden: column.defaultHidden,
        locked: column.locked,
      })),
    [columns],
  );
  const visibility = useColumnVisibility(`report:${reportKey}`, defs);
  const visible = columns.filter((column) => visibility.isVisible(column.key));
  const [titleColumn, ...restColumns] = visible;

  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState
          icon={TableProperties}
          title="No rows for this period"
          description={
            hasFilters
              ? "No records match this date range and these filters. Widen the range or clear a filter."
              : "Nothing was recorded in this date range. Pick a wider range from the date picker."
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <ColumnVisibilityMenu {...visibility.menuProps} />
      </div>

      <div className="surface overflow-hidden">
        <ResponsiveTable
          table={
            <DataTable className="max-h-[70vh] overflow-y-auto">
              <DataTableHead>
                {visible.map((column) =>
                  column.sortable === false ? (
                    <Th key={column.key} align={isNumericColumn(column) ? "right" : "left"}>
                      {column.label}
                    </Th>
                  ) : (
                    <SortableTh
                      key={column.key}
                      column={column.key}
                      label={column.label}
                      currentSort={sort}
                      currentOrder={order}
                      align={isNumericColumn(column) ? "right" : "left"}
                      defaultOrder={isNumericColumn(column) || column.type === "date" || column.type === "datetime" ? "desc" : "asc"}
                    />
                  ),
                )}
              </DataTableHead>
              <DataTableBody>
                {rows.map((row, index) => (
                  <Tr key={rowKey(row, visible, index)}>
                    {visible.map((column) => (
                      <Td
                        key={column.key}
                        align={isNumericColumn(column) ? "right" : "left"}
                        numeric={isNumericColumn(column)}
                      >
                        <ReportCell column={column} row={row} />
                      </Td>
                    ))}
                  </Tr>
                ))}
              </DataTableBody>
            </DataTable>
          }
          cards={rows.map((row, index) => (
            <MobileCard
              key={rowKey(row, visible, index)}
              title={titleColumn ? formatCellText(titleColumn, row[titleColumn.key]) : `Row ${index + 1}`}
              subtitle={titleColumn?.subtitleKey ? String(row[titleColumn.subtitleKey] ?? "") : undefined}
            >
              {restColumns.map((column) => (
                <MobileCardField key={column.key} label={column.label} numeric={isNumericColumn(column)}>
                  {formatCellText(column, row[column.key])}
                </MobileCardField>
              ))}
            </MobileCard>
          ))}
        />

        <PaginationBar meta={meta} itemLabel="rows" />
      </div>
    </div>
  );
}

/**
 * A stable key per row. Reports are aggregates, so there is rarely an id;
 * the first visible column's value plus the index is unique within a page and
 * survives a re-sort without React reusing the wrong row's state.
 */
function rowKey(row: ReportRow, columns: readonly ReportColumn[], index: number): string {
  const first = columns[0];
  const value = first ? row[first.key] : undefined;
  return `${String(value ?? "")}:${index}`;
}
