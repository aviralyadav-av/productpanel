"use client";

import * as React from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { ChartDataTable, ChartFrame } from "./chart-frame";
import {
  configFromSeries,
  formatAxisValue,
  formatValue,
  formatXLabel,
  seriesColor,
  summarise,
  type Series,
  type ValueFormat,
} from "./chart-utils";

/**
 * Lines over time: revenue per day, orders per week, sign-ups per month.
 *
 * One y-axis, always. Two measures on different scales (revenue and order
 * count) are two charts side by side, never a dual axis - it is the most
 * common way to make a chart lie. Lines are 2px with no per-point dots (the
 * hover dot appears on demand) so five series stay legible at 200px tall.
 *
 * `data` rows are `{ [xKey]: string, [series.key]: number }`; gaps should be
 * filled with zeros upstream (dayKeysInRange) so the line does not bridge
 * missing days.
 *
 * @example
 *   <TimeSeriesChart series={[{ key: "revenuePaise", label: "Revenue" }]} data={rows} valueFormat="money" height={220} />
 */
export function TimeSeriesChart({
  series,
  data,
  xKey = "date",
  valueFormat = "number",
  height = 220,
  title,
  showLegend,
  className,
}: {
  series: Series[];
  data: Array<Record<string, unknown>>;
  xKey?: string;
  valueFormat?: ValueFormat;
  height?: number;
  title?: string;
  /** Defaults to on when there are two or more series. */
  showLegend?: boolean;
  className?: string;
}) {
  const config = React.useMemo(() => configFromSeries(series), [series]);
  const isEmpty = data.length === 0 || series.every((s) => data.every((row) => !Number(row[s.key] ?? 0)));
  const legend = showLegend ?? series.length > 1;
  const tickEvery = Math.max(0, Math.ceil(data.length / 8) - 1);

  return (
    <ChartFrame
      title={title}
      summary={summarise(data, xKey, series, valueFormat)}
      height={height}
      isEmpty={isEmpty}
      className={className}
      table={
        <ChartDataTable
          headers={["Date", ...series.map((s) => s.label)]}
          rows={data.map((row) => [
            formatXLabel(row[xKey]),
            ...series.map((s) => formatValue(Number(row[s.key] ?? 0), valueFormat)),
          ])}
        />
      }
    >
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            interval={tickEvery}
            minTickGap={16}
            tickFormatter={formatXLabel}
          />
          <YAxis
            width={valueFormat === "money" ? 52 : 36}
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            tickFormatter={(value: number) => formatAxisValue(value, valueFormat)}
          />
          <ChartTooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={
              <ChartTooltipContent
                indicator="line"
                labelFormatter={(label) => formatXLabel(label)}
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
          {legend ? <ChartLegend content={<ChartLegendContent />} /> : null}
          {series.map((item, index) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.key}
              stroke={seriesColor(index, item.color)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </ChartFrame>
  );
}
