import type { Route } from "next";

import { countTotal, defineReport, moneyTotal, pct, percentTotal, reportPageMeta, toItemFilters } from "./define";
import { buyerCounts, customerSales, newCustomerCount, type CustomerSalesRow } from "./metrics-customers";
import { revenueTotals } from "./metrics-sales";
import { resolveCategoryPath } from "./sql";
import type { ReportColumn, ReportRow, ReportRunParams } from "./types";

/**
 * Customers report: who bought in the range, whether they were new or
 * returning, and what they spent. Rows are buyers (accounts, or guest emails
 * for account-less orders), paged in SQL.
 */

const CUSTOMER_COLUMNS: readonly ReportColumn[] = [
  { key: "customer", label: "Customer", type: "string", sortable: true, locked: true, hrefKey: "href", subtitleKey: "email" },
  { key: "buyerType", label: "Type", type: "status", statusKind: "buyerType" },
  { key: "orders", label: "Orders", type: "number", sortable: true, total: true },
  { key: "units", label: "Units", type: "number", sortable: true, total: true, defaultHidden: true },
  { key: "grossPaise", label: "Charged", type: "money", sortable: true, total: true, defaultHidden: true },
  { key: "refundedPaise", label: "Refunded", type: "money", sortable: true, total: true },
  { key: "revenuePaise", label: "Spend", type: "money", sortable: true, total: true, hint: "Charged − refunded" },
  { key: "avgOrderPaise", label: "Avg order", type: "money" },
  { key: "firstOrderAt", label: "First order", type: "date", sortable: true, defaultHidden: true },
  { key: "lastOrderAt", label: "Last order", type: "date", sortable: true },
];

const CUSTOMER_SORT: Record<string, string> = {
  customer: "email",
  orders: "orders",
  units: "units",
  grossPaise: "gross",
  refundedPaise: "refunded",
  revenuePaise: "revenue",
  firstOrderAt: "firstOrderAt",
  lastOrderAt: "lastOrderAt",
};

function customerRow(item: CustomerSalesRow): ReportRow {
  return {
    id: item.customerId ?? `guest:${item.email}`,
    customer: item.name ?? (item.isGuest ? "Guest" : item.email),
    email: item.email,
    href: item.customerId ? (`/admin/customers/${item.customerId}` as Route) : undefined,
    buyerType: item.isNew ? "new" : "returning",
    orders: item.orders,
    units: item.units,
    grossPaise: item.grossPaise,
    refundedPaise: item.refundedPaise,
    revenuePaise: item.revenuePaise,
    avgOrderPaise: item.avgOrderPaise,
    firstOrderAt: item.firstOrderAt,
    lastOrderAt: item.lastOrderAt,
  };
}

async function fetchCustomers(params: ReportRunParams, skip: number, take: number) {
  const filters = toItemFilters(params.filters, await resolveCategoryPath(params.filters.categoryId));
  const result = await customerSales(params.range, {
    filters,
    skip,
    take,
    sort: CUSTOMER_SORT[params.sort] ?? "revenue",
    order: params.order,
    onlyNew: params.filters.buyerType === "new",
    onlyReturning: params.filters.buyerType === "returning",
  });
  return { rows: result.rows.map(customerRow), total: result.total, filters };
}

export const customersReport = defineReport({
  key: "customers",
  about:
    "Buyers in the range and what they spent. A buyer is new when their first ever counted order falls inside the range, returning otherwise - judged against all their orders, not just this period. Guest checkouts are grouped by email.",
  filters: ["buyerType", "seller", "category", "paymentMethod"],
  columns: CUSTOMER_COLUMNS,
  defaultSort: "revenuePaise",
  defaultOrder: "desc",
  async run(params) {
    const { rows, total, filters } = await fetchCustomers(params, params.skip, params.pageSize);
    const [buyers, totals, newAccounts] = await Promise.all([
      buyerCounts(params.range, filters),
      revenueTotals(params.range, filters),
      newCustomerCount(params.range),
    ]);
    return {
      rows,
      meta: reportPageMeta(total, params),
      totals: [
        countTotal("buyers", "Buyers", buyers.buyers, `${buyers.guestOrders} guest orders`),
        countTotal("new", "New buyers", buyers.newBuyers),
        countTotal("returning", "Returning buyers", buyers.returningBuyers),
        percentTotal("repeatRate", "Repeat rate", pct(buyers.returningBuyers, buyers.buyers)),
        moneyTotal("revenue", "Revenue", totals.revenuePaise),
        moneyTotal("perBuyer", "Revenue per buyer", buyers.buyers > 0 ? Math.round(totals.revenuePaise / buyers.buyers) : 0),
        countTotal("accounts", "New accounts", newAccounts, "Customer records created in range"),
      ],
      chart: {
        kind: "donut",
        valueFormat: "number",
        centerLabel: "buyers",
        title: "New vs returning buyers",
        data: [
          { key: "new", label: "New", value: buyers.newBuyers },
          { key: "returning", label: "Returning", value: buyers.returningBuyers },
        ].filter((item) => item.value > 0),
      },
      note: "Spend follows the revenue rule (orders not cancelled or failed, less refunds). Lifetime segments (VIP, high value, inactive) use the customers.* thresholds and live on the customers page.",
    };
  },
  async exportPage(params, skip, take) {
    return (await fetchCustomers(params, skip, take)).rows;
  },
  async headline(range) {
    const buyers = await buyerCounts(range);
    return countTotal("new", "New buyers", buyers.newBuyers);
  },
});
