"use client";

import * as React from "react";
import { Bar, BarChart as RechartsBarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { ChartDataTable, ChartFrame } from "./chart-frame";
import { formatAxisValue, formatValue, seriesColor, type ValueFormat } from "./chart-utils";

export type BarDatum = { label: string; value: number; color?: string };

/**
 * One measure across categories: revenue by category, orders by state, top
 * sellers. Vertical by default; `horizontal` lays the bars sideways, which is
 * the right call whenever the labels are words rather than numbers (a
 * category name does not fit under a 30px bar).
 *
 * All bars share ONE hue: the label carries identity, so a colour per bar
 * would add nothing but noise. A `color` per datum is allowed for the one
 * case where a bar *is* a known entity (a status colour), and even then use
 * the tokens.
 *
 * @example
 *   <BarChart data={byCategory} valueFormat="money" horizontal height={260} />
 */
export function BarChart({
  data,
  valueFormat = "number",
  horizontal = false,
  height = 220,
  title,
  showValues = false,
  className,
}: {
  data: BarDatum[];
  valueFormat?: ValueFormat;
  horizontal?: boolean;
  height?: number;
  title?: string;
  /** Print the value at the end of each bar; use for <= 8 bars. */
  showValues?: boolean;
  className?: string;
}) {
  const config = React.useMemo(
    () => ({ value: { label: title ?? "Value", color: seriesColor(0) } }),
    [title],
  );
  const isEmpty = data.length === 0 || data.every((row) => !row.value);
  const total = data.reduce((sum, row) => sum + row.value, 0);
  const top = data.reduce<BarDatum | null>((best, row) => (best && best.value >= row.value ? best : row), null);
  const summary = isEmpty
    ? "No data."
    : `${data.length} categories, total ${formatValue(total, valueFormat)}; largest is ${top?.label} at ${formatValue(top?.value, valueFormat)}.`;

  const labelWidth = horizontal ? Math.min(160, Math.max(48, ...data.map((row) => row.label.length * 6.5))) : undefined;

  return (
    <ChartFrame
      title={title}
      summary={summary}
      height={height}
      isEmpty={isEmpty}
      className={className}
      table={
        <ChartDataTable
          headers={["Category", title ?? "Value"]}
          rows={data.map((row) => [row.label, formatValue(row.value, valueFormat)])}
        />
      }
    >
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <RechartsBarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 4, right: showValues ? 48 : 8, bottom: 0, left: 0 }}
          barCategoryGap={horizontal ? 6 : "20%"}
          accessibilityLayer
        >
          <CartesianGrid horizontal={!horizontal} vertical={horizontal} strokeDasharray="3 3" />
          {horizontal ? (
            <>
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => formatAxisValue(value, valueFormat)}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={labelWidth}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                interval={0}
              />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
              <YAxis
                width={valueFormat === "money" ? 52 : 36}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => formatAxisValue(value, valueFormat)}
              />
            </>
          )}
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={
              <ChartTooltipContent
                hideIndicator
                formatter={(value, _name, item) => (
                  <div className="flex w-full items-center justify-between gap-3">
                    <span className="text-muted-foreground">
                      {String((item.payload as BarDatum | undefined)?.label ?? "")}
                    </span>
                    <span data-numeric className="text-foreground font-medium">
                      {formatValue(Number(value), valueFormat)}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Bar
            dataKey="value"
            name="value"
            fill={seriesColor(0)}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={horizontal ? 18 : 40}
            isAnimationActive={false}
          >
            {showValues ? (
              <LabelList
                dataKey="value"
                position={horizontal ? "right" : "top"}
                className="fill-muted-foreground"
                fontSize={10}
                formatter={(value: unknown) => formatAxisValue(Number(value), valueFormat)}
              />
            ) : null}
          </Bar>
        </RechartsBarChart>
      </ChartContainer>
    </ChartFrame>
  );
}
