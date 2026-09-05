import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the real layout - header, toolbar, table - so the page does not
 * reflow when the data lands. A spinner in the middle of the screen would tell
 * the operator less and move more.
 */
export default function ProductsLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-full max-w-2xl" />
        <Skeleton className="h-7 w-56 rounded-lg" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-72 rounded-lg" />
        <Skeleton className="h-7 w-44 rounded-lg" />
        <Skeleton className="h-7 w-32 rounded-lg" />
        <Skeleton className="ml-auto h-7 w-28 rounded-lg" />
      </div>

      <div className="surface overflow-hidden">
        <div className="flex items-center gap-3 border-b px-4 py-2">
          <Skeleton className="h-3 w-full max-w-md" />
        </div>

        <div className="divide-y">
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 px-4 py-2.5">
              <Skeleton className="size-9 shrink-0 rounded" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-2.5 w-2/5" />
                <Skeleton className="h-2 w-1/5" />
              </div>
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-2.5 w-14" />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t px-4 py-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    </div>
  );
}
