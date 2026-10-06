import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the form page: header and three form sections. */
export default function SellerNewLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-full max-w-xl" />
      </div>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="surface grid gap-4 p-4 lg:grid-cols-[16rem_1fr]">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-40" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
