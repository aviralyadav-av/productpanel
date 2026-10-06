import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartSkeleton,
  KpiSkeleton,
  ListSkeleton,
} from "@/features/dashboard/components/safe-panel";

/**
 * Mirrors the real layout - header, KPI strip, a wide chart beside a narrow
 * panel, then the list rows - so the page does not reflow as the widgets
 * resolve. It uses the same skeleton pieces the page passes to its Suspense
 * boundaries, which is what keeps the two in step when the layout changes.
 */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>

      <KpiSkeleton />

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="surface xl:col-span-2">
          <ChartSkeleton height={230} />
        </div>
        <div className="surface">
          <ListSkeleton rows={5} />
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="surface xl:col-span-2">
          <ChartSkeleton height={230} />
        </div>
        <div className="surface">
          <ChartSkeleton height={200} />
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="surface">
            <ChartSkeleton height={200} />
          </div>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="surface xl:col-span-2">
          <ListSkeleton rows={8} />
        </div>
        <div className="surface">
          <ListSkeleton rows={6} />
        </div>
      </div>
    </div>
  );
}
