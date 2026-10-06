import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the settled layout - header, menu switcher, tree beside the preview - so nothing jumps. */
export default function NavigationLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-[32rem] max-w-full" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-7 w-24 rounded-md" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="surface space-y-2 p-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3" style={{ paddingLeft: (index % 3) * 24 }}>
              <Skeleton className="size-4 shrink-0 rounded" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-2.5 w-64 max-w-full" />
              </div>
              <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
            </div>
          ))}
        </section>
        <aside className="surface space-y-2 p-3">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-40 w-full rounded-md" />
        </aside>
      </div>
    </div>
  );
}
