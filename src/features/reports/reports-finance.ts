import type { Prisma } from "@prisma/client";
import type { Route } from "next";

import { db } from "@/lib/db";
import { PAYOUT_STATUS_META, type PayoutStatus } from "@/lib/enums";
import { countTotal, defineReport, moneyTotal, pageRows, pct, percentTotal, reportPageMeta, slicePage, sortRows, toItemFilters } from "./define";
import {
  commissionSummary,
  couponPerformance,
  payoutSummary,
  refundSummary,
  topSellers,
  type CommissionSummaryRow,
  type RefundGroupBy,
  type SellerSales,
} from "./metrics-finance";
import { statusMeta } from "./schemas";
import { resolveCategoryPath, type ItemFilters } from "./sql";
import type { ReportColumn, ReportRow, ReportRunParams } from "./types";

/**
 * Finance reports: sellers, commissions, payouts, refunds and coupons (the
 * tax report lives in reports-tax.ts). See metrics-finance.ts for why seller
 * and commission figures are "booked" from the order snapshots rather than
 * taken from the ledger.
 */

async function itemFilters(params: ReportRunParams): Promise<ItemFilters> {
  return toItemFilters(params.filters, await resolveCategoryPath(params.filters.categoryId));
}

// ---------------------------------------------------------------------------
// Sellers
// ---------------------------------------------------------------------------

const SELLER_COLUMNS: readonly ReportColumn[] = [
  { key: "name", label: "Seller", type: "string", sortable: true, locked: true, hrefKey: "href" },
  { key: "orders", label: "Orders", type: "number", sortable: true, total: true },
  { key: "units", label: "Units", type: "number", sortable: true, total: true },
  { key: "sellerGrossPaise", label: "Gross sales", type: "money", sortable: true, total: true, hint: "Σ line totals" },
  { key: "commissionPaise", label: "Commission", type: "money", sortable: true, total: true },
  { key: "effectiveRateBps", label: "Rate", type: "bps", hint: "Commission ÷ taxable value" },
  { key: "chargesPaise", label: "Charges", type: "money", sortable: true, total: true },
  { key: "sellerPayablePaise", label: "Payable", type: "money", sortable: true, total: true, hint: "Gross − commission − charges" },
  { key: "refundedPaise", label: "Refunded", type: "money", sortable: true, total: true },
];

const SELLER_SORT: Record<string, NonNullable<Parameters<typeof topSellers>[1]>["by"]> = {
  name: "name",
  orders: "orders",
  units: "units",
  sellerGrossPaise: "gross",
  commissionPaise: "commission",
  chargesPaise: "charges",
  sellerPayablePaise: "payable",
  refundedPaise: "refunded",
};

function sellerRow(item: SellerSales): ReportRow {
  return {
    id: item.sellerId ?? "platform",
    name: item.name,
    href: item.sellerId ? (`/admin/sellers/${item.sellerId}` as Route) : undefined,
    orders: item.orders,
    units: item.units,
    sellerGrossPaise: item.sellerGrossPaise,
    commissionPaise: item.commissionPaise,
    effectiveRateBps: item.effectiveRateBps,
    chargesPaise: item.chargesPaise,
    sellerPayablePaise: item.sellerPayablePaise,
    refundedPaise: item.refundedPaise,
  };
}

async function fetchSellers(params: ReportRunParams, skip: number, take: number) {
  const filters = await itemFilters(params);
  const result = await topSellers(params.range, { filters, limit: take, skip, by: SELLER_SORT[params.sort] ?? "gross", order: params.order });
  return { rows: result.rows.map(sellerRow), total: result.total, filters };
}

export const sellersReport = defineReport({
  key: "sellers",
  about:
    "What each seller sold in the range and what the marketplace keeps: gross line sales, the commission and charges snapshotted on every line, and the amount payable to the seller. Lines sold by the platform itself appear as one \"Platform\" row.",
  filters: ["seller", "category", "paymentMethod"],
  columns: SELLER_COLUMNS,
  defaultSort: "sellerGrossPaise",
  defaultOrder: "desc",
  async run(params) {
    const { rows, total, filters } = await fetchSellers(params, params.skip, params.pageSize);
    // Totals need the whole set; sellers are few, so one unpaged read is fine.
    const all = await topSellers(params.range, { filters, limit: 5000 });
    const sum = (key: keyof SellerSales) => all.rows.reduce((acc, item) => acc + (item[key] as number), 0);
    const gross = sum("sellerGrossPaise");
    const commission = sum("commissionPaise");
    return {
      rows,
      meta: reportPageMeta(total, params),
      totals: [
        moneyTotal("gross", "Gross sales", gross),
        moneyTotal("commission", "Commission", commission),
        moneyTotal("charges", "Charges", sum("chargesPaise")),
        moneyTotal("payable", "Seller payable", sum("sellerPayablePaise")),
        moneyTotal("refunded", "Refunded", sum("refundedPaise")),
        percentTotal("take", "Take rate", pct(commission + sum("chargesPaise"), gross), "(Commission + charges) ÷ gross"),
      ],
      chart: {
        kind: "bar",
        horizontal: true,
        valueFormat: "money",
        title: "Gross sales by seller",
        data: [...all.rows]
          .sort((a, b) => b.sellerGrossPaise - a.sellerGrossPaise)
          .slice(0, 10)
          .map((item) => ({ label: item.name, value: item.sellerGrossPaise })),
      },
      note: "Figures are booked at order placement from the commission snapshot on each line. The ledger records earnings on delivery, so a seller's payout statement can lag this report.",
    };
  },
  async exportPage(params, skip, take) {
    return (await fetchSellers(params, skip, take)).rows;
  },
  async headline(range) {
    const all = await topSellers(range, { limit: 5000 });
    return moneyTotal("payable", "Seller payable", all.rows.reduce((sum, item) => sum + item.sellerPayablePaise, 0));
  },
});

// ---------------------------------------------------------------------------
// Commissions
// ---------------------------------------------------------------------------

const COMMISSION_COLUMNS: readonly ReportColumn[] = [
  { key: "label", label: "Seller / rule", type: "string", sortable: true, locked: true, subtitleKey: "scopeLabel" },
  { key: "orders", label: "Orders", type: "number", sortable: true, total: true },
  { key: "lines", label: "Lines", type: "number", sortable: true, total: true, defaultHidden: true },
  { key: "sellerGrossPaise", label: "Gross", type: "money", sortable: true, total: true },
  { key: "taxableValuePaise", label: "Taxable value", type: "money", sortable: true, total: true, hint: "Commission base (B3)" },
  { key: "effectiveRateBps", label: "Rate", type: "bps", sortable: true },
  { key: "fixedPaise", label: "Fixed part", type: "money", total: true, defaultHidden: true },
  { key: "commissionPaise", label: "Commission", type: "money", sortable: true, total: true },
  { key: "chargesPaise", label: "Charges", type: "money", sortable: true, total: true },
  { key: "sellerPayablePaise", label: "Payable", type: "money", sortable: true, total: true },
];

function commissionRow(item: CommissionSummaryRow): ReportRow {
  return {
    id: item.key ?? "none",
    label: item.label,
    scopeLabel: item.scope ? `${statusMeta("commissionScope", item.scope).label} rule` : "",
    orders: item.orders,
    lines: item.lines,
    sellerGrossPaise: item.sellerGrossPaise,
    taxableValuePaise: item.taxableValuePaise,
    effectiveRateBps: item.effectiveRateBps,
    fixedPaise: item.fixedPaise,
    commissionPaise: item.commissionPaise,
    chargesPaise: item.chargesPaise,
    sellerPayablePaise: item.sellerPayablePaise,
  };
}

async function commissionRows(params: ReportRunParams) {
  const filters = await itemFilters(params);
  const groupBy = params.filters.groupBy === "rule" ? "rule" : "seller";
  const items = await commissionSummary(params.range, { groupBy, filters });
  return { items, groupBy, rows: sortRows(items.map(commissionRow), params.sort, params.order, "label") };
}

export const commissionsReport = defineReport({
  key: "commissions",
  about:
    "Commission booked in the range, grouped by seller or by the commission rule that applied to each line (product, seller, category or global). Rates are the weighted average of the snapshots on the lines.",
  filters: ["groupBy", "seller", "category", "paymentMethod"],
  groupByOptions: [
    { value: "seller", label: "By seller" },
    { value: "rule", label: "By rule" },
  ],
  columns: COMMISSION_COLUMNS,
  defaultSort: "commissionPaise",
  defaultOrder: "desc",
  async run(params) {
    const { items, groupBy, rows } = await commissionRows(params);
    const sum = (key: keyof CommissionSummaryRow) => items.reduce((acc, item) => acc + (item[key] as number), 0);
    const taxable = sum("taxableValuePaise");
    const commission = sum("commissionPaise");
    return {
      ...pageRows(rows, params),
      totals: [
        moneyTotal("commission", "Commission", commission),
        moneyTotal("charges", "Charges", sum("chargesPaise")),
        moneyTotal("taxable", "Taxable value", taxable),
        percentTotal("rate", "Effective rate", pct(commission - sum("fixedPaise"), taxable), "Percentage part only"),
        moneyTotal("payable", "Seller payable", sum("sellerPayablePaise")),
      ],
      chart: {
        kind: "bar",
        horizontal: true,
        valueFormat: "money",
        title: `Commission by ${groupBy}`,
        data: [...items]
          .sort((a, b) => b.commissionPaise - a.commissionPaise)
          .slice(0, 10)
          .map((item) => ({ label: item.label, value: item.commissionPaise })),
      },
      note: "Commission = round(taxable value × rate) + fixed per unit × quantity, resolved PRODUCT → SELLER → CATEGORY → GLOBAL at placement and never re-resolved (blueprint B3).",
    };
  },
  async exportPage(params, skip, take) {
    return slicePage((await commissionRows(params)).rows, skip, take);
  },
  async headline(range) {
    const items = await commissionSummary(range, { groupBy: "seller" });
    return moneyTotal("commission", "Commission", items.reduce((sum, item) => sum + item.commissionPaise, 0));
  },
});

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

const PAYOUT_COLUMNS: readonly ReportColumn[] = [
  { key: "payoutNumber", label: "Statement", type: "string", sortable: true, locked: true, hrefKey: "href" },
  { key: "sellerName", label: "Seller", type: "string", sortable: true, hrefKey: "sellerHref" },
  { key: "status", label: "Status", type: "status", statusKind: "payout", sortable: true },
  { key: "method", label: "Method", type: "status", statusKind: "payoutMethod", defaultHidden: true },
  { key: "periodFrom", label: "Period from", type: "date", defaultHidden: true },
  { key: "periodTo", label: "Period to", type: "date", sortable: true },
  { key: "grossSalesPaise", label: "Gross", type: "money", sortable: true, total: true },
  { key: "commissionPaise", label: "Commission", type: "money", total: true },
  { key: "chargesPaise", label: "Charges", type: "money", total: true, defaultHidden: true },
  { key: "refundsPaise", label: "Refunds", type: "money", total: true, defaultHidden: true },
  { key: "adjustmentsPaise", label: "Adjustments", type: "money", total: true, defaultHidden: true },
  { key: "netPaise", label: "Net", type: "money", sortable: true, total: true },
  { key: "createdAt", label: "Created", type: "datetime", sortable: true },
  { key: "paidAt", label: "Paid", type: "datetime", defaultHidden: true },
  { key: "referenceNumber", label: "Reference", type: "string", defaultHidden: true },
];

const PAYOUT_SORTS: Record<string, keyof Prisma.SellerPayoutOrderByWithRelationInput> = {
  payoutNumber: "seq",
  status: "status",
  periodTo: "periodTo",
  grossSalesPaise: "grossSalesPaise",
  netPaise: "netPaise",
  createdAt: "createdAt",
};

function payoutWhere(params: ReportRunParams): Prisma.SellerPayoutWhereInput {
  const where: Prisma.SellerPayoutWhereInput = { createdAt: { gte: params.range.from, lte: params.range.to } };
  if (params.filters.sellerId) where.sellerId = params.filters.sellerId;
  if (params.filters.payoutStatus) where.status = params.filters.payoutStatus;
  return where;
}

async function fetchPayouts(params: ReportRunParams, skip: number, take: number): Promise<ReportRow[]> {
  const orderBy: Prisma.SellerPayoutOrderByWithRelationInput[] =
    params.sort === "sellerName"
      ? [{ seller: { displayName: params.order } }, { id: "asc" }]
      : [{ [PAYOUT_SORTS[params.sort] ?? "createdAt"]: params.order }, { id: "asc" }];
  const payouts = await db.sellerPayout.findMany({
    where: payoutWhere(params),
    include: { seller: { select: { displayName: true } } },
    orderBy,
    skip,
    take,
  });
  return payouts.map((payout) => ({
    id: payout.id,
    payoutNumber: payout.payoutNumber,
    href: `/admin/payouts/${payout.id}` as Route,
    sellerId: payout.sellerId,
    sellerName: payout.seller.displayName,
    sellerHref: `/admin/sellers/${payout.sellerId}` as Route,
    status: payout.status,
    method: payout.method,
    periodFrom: payout.periodFrom,
    periodTo: payout.periodTo,
    grossSalesPaise: payout.grossSalesPaise,
    commissionPaise: payout.commissionPaise,
    chargesPaise: payout.chargesPaise,
    refundsPaise: payout.refundsPaise,
    adjustmentsPaise: payout.adjustmentsPaise,
    netPaise: payout.netPaise,
    createdAt: payout.createdAt,
    paidAt: payout.paidAt,
    referenceNumber: payout.referenceNumber ?? "",
  }));
}

export const payoutsReport = defineReport({
  key: "payouts",
  about:
    "Payout statements generated in the range, by status. Net = gross − commission − charges − refunds + adjustments, and always equals the scheduled ledger entries behind the statement (blueprint B5).",
  filters: ["payoutStatus", "seller"],
  columns: PAYOUT_COLUMNS,
  defaultSort: "createdAt",
  defaultOrder: "desc",
  async run(params) {
    const [rows, total, summary] = await Promise.all([
      fetchPayouts(params, params.skip, params.pageSize),
      db.sellerPayout.count({ where: payoutWhere(params) }),
      payoutSummary(params.range, { sellerId: params.filters.sellerId, status: params.filters.payoutStatus }),
    ]);
    const by = (status: PayoutStatus) => summary.find((item) => item.status === status);
    const net = summary.reduce((sum, item) => sum + item.netPaise, 0);
    return {
      rows,
      meta: reportPageMeta(total, params),
      totals: [
        countTotal("statements", "Statements", summary.reduce((sum, item) => sum + item.count, 0)),
        moneyTotal("net", "Net total", net),
        moneyTotal("paid", "Paid", by("PAID")?.netPaise ?? 0, `${by("PAID")?.count ?? 0} statements`),
        moneyTotal("open", "Awaiting", (by("PENDING")?.netPaise ?? 0) + (by("APPROVED")?.netPaise ?? 0) + (by("PROCESSING")?.netPaise ?? 0), "Pending, approved or processing"),
        moneyTotal("commission", "Commission withheld", summary.reduce((sum, item) => sum + item.commissionPaise, 0)),
      ],
      chart: {
        kind: "bar",
        valueFormat: "money",
        title: "Net by status",
        data: summary.map((item) => ({ label: PAYOUT_STATUS_META[item.status]?.label ?? item.status, value: item.netPaise })),
      },
      note: "Statements are dated by creation. Earnings still held because a seller's balance is under the minimum payout are not statements yet and do not appear here.",
    };
  },
  exportPage: fetchPayouts,
  async headline(range) {
    const summary = await payoutSummary(range);
    return moneyTotal("paid", "Paid out", summary.find((item) => item.status === "PAID")?.netPaise ?? 0);
  },
});

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

const REFUND_COLUMNS: readonly ReportColumn[] = [
  { key: "group", label: "Group", type: "status", statusKind: "returnReason", sortable: true, locked: true },
  { key: "count", label: "Refunds", type: "number", sortable: true, total: true },
  { key: "amountPaise", label: "Amount", type: "money", sortable: true, total: true, hint: "All non-cancelled refunds" },
  { key: "completedPaise", label: "Completed", type: "money", sortable: true, total: true, hint: "Money that has actually left" },
  { key: "sharePct", label: "Share", type: "percent", sortable: true },
];

const REFUND_GROUP_KIND = { reason: "returnReason", method: "refundMethod", status: "refund" } as const;

/** The grouping in force, defaulted; the group column's meta follows it. */
function refundGroupBy(params: ReportRunParams): RefundGroupBy {
  const value = params.filters.groupBy;
  return value === "method" || value === "status" ? value : "reason";
}

async function refundRows(params: ReportRunParams) {
  const groupBy = refundGroupBy(params);
  const groups = await refundSummary(params.range, {
    groupBy,
    filters: { status: params.filters.refundStatus, method: params.filters.refundMethod, sellerId: params.filters.sellerId },
  });
  const amount = groups.reduce((sum, item) => sum + item.amountPaise, 0);
  // `group` stays the raw code: the cell and the export both resolve it
  // through the statusKind that columnsFor() pins to this grouping, so screen
  // and file always show the same label.
  const rows = sortRows(
    groups.map((item) => ({
      id: item.key,
      group: item.key,
      count: item.count,
      amountPaise: item.amountPaise,
      completedPaise: item.completedPaise,
      sharePct: pct(item.amountPaise, amount),
    })),
    params.sort,
    params.order,
    "group",
  );
  return { groups, groupBy, rows, amount };
}

export const refundsReport = defineReport({
  key: "refunds",
  about:
    "Refunds created in the range - dated by the refund, not the order - grouped by return reason, refund method or status. Cancellations after payment have no return request and group as Cancellation.",
  filters: ["groupBy", "refundStatus", "refundMethod", "seller"],
  groupByOptions: [
    { value: "reason", label: "By reason" },
    { value: "method", label: "By method" },
    { value: "status", label: "By status" },
  ],
  columns: REFUND_COLUMNS,
  columnsFor: (params) => refundColumnsFor(refundGroupBy(params)),
  defaultSort: "amountPaise",
  defaultOrder: "desc",
  async run(params) {
    const { groups, groupBy, rows, amount } = await refundRows(params);
    const completed = groups.reduce((sum, item) => sum + item.completedPaise, 0);
    const count = groups.reduce((sum, item) => sum + item.count, 0);
    return {
      ...pageRows(rows, params),
      totals: [
        countTotal("count", "Refunds", count),
        moneyTotal("amount", "Amount", amount),
        moneyTotal("completed", "Completed", completed),
        moneyTotal("avg", "Avg refund", count > 0 ? Math.round(amount / count) : 0),
      ],
      chart: {
        kind: "donut",
        valueFormat: "money",
        centerLabel: "refunded",
        title: `Refund amount by ${groupBy}`,
        data: groups.slice(0, 5).map((item) => ({ key: item.key, label: statusMeta(REFUND_GROUP_KIND[groupBy], item.key).label, value: item.amountPaise })),
      },
      note: params.filters.refundStatus
        ? undefined
        : "Cancelled refunds are excluded unless the status filter selects them; a refund counts from the day it was created, not the day the order was placed.",
    };
  },
  async exportPage(params, skip, take) {
    return slicePage((await refundRows(params)).rows, skip, take);
  },
  async headline(range) {
    const groups = await refundSummary(range, { groupBy: "status" });
    return moneyTotal("completed", "Refunded", groups.reduce((sum, item) => sum + item.completedPaise, 0));
  },
});

/**
 * The group column carries a return reason, a refund method or a refund
 * status depending on the grouping, so its *_META table is chosen per request
 * rather than fixed on the column (see ReportDefinition.columnsFor).
 */
export function refundColumnsFor(groupBy: RefundGroupBy): readonly ReportColumn[] {
  return REFUND_COLUMNS.map((column) =>
    column.key === "group" ? { ...column, label: REFUND_GROUP_LABELS[groupBy], statusKind: REFUND_GROUP_KIND[groupBy] } : column,
  );
}

const REFUND_GROUP_LABELS: Record<RefundGroupBy, string> = { reason: "Reason", method: "Method", status: "Status" };

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

const COUPON_COLUMNS: readonly ReportColumn[] = [
  { key: "code", label: "Coupon", type: "string", sortable: true, locked: true, hrefKey: "href", subtitleKey: "name" },
  { key: "type", label: "Type", type: "status", statusKind: "couponType" },
  { key: "fundedBy", label: "Funded by", type: "status", statusKind: "fundedBy", defaultHidden: true },
  { key: "isActive", label: "Active", type: "boolean", defaultHidden: true },
  { key: "usages", label: "Uses", type: "number", sortable: true, total: true },
  { key: "orders", label: "Orders", type: "number", sortable: true, total: true, defaultHidden: true },
  { key: "discountPaise", label: "Discount given", type: "money", sortable: true, total: true },
  { key: "revenuePaise", label: "Revenue", type: "money", sortable: true, total: true, hint: "Of orders using the coupon" },
  { key: "avgOrderPaise", label: "Avg order", type: "money", sortable: true },
  { key: "discountRatePct", label: "Discount rate", type: "percent", sortable: true, hint: "Discount ÷ (revenue + discount)" },
  { key: "lifetimeUsages", label: "Lifetime uses", type: "number", defaultHidden: true },
];

async function couponRows(params: ReportRunParams) {
  const items = await couponPerformance(params.range, {
    couponId: params.filters.couponId,
    paymentMethod: params.filters.paymentMethod,
    sellerId: params.filters.sellerId,
  });
  const rows = sortRows(
    items.map((item) => ({
      id: item.couponId,
      code: item.code,
      name: item.name,
      href: `/admin/coupons/${item.couponId}` as Route,
      type: item.type,
      fundedBy: item.fundedBy,
      isActive: item.isActive,
      usages: item.usages,
      orders: item.orders,
      discountPaise: item.discountPaise,
      revenuePaise: item.revenuePaise,
      avgOrderPaise: item.avgOrderPaise,
      discountRatePct: pct(item.discountPaise, item.revenuePaise + item.discountPaise),
      lifetimeUsages: item.lifetimeUsages,
    })),
    params.sort,
    params.order,
    "code",
  );
  return { items, rows };
}

export const couponsReport = defineReport({
  key: "coupons",
  about:
    "How each coupon performed on counted orders in the range: how often it was used, the discount it granted and the revenue those orders produced. Orders that were cancelled or failed do not count as uses.",
  filters: ["coupon", "paymentMethod", "seller"],
  columns: COUPON_COLUMNS,
  defaultSort: "discountPaise",
  defaultOrder: "desc",
  async run(params) {
    const { items, rows } = await couponRows(params);
    const discount = items.reduce((sum, item) => sum + item.discountPaise, 0);
    const revenue = items.reduce((sum, item) => sum + item.revenuePaise, 0);
    const usages = items.reduce((sum, item) => sum + item.usages, 0);
    return {
      ...pageRows(rows, params),
      totals: [
        countTotal("coupons", "Coupons used", items.length),
        countTotal("usages", "Uses", usages),
        moneyTotal("discount", "Discount given", discount),
        moneyTotal("revenue", "Revenue with coupons", revenue),
        percentTotal("rate", "Discount rate", pct(discount, revenue + discount)),
      ],
      chart: {
        kind: "bar",
        horizontal: true,
        valueFormat: "money",
        title: "Discount given by coupon",
        data: [...items]
          .sort((a, b) => b.discountPaise - a.discountPaise)
          .slice(0, 10)
          .map((item) => ({ label: item.code, value: item.discountPaise })),
      },
    };
  },
  async exportPage(params, skip, take) {
    return slicePage((await couponRows(params)).rows, skip, take);
  },
  async headline(range) {
    const items = await couponPerformance(range);
    return moneyTotal("discount", "Discount given", items.reduce((sum, item) => sum + item.discountPaise, 0));
  },
});

