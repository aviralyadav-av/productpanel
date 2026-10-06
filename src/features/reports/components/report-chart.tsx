"use client";

import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";

import type { ReportChart as ReportChartData } from "../types";

/**
 * Renders whichever chart the report declared. The choice is the report's, not
 * the page's: a time series answers "when", a bar chart "which of these is
 * biggest", a donut "what share" - and only the report knows which question
 * its rows answer. Charts are client components (recharts), so this thin
 * switch is the boundary rather than the whole page.
 */
export function ReportChart({ chart, height = 240 }: { chart: ReportChartData; height?: number }) {
  switch (chart.kind) {
    case "time-series":
      return (
        <TimeSeriesChart
          series={chart.series}
          data={chart.data}
          xKey={chart.xKey}
          valueFormat={chart.valueFormat}
          title={chart.title}
          height={height}
        />
      );
    case "bar":
      return (
        <BarChart
          data={chart.data}
          valueFormat={chart.valueFormat}
          horizontal={chart.horizontal}
          title={chart.title}
          showValues={chart.data.length <= 8}
          height={height}
        />
      );
    case "donut":
      return (
        <DonutChart
          data={chart.data}
          valueFormat={chart.valueFormat}
          centerLabel={chart.centerLabel}
          title={chart.title}
          height={height}
        />
      );
  }
}
