import { cn } from "cn";

import type { BadgeTone } from "@/lib/enums";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  brand: "bg-brand text-brand-foreground",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  danger: "bg-destructive text-destructive-foreground",
  info: "bg-info text-info-foreground",
};

/**
 * A small numeric pill for tab labels, nav items and section headers
 * ("Pending reviews 12"). Hidden at zero unless `showZero`, and capped at
 * `max` with a plus so a runaway queue does not stretch the sidebar.
 *
 * Server-compatible.
 */
export function CountBadge({
  count,
  tone = "neutral",
  max = 99,
  showZero = false,
  className,
  label,
}: {
  count: number;
  tone?: BadgeTone;
  max?: number;
  showZero?: boolean;
  className?: string;
  /** Screen-reader text, e.g. "12 pending reviews". */
  label?: string;
}) {
  if (count === 0 && !showZero) return null;
  const text = count > max ? `${max}+` : String(count);

  return (
    <span
      data-numeric
      aria-label={label}
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold",
        TONE[tone],
        className,
      )}
    >
      {text}
    </span>
  );
}
