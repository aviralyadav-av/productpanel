"use client";

import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";
import { cn } from "cn";

import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { ChartDataTable, ChartFrame } from "./chart-frame";
import { formatValue, seriesColor, type ValueFormat } from "./chart-utils";

export type DonutDatum = { key: string; label: string; value: number; color?: string };

/**
 * Share of a whole across a FEW parts: payment methods, order status mix,
 * traffic by source. Five slices is the ceiling (that is how many chart
 * tokens exist and how many a reader can match to a legend); fold the tail
 * into "Other" before it gets here.
 *
 * The legend is a list with values and percentages beside the ring rather
 * than labels on the slices, because thin slices cannot hold text and a
 * donut without numbers is decoration.
 *
 * @example
 *   <DonutChart data={byMethod} valueFormat="money" centerLabel="Paid" />
 */
export function DonutChart({
  data,
  valueFormat = "number",
  height = 200,
  title,
  centerLabel,
  className,
}: {
  data: DonutDatum[];
  valueFormat?: ValueFormat;
  height?: number;
  title?: string;
  /** Word under the total in the ring's centre, e.g. "orders". */
  centerLabel?: string;
  className?: string;
}) {
  const config = React.useMemo(() => {
    const out: Record<string, { label: string; color: string }> = {};
    data.forEach((item, index) => {
      out[item.key] = { label: item.label, color: seriesColor(index, item.color) };
    });
    return out;
  }, [data]);

  const total = data.reduce((sum, row) => sum + row.value, 0);
  const isEmpty = data.length === 0 || total === 0;
  const summary = isEmpty
    ? "No data."
    : `Total ${formatValue(total, valueFormat)} across ${data.length} parts: ${data
        .map((row) => `${row.label} ${percent(row.value, total)}`)
        .join(", ")}.`;

  return (
    <ChartFrame
      title={title}
      summary={summary}
      height={height}
      isEmpty={isEmpty}
      className={className}
      table={
        <ChartDataTable
          headers={["Part", title ?? "Value", "Share"]}
          rows={data.map((row) => [row.label, formatValue(row.value, valueFormat), percent(row.value, total)])}
        />
      }
    >
      <div className="flex flex-col items-center gap-4 sm:flex-row" style={{ minHeight: height }}>
        <div className="relative shrink-0" style={{ width: height, height }}>
          <ChartContainer config={config} className="aspect-square h-full w-full">
            <PieChart accessibilityLayer>
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    hideLabel
                    formatter={(value, name) => (
                      <div className="flex w-full items-center justify-between gap-3">
                        <span className="text-muted-foreground">{config[String(name)]?.label ?? name}</span>
                        <span data-numeric className="text-foreground font-medium">
                          {formatValue(Number(value), valueFormat)}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <Pie
                data={data}
                dataKey="value"
                nameKey="key"
                innerRadius="68%"
                outerRadius="100%"
                paddingAngle={2}
                cornerRadius={3}
                stroke="var(--background)"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {data.map((item, index) => (
                  <Cell key={item.key} fill={seriesColor(index, item.color)} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"
          >
            <span data-numeric className="text-base font-semibold tracking-tight">
              {formatValue(total, valueFormat === "money" ? "money" : valueFormat)}
            </span>
            {centerLabel ? (
              <span className="text-muted-foreground text-[10px] uppercase tracking-wide">{centerLabel}</span>
            ) : null}
          </div>
        </div>

        <ul className="flex w-full min-w-0 flex-col gap-1.5 text-xs" aria-hidden>
          {data.map((item, index) => (
            <li key={item.key} className="flex items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: seriesColor(index, item.color) }}
              />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <span data-numeric className={cn("text-foreground font-medium")}>
                {formatValue(item.value, valueFormat)}
              </span>
              <span data-numeric className="text-muted-foreground w-10 text-right">
                {percent(item.value, total)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ChartFrame>
  );
}

function percent(value: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((value / total) * 1000) / 10}%`;
}
