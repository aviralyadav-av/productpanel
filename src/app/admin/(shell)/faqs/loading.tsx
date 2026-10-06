import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the board: header, toolbar, then two group cards of questions. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-full max-w-xl" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-72" />
      </div>
      {[0, 1].map((group) => (
        <div key={group} className="surface overflow-hidden">
          <div className="bg-muted/40 border-b px-3 py-2">
            <Skeleton className="h-3.5 w-40" />
          </div>
          <div className="divide-y">
            {[0, 1, 2].map((row) => (
              <div key={row} className="space-y-2 px-3 py-3">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-full max-w-lg" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
