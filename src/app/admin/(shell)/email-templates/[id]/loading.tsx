import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the editor: header, message fields, body column plus the side rail. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-52" />
        <Skeleton className="h-3 w-full max-w-xl" />
      </div>
      <Skeleton className="h-40" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <Skeleton className="h-96" />
          <Skeleton className="h-56" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-80" />
        </div>
      </div>
    </div>
  );
}
