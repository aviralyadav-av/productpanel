import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** Header, tab strip, KPI row and a table - the overview tab's shape. */
export default function CustomerDetailLoading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3 w-72" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-7 w-20" />
        </div>
      </div>
      <Skeleton className="h-10 w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-lg" />
        ))}
      </div>
      <div className="surface overflow-hidden">
        <TableSkeleton rows={5} columns={6} />
      </div>
    </div>
  );
}
