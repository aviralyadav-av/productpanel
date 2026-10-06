import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** Mirrors the page shape - header, KPI strip, banner, table - so nothing jumps. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-3 w-full max-w-2xl" />
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-28" />
      <TableSkeleton rows={8} columns={6} />
    </div>
  );
}
