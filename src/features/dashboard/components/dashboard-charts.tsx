"use client";

import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";

import type { NamedValue, SeriesPoint } from "../types";

/**
 * Thin wrappers over the shared chart primitives.
 *
 * They exist so the page stays a layout file and so every dashboard chart
 * makes the same choices: the x axis is the bucket *label* the metric layer
 * produced ("04 Sep", "Wk of 04 Sep", "Sep 2026") rather than the raw key, so
 * a monthly range never renders twelve points labelled like days; money is
 * passed through as paise because that is the only unit the data layer speaks
 * and `valueFormat="money"` is what turns it into rupees.
 *
 * All of them take plain arrays: the panels that fetch are Server Components
 * and only serialisable data crosses into the browser.
 */

const X = "label";

export function RevenueTrendChart({ data }: { data: SeriesPoint[] }) {
  return (
    <TimeSeriesChart
      xKey={X}
      data={data}
      valueFormat="money"
      height={230}
      title="Revenue"
      series={[
        { key: "revenuePaise", label: "Revenue" },
        { key: "netSalesPaise", label: "Net sales" },
        { key: "refundedPaise", label: "Refunded" },
      ]}
    />
  );
}

export function OrdersTrendChart({
  data,
  series,
}: {
  data: SeriesPoint[];
  series: { key: string; label: string }[];
}) {
  return (
    <TimeSeriesChart
      xKey={X}
      data={data}
      series={series}
      valueFormat="number"
      height={230}
      title="Orders by status"
    />
  );
}

export function CustomerGrowthChart({ data }: { data: SeriesPoint[] }) {
  return (
    <TimeSeriesChart
      xKey={X}
      data={data}
      valueFormat="number"
      height={200}
      title="Customer growth"
      series={[
        { key: "count", label: "New" },
        { key: "cumulative", label: "Total" },
      ]}
    />
  );
}

export function SellerGrowthChart({ data }: { data: SeriesPoint[] }) {
  return (
    <TimeSeriesChart
      xKey={X}
      data={data}
      valueFormat="number"
      height={200}
      title="Seller growth"
      series={[
        { key: "count", label: "Registered" },
        { key: "activated", label: "Activated" },
      ]}
    />
  );
}

export function UnitsChart({ data }: { data: SeriesPoint[] }) {
  return (
    <TimeSeriesChart
      xKey={X}
      data={data}
      valueFormat="number"
      height={200}
      title="Units sold"
      series={[{ key: "units", label: "Units" }]}
    />
  );
}

/**
 * Category sales as horizontal bars: category names are words, and words do
 * not fit under a 30px vertical bar (see the BarChart doc comment).
 */
export function CategorySalesChart({ data }: { data: NamedValue[] }) {
  return (
    <BarChart
      horizontal
      showValues={data.length <= 8}
      data={data.map((row) => ({ label: row.label, value: row.value }))}
      valueFormat="money"
      height={Math.max(180, data.length * 28 + 40)}
      title="Sales by category"
    />
  );
}

export function PaymentSplitChart({ data }: { data: NamedValue[] }) {
  return (
    <DonutChart
      data={data.map((row) => ({ key: row.key, label: row.label, value: row.value }))}
      valueFormat="money"
      height={200}
      title="Revenue by payment method"
      centerLabel="revenue"
    />
  );
}
