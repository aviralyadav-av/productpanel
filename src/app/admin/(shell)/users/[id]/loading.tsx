import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the detail layout - header, form column, side column - so nothing jumps. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-3 w-full max-w-xl" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, section) => (
            <div
              key={section}
              className="surface grid gap-4 p-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8"
            >
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-3 w-40" />
              </div>
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, row) => (
                  <div key={row} className="space-y-1.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    </div>
  );
}
