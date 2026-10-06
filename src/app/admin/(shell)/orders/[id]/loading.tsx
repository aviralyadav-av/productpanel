import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the two-column detail layout so nothing jumps when the order lands. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-72" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          {[220, 160, 140, 160].map((height, index) => (
            <div key={index} className="surface space-y-3 p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="w-full" style={{ height }} />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {[200, 140, 160].map((height, index) => (
            <div key={index} className="surface space-y-3 p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="w-full" style={{ height }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
