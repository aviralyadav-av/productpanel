import { cn } from "cn";
import type { LucideIcon } from "lucide-react";

/**
 * Empty states say what would appear here and what to do about it. "No data"
 * tells the operator nothing; "No orders yet - the storefront does not send
 * them to the server" tells them whether something is broken.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-1.5 px-4 py-8" : "gap-2 px-6 py-14",
        className,
      )}
    >
      {Icon ? (
        <div className="bg-muted text-muted-foreground mb-1 flex size-9 items-center justify-center rounded-full">
          <Icon className="size-4" />
        </div>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="text-muted-foreground max-w-sm text-xs leading-relaxed">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
