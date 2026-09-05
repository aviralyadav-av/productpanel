import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the settled layout - header, tab strip, then two columns of panels -
 * so the page does not jump around when the data lands.
 */
export default function SettingsLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3 w-96 max-w-full" />
        </div>
        <Skeleton className="h-7 w-72 rounded-lg" />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <PanelSkeleton key={index} rows={index % 2 === 0 ? 4 : 3} />
        ))}
      </div>
    </div>
  );
}

function PanelSkeleton({ rows }: { rows: number }) {
  return (
    <section className="surface overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>

      <div className="divide-y">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="flex items-start justify-between gap-6 px-4 py-3"
          >
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-2.5 w-full max-w-64" />
            </div>
            <Skeleton className="h-8 w-40 shrink-0" />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end border-t px-4 py-2">
        <Skeleton className="h-7 w-28" />
      </div>
    </section>
  );
}
