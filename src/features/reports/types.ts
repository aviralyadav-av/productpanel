import type { Route } from "next";

import type { ValueFormat } from "@/components/charts/chart-utils";
import type { DateRange } from "@/lib/dates";
import type { OrderStatus, PaymentMethod, PayoutStatus, RefundMethod, RefundStatus, ReportKey, StockState } from "@/lib/enums";
import type { PageMeta } from "@/lib/list-params";
import type { Bucket, CategoryLevel } from "./bucketing";

/**
 * Client-safe shapes shared by the registry (server), the page components
 * (client) and the JSON API. Nothing here touches Prisma so the table and
 * filter components can import it freely.
 */

export type ReportColumnType =
  | "string"
  | "number"
  | "money"
  | "date"
  | "datetime"
  | "percent"
  /** Basis points, rendered as "12.00%". */
  | "bps"
  | "status"
  | "boolean";

/** Which *_META table gives a status column its label and tone. */
export type StatusKind =
  | "order"
  | "payment"
  | "paymentMethod"
  | "source"
  | "payout"
  | "payoutMethod"
  | "refund"
  | "refundMethod"
  | "returnReason"
  | "stock"
  | "commissionScope"
  | "couponType"
  | "fundedBy"
  | "buyerType";

export type ReportColumn = {
  key: string;
  label: string;
  type: ReportColumnType;
  /** Sort key accepted by the report's `sort` param; absent = not sortable. */
  sortable?: boolean;
  defaultHidden?: boolean;
  /** Cannot be hidden (the row's identity). */
  locked?: boolean;
  statusKind?: StatusKind;
  /** Row field holding an admin href for this cell (rendered as a link). */
  hrefKey?: string;
  /** Row field holding a secondary line under the value (SKU under a title). */
  subtitleKey?: string;
  /** Sums into the export/print footer and the totals strip when set. */
  total?: boolean;
  hint?: string;
};

export type ReportRow = Record<string, unknown>;

export type ReportTotal = { key: string; label: string; value: number; type: "money" | "number" | "percent"; hint?: string };

export type ReportChart =
  | {
      kind: "time-series";
      series: Array<{ key: string; label: string }>;
      data: Array<Record<string, unknown>>;
      xKey: string;
      valueFormat: ValueFormat;
      title?: string;
    }
  | { kind: "bar"; data: Array<{ label: string; value: number }>; valueFormat: ValueFormat; horizontal?: boolean; title?: string }
  | { kind: "donut"; data: Array<{ key: string; label: string; value: number }>; valueFormat: ValueFormat; centerLabel?: string; title?: string };

export type ReportResult = {
  rows: ReportRow[];
  meta: PageMeta;
  totals: ReportTotal[];
  chart: ReportChart | null;
  /** One line under the table explaining a definition the numbers depend on. */
  note?: string;
};

/** Which filter controls a report shows; each maps to one URL param (see schemas.ts). */
export type ReportFilterKey =
  | "seller"
  | "category"
  | "product"
  | "coupon"
  | "status"
  | "paymentMethod"
  | "bucket"
  | "level"
  | "groupBy"
  | "payoutStatus"
  | "refundStatus"
  | "refundMethod"
  | "stockState"
  | "buyerType";

export type ReportFilters = {
  sellerId?: string;
  categoryId?: string;
  productId?: string;
  couponId?: string;
  status?: OrderStatus;
  paymentMethod?: PaymentMethod;
  bucket?: Bucket;
  level?: CategoryLevel;
  groupBy?: string;
  payoutStatus?: PayoutStatus;
  refundStatus?: RefundStatus;
  refundMethod?: RefundMethod;
  stockState?: StockState;
  buyerType?: "new" | "returning";
};

/** The parsed request a report runs with. `range.to` is inclusive (end of IST day). */
export type ReportRunParams = {
  range: DateRange;
  filters: ReportFilters;
  sort: string;
  order: "asc" | "desc";
  page: number;
  pageSize: number;
  skip: number;
};

/** The serialisable half of a definition - what the index card and the client need. */
export type ReportSummary = {
  key: ReportKey;
  title: string;
  description: string;
  /** Long description shown under the report header. */
  about: string;
  requires: readonly string[];
  filters: readonly ReportFilterKey[];
  columns: readonly ReportColumn[];
  defaultSort: string;
  defaultOrder: "asc" | "desc";
  /** Group-by choices when `filters` includes "groupBy". */
  groupByOptions?: ReadonlyArray<{ value: string; label: string }>;
  href: Route;
};

/** What the index card shows for the last 30 days. */
export type ReportHeadline = ReportTotal & { report: ReportKey };
