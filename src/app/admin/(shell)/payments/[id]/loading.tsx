import { Skeleton } from "@/components/ui/skeleton";

/** Header, action strip, then the two-column card layout of the real page. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-full max-w-xl" />
      </div>

      <div className="surface space-y-3 p-4">
        <Skeleton className="h-8 w-full max-w-2xl" />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="surface space-y-3 p-4">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="surface space-y-2 p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
