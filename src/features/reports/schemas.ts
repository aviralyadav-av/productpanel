import { z } from "zod";

import {
  COMMISSION_SCOPE_META,
  COUPON_TYPE_META,
  ORDER_SOURCE_META,
  ORDER_STATUS_META,
  PAYMENT_METHOD_META,
  PAYMENT_STATUS_META,
  PAYOUT_METHOD_META,
  PAYOUT_STATUS_META,
  REFUND_METHOD_META,
  REFUND_STATUS_META,
  REPORT_KEYS,
  RETURN_REASON_META,
  STOCK_STATE_META,
  orderStatusSchema,
  paymentMethodSchema,
  payoutStatusSchema,
  refundMethodSchema,
  refundStatusSchema,
  stockStateSchema,
  type BadgeTone,
  type Meta,
  type ReportKey,
} from "@/lib/enums";
import { resolveDateRangeParams } from "@/components/shared/date-range";
import { one, type SearchParams } from "@/lib/list-params";
import { BUCKETS, isCategoryLevel } from "./bucketing";
import type { ReportFilterKey, ReportFilters, ReportRunParams, ReportSummary, StatusKind } from "./types";

/**
 * URL contract for /admin/reports/[report] and GET /api/admin/reports/[report]:
 *
 *   range | from & to        DateRangePicker (resolveDateRangeParams)
 *   sort, order, page, pageSize
 *   seller, category, product, coupon   entity ids
 *   status, paymentMethod               order-level
 *   bucket=day|week|month, level=root|leaf, groupBy=<report-specific>
 *   payoutStatus, refundStatus, refundMethod, stock, buyerType=new|returning
 *
 * A report declares which of these it honours; the parser reads only those so
 * a stale `?status=` from another report cannot silently narrow this one.
 */

export const REPORT_FILTER_PARAMS: Record<ReportFilterKey, string> = {
  seller: "seller",
  category: "category",
  product: "product",
  coupon: "coupon",
  status: "status",
  paymentMethod: "paymentMethod",
  bucket: "bucket",
  level: "level",
  groupBy: "groupBy",
  payoutStatus: "payoutStatus",
  refundStatus: "refundStatus",
  refundMethod: "refundMethod",
  stockState: "stock",
  buyerType: "buyerType",
};

export const reportKeyParamSchema = z.enum(REPORT_KEYS);

export function parseReportKey(value: string | undefined): ReportKey | null {
  const parsed = reportKeyParamSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Loose id: cuid or a seeded `demo_` id; anything else is ignored rather than passed to SQL. */
const idParam = z.string().trim().regex(/^[A-Za-z0-9_-]{4,64}$/);

function readId(value: string | undefined): string | undefined {
  const parsed = idParam.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function readEnum<T>(schema: z.ZodType<T>, value: string | undefined): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function read(params: SearchParams | URLSearchParams, key: string): string | undefined {
  return params instanceof URLSearchParams ? (params.get(key) ?? undefined) : one(params, key);
}

export function parseReportFilters(
  params: SearchParams | URLSearchParams,
  allowed: readonly ReportFilterKey[],
  groupByValues: readonly string[] = [],
): ReportFilters {
  const has = (key: ReportFilterKey) => allowed.includes(key);
  const get = (key: ReportFilterKey) => read(params, REPORT_FILTER_PARAMS[key]);
  const filters: ReportFilters = {};

  if (has("seller")) filters.sellerId = readId(get("seller"));
  if (has("category")) filters.categoryId = readId(get("category"));
  if (has("product")) filters.productId = readId(get("product"));
  if (has("coupon")) filters.couponId = readId(get("coupon"));
  if (has("status")) filters.status = readEnum(orderStatusSchema, get("status"));
  if (has("paymentMethod")) filters.paymentMethod = readEnum(paymentMethodSchema, get("paymentMethod"));
  if (has("bucket")) filters.bucket = readEnum(z.enum(BUCKETS), get("bucket"));
  if (has("level")) {
    const level = get("level");
    filters.level = isCategoryLevel(level) ? level : undefined;
  }
  if (has("groupBy")) {
    const groupBy = get("groupBy");
    filters.groupBy = groupBy && groupByValues.includes(groupBy) ? groupBy : undefined;
  }
  if (has("payoutStatus")) filters.payoutStatus = readEnum(payoutStatusSchema, get("payoutStatus"));
  if (has("refundStatus")) filters.refundStatus = readEnum(refundStatusSchema, get("refundStatus"));
  if (has("refundMethod")) filters.refundMethod = readEnum(refundMethodSchema, get("refundMethod"));
  if (has("stockState")) filters.stockState = readEnum(stockStateSchema, get("stockState"));
  if (has("buyerType")) {
    const buyerType = get("buyerType");
    filters.buyerType = buyerType === "new" || buyerType === "returning" ? buyerType : undefined;
  }

  for (const key of Object.keys(filters) as Array<keyof ReportFilters>) {
    if (filters[key] === undefined) delete filters[key];
  }
  return filters;
}

/** True when any filter beyond the range is set - drives the "clear filters" affordance. */
export function hasReportFilters(filters: ReportFilters): boolean {
  return Object.values(filters).some((value) => value !== undefined);
}

/** Filters → URL query pairs, for export links and the API. */
export function filtersToParams(filters: ReportFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (filters.sellerId) out.seller = filters.sellerId;
  if (filters.categoryId) out.category = filters.categoryId;
  if (filters.productId) out.product = filters.productId;
  if (filters.couponId) out.coupon = filters.couponId;
  if (filters.status) out.status = filters.status;
  if (filters.paymentMethod) out.paymentMethod = filters.paymentMethod;
  if (filters.bucket) out.bucket = filters.bucket;
  if (filters.level) out.level = filters.level;
  if (filters.groupBy) out.groupBy = filters.groupBy;
  if (filters.payoutStatus) out.payoutStatus = filters.payoutStatus;
  if (filters.refundStatus) out.refundStatus = filters.refundStatus;
  if (filters.refundMethod) out.refundMethod = filters.refundMethod;
  if (filters.stockState) out.stock = filters.stockState;
  if (filters.buyerType) out.buyerType = filters.buyerType;
  return out;
}

/** Sort direction straight from the URL; parseListParams collapses `desc` on asc-default lists. */
export function readOrder(params: SearchParams | URLSearchParams, fallback: "asc" | "desc"): "asc" | "desc" {
  const raw = read(params, "order");
  return raw === "asc" || raw === "desc" ? raw : fallback;
}

// ---------------------------------------------------------------------------
// Status labels for table cells (client-safe)
// ---------------------------------------------------------------------------

const FUNDED_BY_META: Record<string, Meta> = {
  PLATFORM: { label: "Platform", tone: "info" },
  SELLER: { label: "Seller", tone: "brand" },
};

const BUYER_TYPE_META: Record<string, Meta> = {
  new: { label: "New", tone: "info" },
  returning: { label: "Returning", tone: "success" },
};

const STATUS_TABLES: Record<StatusKind, Record<string, Meta>> = {
  order: ORDER_STATUS_META,
  payment: PAYMENT_STATUS_META,
  paymentMethod: PAYMENT_METHOD_META,
  source: ORDER_SOURCE_META,
  payout: PAYOUT_STATUS_META,
  payoutMethod: PAYOUT_METHOD_META,
  refund: REFUND_STATUS_META,
  refundMethod: REFUND_METHOD_META,
  returnReason: { ...RETURN_REASON_META, CANCELLATION: { label: "Cancellation", tone: "neutral" } },
  stock: STOCK_STATE_META,
  commissionScope: COMMISSION_SCOPE_META,
  couponType: COUPON_TYPE_META,
  fundedBy: FUNDED_BY_META,
  buyerType: BUYER_TYPE_META,
};

/** Label + tone for a status cell; unknown codes fall back to the raw code in neutral. */
export function statusMeta(kind: StatusKind, value: unknown): { label: string; tone: BadgeTone } {
  const code = String(value ?? "");
  const meta = STATUS_TABLES[kind]?.[code];
  return meta ? { label: meta.label, tone: meta.tone } : { label: code || "—", tone: "neutral" };
}

// ---------------------------------------------------------------------------
// Full request parsing (range + filters + sort + page)
// ---------------------------------------------------------------------------

/** The parts of a report definition the parser needs; a full definition satisfies it. */
export type ReportParamsSource = Pick<
  ReportSummary,
  "filters" | "columns" | "defaultSort" | "defaultOrder" | "groupByOptions"
>;

/** Reports show more rows per page than lists: they are read as a table of numbers, not scanned for one record. */
export const REPORT_PAGE_SIZE = 50;

/**
 * The whole `?…` contract in one call, shared by the page and the JSON API so
 * a bookmarked report URL and its export can never disagree.
 *
 * An unknown or non-sortable `sort` silently falls back to the report default
 * rather than erroring: a link copied from another report should still show
 * this one, just in its own order.
 */
export function parseReportParams(
  def: ReportParamsSource,
  params: SearchParams | URLSearchParams,
  now = new Date(),
): ReportRunParams {
  const range = resolveDateRangeParams(params, "30d", now);
  const filters = parseReportFilters(params, def.filters, (def.groupByOptions ?? []).map((option) => option.value));

  const sortable = new Set(def.columns.filter((column) => column.sortable !== false).map((column) => column.key));
  const requested = read(params, "sort");
  const sort = requested && sortable.has(requested) ? requested : def.defaultSort;
  const order = readOrder(params, def.defaultOrder);

  const page = Math.max(1, Number(read(params, "page") ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(10, Number(read(params, "pageSize") ?? REPORT_PAGE_SIZE) || REPORT_PAGE_SIZE));

  return { range, filters, sort, order, page, pageSize, skip: (page - 1) * pageSize };
}
