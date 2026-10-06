import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the A4 invoice sheet so the print layout does not shift on load. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-7 w-28" />
      </div>
      <div className="surface mx-auto w-full max-w-4xl space-y-6 p-8">
        <div className="flex items-start justify-between gap-6 border-b pb-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-3 w-44" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-40 w-full" />
        <div className="flex justify-end">
          <Skeleton className="h-32 w-full max-w-xs" />
        </div>
      </div>
    </div>
  );
}
