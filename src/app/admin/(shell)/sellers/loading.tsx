import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** Mirrors the list page: header, five KPI tiles, toolbar, table. */
export default function SellersLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-full max-w-xl" />
        </div>
        <Skeleton className="h-7 w-28" />
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="surface space-y-2 p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <Skeleton className="h-8 w-full sm:w-64" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="ml-auto h-8 w-20" />
        </div>
        <TableSkeleton rows={10} columns={8} className="rounded-none border-0" />
      </div>
    </div>
  );
}
