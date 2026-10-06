import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the real layout - header, folder column, toolbar, drop zone, tile
 * grid - so nothing jumps when the data lands.
 */
export default function MediaLoading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-full max-w-xl" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-7 w-24 rounded-lg" />
          <Skeleton className="h-7 w-20 rounded-lg" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="surface hidden space-y-1.5 p-2 lg:block">
          <Skeleton className="h-7 w-full rounded-md" />
          <Skeleton className="h-7 w-full rounded-md" />
          <Skeleton className="mt-3 h-2.5 w-16" />
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-7 rounded-md" style={{ width: `${88 - (index % 3) * 10}%`, marginLeft: index % 3 === 0 ? 0 : 12 }} />
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-8 w-72 rounded-lg" />
            <Skeleton className="h-7 w-32 rounded-lg" />
            <Skeleton className="ml-auto h-7 w-28 rounded-lg" />
            <Skeleton className="h-7 w-16 rounded-lg" />
          </div>

          <Skeleton className="h-12 w-full rounded-lg" />

          <div className="surface overflow-hidden">
            <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {Array.from({ length: 18 }).map((_, index) => (
                <div key={index} className="overflow-hidden rounded-lg border">
                  <Skeleton className="aspect-square w-full rounded-none" />
                  <div className="space-y-1.5 border-t px-2 py-2">
                    <Skeleton className="h-2.5 w-4/5" />
                    <Skeleton className="h-2 w-2/5" />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t px-4 py-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
