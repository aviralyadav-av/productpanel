import type { Route } from "next";

import type { DateRange } from "@/lib/dates";
import { REPORT_META, type ReportKey } from "@/lib/enums";
import { buildPageMeta, type PageMeta } from "@/lib/list-params";
import { defaultBucketFor, type Bucket } from "./bucketing";
import type { ItemFilters } from "./sql";
import type { ReportColumn, ReportFilters, ReportResult, ReportRow, ReportRunParams, ReportSummary, ReportTotal } from "./types";

/**
 * The contract one report implements (blueprint §1 Reports, §5.2, §11.28).
 *
 *   run()         the page and the JSON API: one page of rows plus the chart
 *                 and totals for the WHOLE range (a chart of page 2 is useless)
 *   exportPage()  the streaming exports: rows [skip, skip+take) in the same
 *                 sort, called by paginateAll until a short page comes back
 *   headline()    the number on the index card (last 30 days)
 *
 * Aggregate reports (a few hundred rows at most: days, categories, sellers)
 * compute the full result and slice it here; row-level reports (orders,
 * products, inventory, customers) page in SQL. Both look identical outside.
 */
export type ReportDefinition = ReportSummary & {
  run(params: ReportRunParams): Promise<ReportResult>;
  exportPage(params: ReportRunParams, skip: number, take: number): Promise<ReportRow[]>;
  headline(range: DateRange): Promise<ReportTotal>;
  /**
   * Columns for ONE request, when a filter changes what a column means. Only
   * the refunds report needs it: its first column holds a return reason, a
   * refund method or a refund status depending on the grouping, and both the
   * cell and the export must read the label out of the matching *_META table.
   * The static `columns` stay the shape of the report (what is sortable, what
   * the column menu lists); this only refines how a column renders.
   */
  columnsFor?(params: ReportRunParams): readonly ReportColumn[];
};

/**
 * The columns to RENDER and EXPORT for one request. Every consumer of a
 * report's rows goes through this rather than `def.columns`, otherwise a
 * regrouped report exports raw codes where the screen shows labels.
 */
export function resolveColumns(def: ReportDefinition, params: ReportRunParams): readonly ReportColumn[] {
  return def.columnsFor?.(params) ?? def.columns;
}

type DefineInput = Omit<ReportDefinition, "title" | "description" | "requires" | "href">;

/** Fill title/description/requires from REPORT_META (E4, D14) so the enum stays the single source. */
export function defineReport(input: DefineInput): ReportDefinition {
  const meta = REPORT_META[input.key];
  return {
    ...input,
    title: meta.label,
    description: meta.description,
    requires: meta.requires,
    href: `/admin/reports/${input.key}` as Route,
  };
}

export function reportHref(key: ReportKey): Route {
  return `/admin/reports/${key}` as Route;
}

// ---------------------------------------------------------------------------
// In-memory sort + page for aggregate reports
// ---------------------------------------------------------------------------

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

/** Stable sort by a row key with a deterministic tiebreak, so paging never repeats a row. */
export function sortRows<T extends ReportRow>(rows: T[], sort: string, order: "asc" | "desc", tiebreak: string): T[] {
  const direction = order === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = compare(a[sort], b[sort]) * direction;
    return primary !== 0 ? primary : compare(a[tiebreak], b[tiebreak]);
  });
}

/**
 * Page meta for a report. `buildPageMeta` is typed for ListParams, which
 * carries a free-text `q`; reports filter structurally rather than by search,
 * so the empty query is supplied here instead of polluting ReportRunParams.
 */
export function reportPageMeta(total: number, params: ReportRunParams): PageMeta {
  return buildPageMeta(total, { ...params, q: "" });
}

export function pageRows<T extends ReportRow>(rows: T[], params: ReportRunParams): { rows: T[]; meta: PageMeta } {
  return { rows: rows.slice(params.skip, params.skip + params.pageSize), meta: reportPageMeta(rows.length, params) };
}

export function slicePage<T extends ReportRow>(rows: T[], skip: number, take: number): T[] {
  return rows.slice(skip, skip + take);
}

export function sumBy<T extends ReportRow>(rows: readonly T[], key: keyof T & string): number {
  return rows.reduce((sum, row) => sum + (typeof row[key] === "number" ? (row[key] as number) : 0), 0);
}

export function moneyTotal(key: string, label: string, value: number, hint?: string): ReportTotal {
  return { key, label, value, type: "money", hint };
}

export function countTotal(key: string, label: string, value: number, hint?: string): ReportTotal {
  return { key, label, value, type: "number", hint };
}

export function percentTotal(key: string, label: string, value: number, hint?: string): ReportTotal {
  return { key, label, value, type: "percent", hint };
}

/** share of `part` in `whole` as a percentage, 0 when the whole is empty. */
export function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** The bucket the operator picked, else the one that fits the span. */
export function effectiveBucket(params: ReportRunParams): Bucket {
  return params.filters.bucket ?? defaultBucketFor(params.range.days);
}

/**
 * Report filters → metric filters. The category id becomes a path (resolved
 * by the caller once per request) so one filter covers the subtree.
 */
export function toItemFilters(filters: ReportFilters, categoryPath?: string): ItemFilters {
  const out: ItemFilters = {};
  if (filters.sellerId) out.sellerId = filters.sellerId;
  if (filters.productId) out.productId = filters.productId;
  if (filters.couponId) out.couponId = filters.couponId;
  if (filters.status) out.status = filters.status;
  if (filters.paymentMethod) out.paymentMethod = filters.paymentMethod;
  if (categoryPath) out.categoryPath = categoryPath;
  return out;
}

export const LAST_30_LABEL = "Last 30 days";
