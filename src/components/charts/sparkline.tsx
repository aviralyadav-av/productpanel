"use client";

import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { cn } from "cn";

import { formatValue, seriesColor, type ValueFormat } from "./chart-utils";

/**
 * A wordless trend line for KPI tiles and table cells: no axes, no grid, no
 * tooltip - just the shape of the last N points. Anything that needs to be
 * *read* rather than glanced at belongs in TimeSeriesChart. The sr-only text
 * gives the first, last and peak values so it is not an empty picture to a
 * screen reader.
 *
 * @example
 *   <Sparkline values={last14Days} valueFormat="money" />
 */
export function Sparkline({
  values,
  valueFormat = "number",
  width = 96,
  height = 28,
  color,
  className,
  label,
}: {
  values: number[];
  valueFormat?: ValueFormat;
  width?: number | string;
  height?: number;
  color?: string;
  className?: string;
  /** What the series is, for the sr-only summary. */
  label?: string;
}) {
  if (values.length < 2) {
    return (
      <span
        aria-hidden
        className={cn("bg-border/60 inline-block h-px", className)}
        style={{ width }}
      />
    );
  }

  const data = values.map((value, index) => ({ index, value }));
  const first = values[0];
  const last = values[values.length - 1];
  const peak = Math.max(...values);
  const trend = last > first ? "up" : last < first ? "down" : "flat";
  const stroke = color ?? seriesColor(0);

  return (
    <figure className={cn("m-0 inline-block align-middle", className)} style={{ width, height }}>
      <figcaption className="sr-only">
        {label ? `${label}: ` : ""}
        {values.length} points, {trend}, from {formatValue(first, valueFormat)} to{" "}
        {formatValue(last, valueFormat)}, peak {formatValue(peak, valueFormat)}.
      </figcaption>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          {/* Fit the line to the data's own range; a sparkline is about shape. */}
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}
