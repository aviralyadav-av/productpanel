import { cn } from "cn";

import { formatNumber, formatPaise } from "@/lib/money";

import type { ReportTotal } from "../types";

/**
 * The totals strip above a report's table.
 *
 * These are totals for the WHOLE range, not the page on screen: "revenue in
 * September" must not change because the operator clicked to page two. Each
 * report decides which of its columns are worth totalling; money, counts and
 * shares each get their own formatting so a percentage never renders as
 * rupees.
 */

export function formatTotal(total: ReportTotal): string {
  switch (total.type) {
    case "money":
      return formatPaise(total.value);
    case "percent":
      return `${total.value.toFixed(1)}%`;
    default:
      return formatNumber(total.value);
  }
}

export function ReportTotals({ totals, className }: { totals: readonly ReportTotal[]; className?: string }) {
  if (totals.length === 0) return null;

  return (
    <dl
      className={cn(
        "surface grid grid-cols-2 divide-x divide-y sm:grid-cols-3 lg:grid-cols-6 [&>div]:border-0",
        className,
      )}
    >
      {totals.map((total) => (
        <div key={total.key} className="min-w-0 px-4 py-3">
          <dt className="text-muted-foreground truncate text-xs font-medium" title={total.hint}>
            {total.label}
          </dt>
          <dd data-numeric className="mt-1 truncate text-lg font-semibold tracking-tight">
            {formatTotal(total)}
          </dd>
          {total.hint ? (
            <p className="text-muted-foreground/80 mt-0.5 truncate text-[11px]">{total.hint}</p>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
