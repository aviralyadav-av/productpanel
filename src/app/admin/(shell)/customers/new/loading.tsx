import { Skeleton } from "@/components/ui/skeleton";

/** Header plus three form sections, matching the create form's shape. */
export default function NewCustomerLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-full max-w-2xl" />
      </div>
      {Array.from({ length: 3 }).map((_, index) => (
        <Skeleton key={index} className="h-48 rounded-lg" />
      ))}
    </div>
  );
}
