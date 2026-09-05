import Link from "next/link";
import type { Route } from "next";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "cn";

import { formatPercent } from "@/lib/money";

export type StatDelta = {
  value: number;
  direction: "up" | "down" | "flat";
} | null;

/**
 * A KPI tile. Deliberately quiet: a label, a number, and one line of context.
 * No gradient, no oversized icon, no coloured card background - at six tiles
 * across, decoration is what stops you reading the numbers.
 *
 * `higherIsBetter` exists because "cancellations up 20%" is bad news and must
 * not render green.
 */
export function StatCard({
  label,
  value,
  delta,
  comparisonLabel = "vs previous period",
  hint,
  href,
  higherIsBetter = true,
  className,
}: {
  label: string;
  value: string;
  delta?: StatDelta;
  comparisonLabel?: string;
  hint?: string;
  href?: Route;
  higherIsBetter?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-medium">
          {label}
        </span>
        {href ? (
          <ArrowRight className="text-muted-foreground/50 size-3.5 transition-transform group-hover:translate-x-0.5" />
        ) : null}
      </div>

      <div
        data-numeric
        className="mt-2 text-2xl font-semibold tracking-tight"
      >
        {value}
      </div>

      <div className="mt-1.5 flex min-h-4 items-center gap-1.5 text-xs">
        {delta ? <DeltaChip delta={delta} higherIsBetter={higherIsBetter} /> : null}
        <span className="text-muted-foreground truncate">
          {delta ? comparisonLabel : (hint ?? "")}
        </span>
      </div>
    </>
  );

  const classes = cn(
    "surface group block p-4 transition-colors",
    href && "hover:bg-accent/50",
    className,
  );

  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

function DeltaChip({
  delta,
  higherIsBetter,
}: {
  delta: NonNullable<StatDelta>;
  higherIsBetter: boolean;
}) {
  if (delta.direction === "flat") {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-0.5">
        <Minus className="size-3" />
        <span data-numeric>0%</span>
      </span>
    );
  }

  const isGood =
    delta.direction === "up" ? higherIsBetter : !higherIsBetter;
  const Icon = delta.direction === "up" ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-medium",
        isGood ? "text-success" : "text-destructive",
      )}
    >
      <Icon className="size-3" />
      <span data-numeric>{formatPercent(Math.abs(delta.value))}</span>
    </span>
  );
}
