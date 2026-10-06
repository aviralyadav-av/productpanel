import { cn } from "cn";

import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, DataTableBody, DataTableHead, Td, Th } from "./data-table";

/**
 * The loading state for a list page. It matches the real table's row height so
 * the swap to data does not shift the layout, and it varies the bar widths so
 * the placeholder reads as "rows of text" rather than a grid of grey blocks.
 *
 * Use from loading.tsx or a Suspense fallback:
 *   <TableSkeleton rows={10} columns={6} />
 */
export function TableSkeleton({
  rows = 8,
  columns = 5,
  showHeader = true,
  className,
}: {
  rows?: number;
  columns?: number;
  showHeader?: boolean;
  className?: string;
}) {
  // Deterministic widths so server and client render the same markup.
  const widths = ["60%", "40%", "75%", "50%", "35%", "65%", "45%"];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className={cn("surface overflow-hidden", className)}
    >
      <DataTable>
        {showHeader ? (
          <DataTableHead>
            {Array.from({ length: columns }, (_, column) => (
              <Th key={column}>
                <Skeleton className="h-3 w-16" />
              </Th>
            ))}
          </DataTableHead>
        ) : null}
        <DataTableBody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: columns }, (_, column) => (
                <Td key={column}>
                  <Skeleton
                    className="h-3"
                    style={{ width: widths[(row + column) % widths.length] }}
                  />
                </Td>
              ))}
            </tr>
          ))}
        </DataTableBody>
      </DataTable>
      <span className="sr-only">Loading table</span>
    </div>
  );
}
