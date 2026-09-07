import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the settled layout - header, tab strip, then a single tall panel of
 * rows - so the page does not jump when the data lands.
 */
export default function ContentLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3 w-[28rem] max-w-full" />
        </div>
        <Skeleton className="h-7 w-96 max-w-full rounded-lg" />
      </div>

      <section className="surface divide-y overflow-hidden">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 px-3 py-2.5">
            <Skeleton className="size-7 shrink-0 rounded" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-2.5 w-full max-w-96" />
            </div>
            <Skeleton className="h-3 w-16 shrink-0" />
            <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
          </div>
        ))}
      </section>
    </div>
  );
}
