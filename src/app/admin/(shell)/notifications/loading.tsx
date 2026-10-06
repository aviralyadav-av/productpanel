import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** Mirrors the page shape - header, then content - so nothing jumps on load. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-full max-w-xl" />
      </div>
      <TableSkeleton rows={8} columns={5} />
    </div>
  );
}
