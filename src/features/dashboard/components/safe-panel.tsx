import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/error-state";

/**
 * Per-widget failure isolation for the dashboard (task requirement 6).
 *
 * The dashboard fans out to fifteen or so independent aggregates. Without a
 * boundary per widget, one slow or broken query - a report metric that throws
 * on an odd range, a table a migration has not reached yet - would take the
 * whole page down and hide the fourteen numbers that were fine. So every
 * panel body is a Suspense island (the page supplies the fallback) and the
 * fetch itself runs inside SafePanel, which turns a rejection into an
 * ErrorState of roughly the panel's height.
 *
 * `children` is a render callback rather than an element because the data has
 * to be awaited before anything can be rendered with it; both sides of the
 * call are Server Components, so passing a function is free.
 */
export async function SafePanel<T>({
  load,
  label,
  children,
}: {
  load: () => Promise<T>;
  /** Named in the error text so an operator can report which widget failed. */
  label: string;
  children: (data: T) => React.ReactNode;
}) {
  let data: T;
  try {
    data = await load();
  } catch (error) {
    // Logged rather than swallowed: the operator sees a tidy message, the
    // server log keeps the stack that explains it.
    console.error(`[dashboard] ${label} failed`, error);
    return (
      <ErrorState
        compact
        title={`${label} could not be loaded`}
        description="The rest of the dashboard is unaffected. Reload the page to try this widget again."
      />
    );
  }
  return <>{children(data)}</>;
}

/** Fallback for a chart panel: same height as the plot, so nothing jumps. */
export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return (
    <div className="p-3">
      <Skeleton className="w-full" style={{ height }} />
    </div>
  );
}

/** Fallback for a list panel. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-2.5">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-2.5 w-2/5" />
            <Skeleton className="h-2 w-1/4" />
          </div>
          <Skeleton className="h-2.5 w-12" />
        </div>
      ))}
    </div>
  );
}

/** Fallback for the KPI strip. */
export function KpiSkeleton({ tiles = 12 }: { tiles?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
      {Array.from({ length: tiles }).map((_, index) => (
        <div key={index} className="surface space-y-2 p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
