import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the detail layout - header, thread on the left, sidebar on the right - so nothing jumps on load. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-3 w-48" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <div className="surface space-y-2 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <div className="ml-6 space-y-2 rounded-md border p-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-full" />
          </div>
          <div className="surface space-y-3 p-4">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
        <div className="space-y-4">
          {[0, 1, 2].map((panel) => (
            <div key={panel} className="surface space-y-2 p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
