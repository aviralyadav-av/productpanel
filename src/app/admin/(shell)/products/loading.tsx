import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** Mirrors the list layout - header, KPI strip, toolbar, table - so nothing reflows when data lands. */
export default function ProductsLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-full max-w-2xl" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-lg" />
        ))}
      </div>
      <div className="surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-7 w-72 rounded-lg" />
          <Skeleton className="ml-auto h-7 w-28 rounded-lg" />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-8 w-48" />
        </div>
        <TableSkeleton rows={10} columns={8} showHeader={false} />
      </div>
    </div>
  );
}
