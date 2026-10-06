import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** Mirrors the statement page: header, stepper, three cards, entries table. */
export default function PayoutDetailLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-32" />

      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-full max-w-md" />
        </div>
        <Skeleton className="h-7 w-56" />
      </div>

      <div className="surface space-y-3 p-4">
        <Skeleton className="h-8 w-full" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="surface space-y-2 p-4">
            <Skeleton className="h-4 w-24" />
            {Array.from({ length: 5 }).map((__, row) => (
              <Skeleton key={row} className="h-3.5 w-full" />
            ))}
          </div>
        ))}
      </div>

      <div className="surface overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-7 w-28" />
        </div>
        <TableSkeleton rows={8} columns={6} className="rounded-none border-0" />
      </div>
    </div>
  );
}
