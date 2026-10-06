import { REPORT_KEYS, type ReportKey } from "@/lib/enums";
import type { ReportDefinition } from "./define";
import { categoriesReport, inventoryReport, productsReport } from "./reports-catalog";
import { customersReport } from "./reports-customers";
import { commissionsReport, couponsReport, payoutsReport, refundsReport, sellersReport } from "./reports-finance";
import { ordersReport, revenueReport, salesReport } from "./reports-sales";
import { taxReport } from "./reports-tax";
import type { ReportSummary } from "./types";

/**
 * The 13 reports of blueprint E4, keyed by REPORT_KEYS. Adding a report means
 * adding a key to the enum (frozen: ask the enums owner) and a definition
 * here; the index, the detail page, the JSON API and the exports all read
 * this map and need no change.
 */
export const REPORTS: Record<ReportKey, ReportDefinition> = {
  sales: salesReport,
  orders: ordersReport,
  products: productsReport,
  categories: categoriesReport,
  sellers: sellersReport,
  customers: customersReport,
  revenue: revenueReport,
  commissions: commissionsReport,
  payouts: payoutsReport,
  inventory: inventoryReport,
  refunds: refundsReport,
  coupons: couponsReport,
  tax: taxReport,
};

export function getReport(key: ReportKey): ReportDefinition {
  return REPORTS[key];
}

export function isReportKey(value: unknown): value is ReportKey {
  return typeof value === "string" && (REPORT_KEYS as readonly string[]).includes(value);
}

/** The serialisable part of a definition, safe to hand to Client Components and the API. */
export function summarize(def: ReportDefinition): ReportSummary {
  return {
    key: def.key,
    title: def.title,
    description: def.description,
    about: def.about,
    requires: def.requires,
    filters: def.filters,
    columns: def.columns,
    defaultSort: def.defaultSort,
    defaultOrder: def.defaultOrder,
    groupByOptions: def.groupByOptions,
    href: def.href,
  };
}

/** Group-by values a report accepts, for the URL parser. */
export function groupByValues(def: ReportDefinition): string[] {
  return (def.groupByOptions ?? []).map((option) => option.value);
}

export { type ReportDefinition } from "./define";
