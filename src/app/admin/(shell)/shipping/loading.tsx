import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** Mirrors the page shape - header, tab strip, toolbar, table - so nothing jumps on load. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-full max-w-xl" />
        <Skeleton className="h-7 w-72 rounded-lg" />
      </div>
      <div className="surface">
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="ml-auto h-7 w-24" />
        </div>
        <TableSkeleton rows={8} columns={7} showHeader />
      </div>
    </div>
  );
}
