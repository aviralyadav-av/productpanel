import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the page shape - header, tab strip, generated form - so nothing jumps. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-full max-w-xl" />
      </div>
      <Skeleton className="h-9 w-full" />
      <div className="surface grid gap-4 p-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="space-y-1.5">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
