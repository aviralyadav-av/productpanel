import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the manual order form: the long left column, the summary rail. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-full max-w-2xl" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          {[120, 220, 90, 260, 120].map((height, index) => (
            <div key={index} className="surface space-y-3 p-4">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="w-full" style={{ height }} />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {[100, 90, 140, 160].map((height, index) => (
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
