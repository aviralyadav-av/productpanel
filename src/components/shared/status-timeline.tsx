import type { LucideIcon } from "lucide-react";
import { Lock } from "lucide-react";
import { cn } from "cn";

import type { BadgeTone } from "@/lib/enums";
import { formatIstDateTime } from "@/lib/dates";

export type TimelineEvent = {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  at: Date;
  actor?: string | null;
  tone?: BadgeTone;
  icon?: LucideIcon;
  /** Staff-only notes. Rendered with a lock so nobody pastes them to a customer. */
  isInternal?: boolean;
};

const ICON_TONE: Record<BadgeTone, string> = {
  neutral: "text-muted-foreground",
  brand: "text-brand",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
};

const DOT_TONE: Record<BadgeTone, string> = {
  neutral: "bg-muted-foreground/50",
  brand: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
};

/**
 * The history column on order, return, payout and seller detail pages: one
 * entry per status change or note, newest first by default because the most
 * recent event is the one the operator is checking on.
 *
 * Server-compatible; timestamps render in IST.
 */
export function StatusTimeline({
  events,
  order = "desc",
  emptyText = "No activity yet.",
  className,
}: {
  events: TimelineEvent[];
  order?: "asc" | "desc";
  emptyText?: string;
  className?: string;
}) {
  const sorted = [...events].sort((a, b) =>
    order === "desc" ? b.at.getTime() - a.at.getTime() : a.at.getTime() - b.at.getTime(),
  );

  if (sorted.length === 0) {
    return <p className={cn("text-muted-foreground px-4 py-6 text-center text-xs", className)}>{emptyText}</p>;
  }

  return (
    <ol className={cn("relative flex flex-col", className)} aria-label="Activity">
      {sorted.map((event, index) => {
        const Icon = event.icon;
        const tone = event.tone ?? "neutral";
        const isLast = index === sorted.length - 1;
        return (
          <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
            {!isLast ? (
              <span aria-hidden className="bg-border absolute top-5 bottom-0 left-[9px] w-px" />
            ) : null}
            <span
              aria-hidden
              className={cn(
                "bg-card relative z-10 mt-0.5 flex size-[19px] shrink-0 items-center justify-center rounded-full border",
              )}
            >
              {Icon ? (
                <Icon className={cn("size-3", ICON_TONE[tone])} />
              ) : (
                <span className={cn("size-2 rounded-full", DOT_TONE[tone])} />
              )}
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  {event.title}
                  {event.isInternal ? (
                    <span
                      className="text-muted-foreground inline-flex items-center gap-0.5 text-[10px] font-normal"
                      title="Internal note - not visible to the customer"
                    >
                      <Lock className="size-2.5" />
                      Internal
                    </span>
                  ) : null}
                </p>
                <time
                  dateTime={event.at.toISOString()}
                  data-numeric
                  className="text-muted-foreground text-[11px] whitespace-nowrap"
                >
                  {formatIstDateTime(event.at)}
                </time>
              </div>
              {event.description ? (
                <div className="text-muted-foreground text-xs leading-relaxed">{event.description}</div>
              ) : null}
              {event.actor ? (
                <p className="text-muted-foreground/80 text-[11px]">by {event.actor}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
