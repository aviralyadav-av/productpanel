import Link from "next/link";
import type { Route } from "next";
import { CheckCircle2, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "cn";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import type { BadgeTone } from "@/lib/enums";
import { formatNumber } from "@/lib/money";

import type { DashboardAlert } from "../types";

const ICON: Partial<Record<BadgeTone, typeof Info>> = {
  danger: OctagonAlert,
  warning: TriangleAlert,
  info: Info,
};

const TONE: Partial<Record<BadgeTone, string>> = {
  danger: "text-destructive",
  warning: "text-warning",
  info: "text-info",
};

/**
 * The "needs attention" queue: computed live, never stored, so it cannot go
 * stale, and every row names a number and the screen that clears it.
 *
 * Alerts whose count is zero are dropped upstream (dashboardAlerts), and
 * alerts whose link the actor cannot open are dropped by the caller (D14) -
 * telling someone that payouts are waiting when they cannot open /admin/payouts
 * is noise they can do nothing about.
 */
export function AlertsPanel({ alerts }: { alerts: readonly DashboardAlert[] }) {
  if (alerts.length === 0) {
    return (
      <EmptyState
        compact
        icon={CheckCircle2}
        title="Nothing needs attention"
        description="Stock, approvals, payments, returns and background jobs all check out."
      />
    );
  }

  return (
    <ul className="divide-y">
      {alerts.map((alert) => {
        const Icon = ICON[alert.tone] ?? Info;
        return (
          <li key={alert.key} className="flex items-start gap-2.5 px-4 py-3">
            <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[alert.tone] ?? "text-muted-foreground")} />

            <div className="min-w-0 flex-1">
              <p className="text-xs leading-snug font-medium">
                <span data-numeric>{formatNumber(alert.count)}</span> · {alert.title}
              </p>
              <p className="text-muted-foreground mt-0.5 truncate text-[11px]">{alert.detail}</p>
            </div>

            <Button asChild variant="ghost" size="xs" className="shrink-0">
              <Link href={alert.href as Route}>{alert.actionLabel}</Link>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
