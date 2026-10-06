import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** Mirrors /admin/commissions: header, three cards, rules table, summary. */
export default function CommissionsLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3 w-full max-w-xl" />
        </div>
        <Skeleton className="h-7 w-24" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="surface space-y-3 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ))}
      </div>

      <div className="surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <Skeleton className="h-8 w-full sm:w-64" />
          <Skeleton className="h-8 w-72" />
        </div>
        <TableSkeleton rows={8} columns={9} className="rounded-none border-0" />
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="surface space-y-2 p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
