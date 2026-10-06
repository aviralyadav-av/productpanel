import Link from "next/link";
import type { Route } from "next";
import { cn } from "cn";

/**
 * A dense table is the right tool on a desk and the wrong one on a phone,
 * where a 9-column row becomes a horizontal scroll with the title off-screen.
 * Pages render both and let CSS choose: the table from `md` up, a stack of
 * cards below it. Both are rendered on the server, so there is no viewport
 * detection and no hydration flash.
 *
 * Cards are the page's responsibility (they know what matters per row);
 * MobileCard gives them a consistent shell.
 *
 * @example
 *   <ResponsiveTable
 *     table={<DataTable>...</DataTable>}
 *     cards={rows.map((row) => (
 *       <MobileCard key={row.id} title={row.title} meta={<OrderStatusBadge status={row.status} />}>
 *         <MobileCardField label="Total" numeric>{formatPaise(row.totalPaise)}</MobileCardField>
 *       </MobileCard>
 *     ))}
 *   />
 */
export function ResponsiveTable({
  table,
  cards,
  className,
}: {
  table: React.ReactNode;
  cards: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="hidden md:block">{table}</div>
      <div className="flex flex-col divide-y md:hidden">{cards}</div>
    </div>
  );
}

export function MobileCard({
  title,
  subtitle,
  meta,
  children,
  href,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned slot for a status badge or amount. */
  meta?: React.ReactNode;
  children?: React.ReactNode;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          {subtitle ? (
            <p className="text-muted-foreground truncate text-xs">{subtitle}</p>
          ) : null}
        </div>
        {meta ? <div className="shrink-0">{meta}</div> : null}
      </div>
      {children ? (
        <div className="text-muted-foreground mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {children}
        </div>
      ) : null}
    </>
  );
  const classes = cn("block px-4 py-3", href && "hover:bg-accent/40", className);
  return href ? (
    <Link href={href as Route} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

/** A label/value pair inside a MobileCard's grid. */
export function MobileCardField({
  label,
  children,
  numeric,
}: {
  label: string;
  children: React.ReactNode;
  numeric?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground/80 text-[10px] uppercase tracking-wide">
        {label}
      </span>
      <span data-numeric={numeric ? "" : undefined} className="text-foreground truncate">
        {children}
      </span>
    </div>
  );
}
