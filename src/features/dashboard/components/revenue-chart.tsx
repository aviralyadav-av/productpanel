"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatDayKey } from "@/lib/dates";
import { formatPaise, formatPaiseCompact } from "@/lib/money";

const config = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
  orders: { label: "Orders", color: "var(--chart-2)" },
} satisfies ChartConfig;

/**
 * One chart, two series, area for revenue and a line-weight area for order
 * count. An area chart beats bars here because the operator is reading the
 * trend, not comparing individual days - and 30 bars at this width is noise.
 */
export function RevenueChart({
  data,
}: {
  data: Array<{ day: string; revenuePaise: number; orders: number }>;
}) {
  const points = data.map((point) => ({
    day: point.day,
    label: formatDayKey(point.day),
    revenue: point.revenuePaise / 100,
    orders: point.orders,
  }));

  // Show roughly six ticks regardless of range length.
  const tickInterval = Math.max(0, Math.floor(points.length / 6) - 1);

  return (
    <ChartContainer config={config} className="h-56 w-full">
      <AreaChart data={points} margin={{ left: 4, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-revenue)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--color-revenue)" stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid vertical={false} strokeDasharray="3 3" />

        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={tickInterval}
          fontSize={11}
        />

        {/* Two axes, not one. Revenue runs to five figures of rupees and the
            order count to single digits; sharing a scale pinned the orders
            series flat against the baseline, so the card promised a series it
            never actually drew. */}
        <YAxis
          yAxisId="revenue"
          tickLine={false}
          axisLine={false}
          width={52}
          fontSize={11}
          tickFormatter={(value: number) => formatPaiseCompact(value * 100)}
        />

        <YAxis
          yAxisId="orders"
          orientation="right"
          tickLine={false}
          axisLine={false}
          width={28}
          fontSize={11}
          allowDecimals={false}
        />

        <ChartTooltip
          content={
            <ChartTooltipContent
              labelKey="label"
              formatter={(value, name) => (
                <span className="flex w-full justify-between gap-3">
                  <span className="text-muted-foreground">
                    {name === "revenue" ? "Revenue" : "Orders"}
                  </span>
                  <span data-numeric className="font-medium">
                    {name === "revenue"
                      ? formatPaise(Number(value) * 100)
                      : Number(value)}
                  </span>
                </span>
              )}
            />
          }
        />

        <ChartLegend content={<ChartLegendContent />} />

        <Area
          yAxisId="revenue"
          dataKey="revenue"
          type="monotone"
          stroke="var(--color-revenue)"
          strokeWidth={2}
          fill="url(#revenueFill)"
        />
        <Area
          yAxisId="orders"
          dataKey="orders"
          type="monotone"
          stroke="var(--color-orders)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          fill="transparent"
        />
      </AreaChart>
    </ChartContainer>
  );
}
