import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the real layout rather than showing a spinner, so the page does not
 * jump when the query resolves.
 */
export default function OrdersLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-3 w-full max-w-xl" />
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="surface space-y-3 p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-2.5 w-32" />
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-full sm:w-72" />
          <Skeleton className="h-7 w-64 sm:ml-auto" />
        </div>
        <Skeleton className="h-7 w-full max-w-2xl" />
        <Skeleton className="h-7 w-full max-w-xl" />
      </div>

      <div className="surface overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>

        <div className="divide-y">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 px-4 py-2.5">
              <Skeleton className="h-3 w-28 shrink-0" />
              <Skeleton className="h-3 w-24 shrink-0" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-4 w-20 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-20 shrink-0 rounded-full" />
              <Skeleton className="h-3 w-16 shrink-0" />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t px-4 py-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-5 w-24" />
        </div>
      </div>
    </div>
  );
}
