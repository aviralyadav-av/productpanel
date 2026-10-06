import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/**
 * Mirrors the real layout - header, four KPI tiles, toolbar, table - rather
 * than showing a spinner, so nothing jumps when the queries resolve.
 */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-full max-w-2xl" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="surface space-y-3 p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-2.5 w-32" />
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Skeleton className="h-7 w-full max-w-xl" />
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-full sm:w-80" />
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-8 w-36" />
        </div>
      </div>

      <TableSkeleton rows={10} columns={7} />
    </div>
  );
}
