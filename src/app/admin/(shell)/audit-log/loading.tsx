import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** Mirrors the page shape - header, toolbar, table - so nothing jumps on load. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-full max-w-2xl" />
      </div>
      <TableSkeleton rows={12} columns={6} />
    </div>
  );
}
