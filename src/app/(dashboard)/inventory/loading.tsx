import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the real page shape - header, five KPI tiles, toolbar, table - so
 * the layout does not jump when the data arrives.
 */
export default function InventoryLoading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-[28rem] max-w-full" />
          <Skeleton className="h-3 w-[22rem] max-w-full" />
        </div>
        <Skeleton className="h-8 w-56 rounded-lg" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="surface space-y-2 p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-56 rounded-lg" />
        <Skeleton className="h-8 w-44 rounded-lg" />
      </div>

      <div className="surface overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-48" />
        </div>

        <div className="divide-y">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 px-4 py-2.5">
              <Skeleton className="size-7 shrink-0 rounded" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-2.5 w-2/5" />
                <Skeleton className="h-2 w-1/5" />
              </div>
              <Skeleton className="h-2.5 w-8" />
              <Skeleton className="h-2.5 w-8" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-md" />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t px-4 py-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </div>
  );
}
