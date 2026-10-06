import { cn } from "cn";

/**
 * The strip between the page header and the table: search on the left,
 * filters in the middle, view/export actions on the right. Every list page
 * uses it so the search box is always in the same place. On narrow screens it
 * wraps into rows rather than shrinking the inputs.
 *
 * @example
 *   <DataTableToolbar
 *     search={<SearchInput placeholder="Search orders" />}
 *     filters={<><FilterTabs paramKey="status" options={...} /><DateRangePicker /></>}
 *     actions={<><ColumnVisibilityMenu {...columns.menuProps} /><ExportButton formats={["csv","xlsx"]} hrefFor={...} /></>}
 *   />
 */
export function DataTableToolbar({
  search,
  filters,
  actions,
  className,
}: {
  search?: React.ReactNode;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  // Below `lg` the three zones stack as rows (search, then filters, then
  // actions) - the earlier single flex-wrap let a long filter row and the
  // action buttons interleave and overlap at tablet widths.
  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-b px-3 py-2 sm:px-4 lg:flex-row lg:flex-wrap lg:items-center",
        className,
      )}
    >
      {search ? <div className="w-full lg:w-64 xl:w-72">{search}</div> : null}
      {filters ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {filters}
        </div>
      ) : (
        <div className="hidden flex-1 lg:block" />
      )}
      {actions ? (
        <div className="flex flex-wrap items-center gap-1.5 lg:ml-auto">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
