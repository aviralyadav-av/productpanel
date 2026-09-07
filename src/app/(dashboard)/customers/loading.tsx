import { Skeleton } from "@/components/ui/skeleton";

/**
 * The skeleton mirrors the real page's block sizes so nothing jumps when the
 * data lands: header, four KPI tiles, a toolbar row, then the table surface.
 */
export default function CustomersLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-full max-w-2xl" />
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="surface space-y-2 p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-full sm:w-64" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-44" />
      </div>

      <div className="surface overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-48" />
        </div>

        <div className="divide-y">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 px-4 py-2.5">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-48" />
              <Skeleton className="ml-auto h-3 w-16" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-16 rounded-full" />
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
