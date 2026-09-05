import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import { cn } from "cn";

/**
 * The one section container used across the app: a bordered surface with a
 * compact header. Shadows are avoided deliberately - at this density they
 * create visual noise between adjacent panels, and a 1px border reads cleaner
 * in both light and dark themes.
 */
export function Panel({
  title,
  description,
  action,
  viewAllHref,
  viewAllLabel = "View all",
  className,
  bodyClassName,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  viewAllHref?: Route;
  viewAllLabel?: string;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("surface flex flex-col overflow-hidden", className)}>
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-xs font-semibold tracking-tight">
            {title}
          </h2>
          {description ? (
            <p className="text-muted-foreground truncate text-[11px]">
              {description}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {action}
          {viewAllHref ? (
            <Link
              href={viewAllHref}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-xs transition-colors"
            >
              {viewAllLabel}
              <ArrowRight className="size-3" />
            </Link>
          ) : null}
        </div>
      </header>

      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}
