import { BarChart3 } from "lucide-react";
import { cn } from "cn";

import { EmptyState } from "@/components/shared/empty-state";

/**
 * The accessible shell every chart renders inside: a <figure> with a
 * screen-reader summary and an optional data table, so the picture is never
 * the only copy of the numbers. `isEmpty` swaps the plot for an EmptyState of
 * the same height so dashboards do not reflow when one widget has no rows.
 */
export function ChartFrame({
  title,
  summary,
  height,
  isEmpty,
  emptyTitle = "No data for this period",
  emptyDescription,
  table,
  className,
  children,
}: {
  title?: string;
  summary: string;
  height: number;
  isEmpty: boolean;
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
  /** Rendered visually hidden; an sr-only table of the plotted values. */
  table?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <figure className={cn("m-0 w-full", className)} aria-label={title}>
      <figcaption className="sr-only">
        {title ? `${title}. ` : ""}
        {summary}
      </figcaption>
      {isEmpty ? (
        <div style={{ height }} className="flex items-center justify-center">
          <EmptyState compact icon={BarChart3} title={emptyTitle} description={emptyDescription} />
        </div>
      ) : (
        <>
          {children}
          {table ? <div className="sr-only">{table}</div> : null}
        </>
      )}
    </figure>
  );
}

/** The sr-only table body used by the chart wrappers. */
export function ChartDataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <table>
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header} scope="col">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
