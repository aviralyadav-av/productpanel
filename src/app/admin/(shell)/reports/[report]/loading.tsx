import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** Header, filter strip, totals, chart, table - the same blocks the report renders. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-full max-w-2xl" />
      </div>

      <div className="surface flex flex-wrap items-center gap-2 px-4 py-3">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="ml-auto h-8 w-24" />
      </div>

      <div className="surface grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="space-y-2 px-4 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-24" />
          </div>
        ))}
      </div>

      <div className="surface p-4">
        <Skeleton className="h-56 w-full" />
      </div>

      <TableSkeleton rows={10} columns={6} />
    </div>
  );
}
