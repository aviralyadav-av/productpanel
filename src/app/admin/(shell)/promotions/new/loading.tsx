import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the form page shape - header, then two form sections - so nothing jumps on load. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-full max-w-xl" />
      </div>
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
