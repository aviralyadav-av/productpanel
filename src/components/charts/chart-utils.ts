import type { ChartConfig } from "@/components/ui/chart";
import { formatDayKey } from "@/lib/dates";
import { formatNumber, formatPaise, formatPaiseCompact } from "@/lib/money";

/**
 * Shared rules for every chart in the admin.
 *
 * Colour comes from the `--chart-1..5` tokens in globals.css and is assigned
 * to series in FIXED order (first series is always chart-1), never cycled or
 * derived from rank: filtering a series out must not repaint the survivors.
 * A sixth series is a design smell - fold it into "Other" upstream.
 *
 * Money charts receive paise (the only unit the data layer speaks) and
 * format through src/lib/money so an axis and a table never disagree.
 */

export type ValueFormat = "money" | "number" | "percent";

export const CHART_TOKENS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export function seriesColor(index: number, override?: string): string {
  return override ?? CHART_TOKENS[index % CHART_TOKENS.length];
}

export type Series = { key: string; label: string; color?: string };

/** Build the ChartConfig that ChartContainer needs from a series list. */
export function configFromSeries(series: Series[]): ChartConfig {
  const config: ChartConfig = {};
  series.forEach((item, index) => {
    config[item.key] = { label: item.label, color: seriesColor(index, item.color) };
  });
  return config;
}

/** Full-precision value for tooltips and the sr-only table. */
export function formatValue(value: number | null | undefined, format: ValueFormat): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  switch (format) {
    case "money":
      return formatPaise(value);
    case "percent":
      return `${value.toFixed(1)}%`;
    default:
      return formatNumber(value);
  }
}

/** Short value for axis ticks, where "₹1.2L" beats "₹1,20,000". */
export function formatAxisValue(value: number, format: ValueFormat): string {
  switch (format) {
    case "money":
      return formatPaiseCompact(value);
    case "percent":
      return `${value}%`;
    default:
      return value >= 1000
        ? new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(value)
        : String(value);
  }
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Axis label for an x value: IST day keys become "04 Sep", others pass through. */
export function formatXLabel(value: unknown): string {
  if (typeof value === "string" && DAY_KEY.test(value)) return formatDayKey(value);
  return String(value ?? "");
}

/**
 * One-sentence summary for the sr-only caption so a screen-reader user gets
 * the shape of the data without the SVG: range, total and peak.
 */
export function summarise(
  rows: Array<Record<string, unknown>>,
  xKey: string,
  series: Series[],
  format: ValueFormat,
): string {
  if (rows.length === 0) return "No data.";
  const parts = series.map((item) => {
    const values = rows.map((row) => Number(row[item.key] ?? 0));
    const total = values.reduce((sum, value) => sum + value, 0);
    const peakIndex = values.indexOf(Math.max(...values));
    const peakLabel = formatXLabel(rows[peakIndex]?.[xKey]);
    return `${item.label}: total ${formatValue(total, format)}, peak ${formatValue(values[peakIndex], format)} on ${peakLabel}`;
  });
  return `${rows.length} points from ${formatXLabel(rows[0][xKey])} to ${formatXLabel(rows[rows.length - 1][xKey])}. ${parts.join(". ")}.`;
}
