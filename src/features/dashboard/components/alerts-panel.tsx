import Link from "next/link";
import { CheckCircle2, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "cn";

import type { DashboardAlert } from "@/features/dashboard/queries";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

const ICON = {
  critical: OctagonAlert,
  warning: TriangleAlert,
  info: Info,
} as const;

const TONE = {
  critical: "text-destructive",
  warning: "text-warning",
  info: "text-info",
} as const;

/**
 * Ordered by severity, capped at what fits without scrolling. An alert list
 * that needs scrolling stops being read.
 */
export function AlertsPanel({ alerts }: { alerts: DashboardAlert[] }) {
  if (alerts.length === 0) {
    return (
      <EmptyState
        compact
        icon={CheckCircle2}
        title="Nothing needs attention"
        description="Stock levels, order ages, pricing and content all check out."
      />
    );
  }

  return (
    <ul className="divide-y">
      {alerts.map((alert) => {
        const Icon = ICON[alert.severity];
        return (
          <li
            key={alert.id}
            className="flex items-start gap-2.5 px-4 py-3 first:pt-3.5"
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[alert.severity])} />

            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium leading-snug">{alert.title}</p>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {alert.detail}
              </p>
            </div>

            <Button asChild variant="ghost" size="xs" className="shrink-0">
              <Link href={alert.href as never}>{alert.actionLabel}</Link>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
