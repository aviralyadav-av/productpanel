import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors a sheet of packing slips so the page does not jump when they land. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-7 w-24" />
      </div>
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="surface space-y-4 p-6">
          <div className="flex items-start justify-between gap-4 border-b pb-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
    </div>
  );
}
