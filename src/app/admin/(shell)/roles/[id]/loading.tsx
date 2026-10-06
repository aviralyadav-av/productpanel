import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the editor layout - header, form, users column - so nothing jumps. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-3 w-full max-w-lg" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <div className="surface grid gap-3 p-4 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-32 w-full" />
            ))}
          </div>
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
