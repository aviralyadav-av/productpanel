import type { Route } from "next";

import { STOCK_STATE_META, type StockState } from "@/lib/enums";
import { countTotal, defineReport, moneyTotal, pageRows, pct, percentTotal, reportPageMeta, slicePage, sortRows, toItemFilters } from "./define";
import {
  inventoryValuation,
  inventoryValuationRows,
  salesByCategory,
  topProducts,
  type CategorySales,
  type InventoryValuationRow,
  type ProductSales,
} from "./metrics-catalog";
import { productSalesSeries } from "./metrics-sales";
import { resolveCategoryPath, type ItemFilters } from "./sql";
import type { ReportColumn, ReportRow, ReportRunParams } from "./types";

/**
 * Catalogue reports: products, categories and inventory. Sales figures are
 * line-level (see metrics-catalog.ts); the inventory report is a snapshot of
 * now and ignores the date range.
 */

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const PRODUCT_COLUMNS: readonly ReportColumn[] = [
  { key: "title", label: "Product", type: "string", sortable: true, locked: true, hrefKey: "href", subtitleKey: "subtitle" },
  { key: "sellerName", label: "Seller", type: "string" },
  { key: "units", label: "Units", type: "number", sortable: true, total: true },
  { key: "orders", label: "Orders", type: "number", sortable: true, total: true },
  { key: "avgUnitPricePaise", label: "Avg price", type: "money", hint: "Realised selling price per unit" },
  { key: "discountPaise", label: "Discounts", type: "money", sortable: true, total: true, defaultHidden: true },
  { key: "refundedPaise", label: "Refunded", type: "money", sortable: true, total: true },
  { key: "returnedQty", label: "Returned", type: "number", total: true, defaultHidden: true },
  { key: "itemRevenuePaise", label: "Revenue", type: "money", sortable: true, total: true, hint: "Line totals − refunds" },
  { key: "costPaise", label: "Cost", type: "money", total: true, defaultHidden: true, hint: "Σ cost snapshot × qty" },
  { key: "marginPaise", label: "Margin", type: "money", total: true, defaultHidden: true, hint: "Revenue − cost, where cost is known" },
];

const PRODUCT_SORT: Record<string, NonNullable<Parameters<typeof topProducts>[1]>["by"]> = {
  title: "title",
  units: "units",
  orders: "orders",
  discountPaise: "discount",
  refundedPaise: "refunded",
  itemRevenuePaise: "revenue",
};

function productRow(item: ProductSales): ReportRow {
  return {
    id: `${item.productId ?? "deleted"}:${item.variantId ?? "all"}`,
    title: item.title,
    subtitle: [item.variantName, item.sku].filter(Boolean).join(" · "),
    href: item.productId ? (`/admin/products/${item.productId}` as Route) : undefined,
    sellerName: item.sellerName ?? "Platform",
    units: item.units,
    orders: item.orders,
    avgUnitPricePaise: item.avgUnitPricePaise,
    discountPaise: item.discountPaise,
    refundedPaise: item.refundedPaise,
    returnedQty: item.returnedQty,
    itemRevenuePaise: item.itemRevenuePaise,
    costPaise: item.costPaise,
    marginPaise: item.costPaise === null ? null : item.itemRevenuePaise - item.costPaise,
  };
}

async function productFilters(params: ReportRunParams): Promise<ItemFilters> {
  return toItemFilters(params.filters, await resolveCategoryPath(params.filters.categoryId));
}

async function fetchProducts(params: ReportRunParams, skip: number, take: number) {
  const filters = await productFilters(params);
  const result = await topProducts(params.range, {
    filters,
    limit: take,
    skip,
    by: PRODUCT_SORT[params.sort] ?? "revenue",
    order: params.order,
    byProduct: params.filters.groupBy === "product",
  });
  return { rows: result.rows.map(productRow), total: result.total, filters };
}

export const productsReport = defineReport({
  key: "products",
  about:
    "Units and revenue per product variant from the lines of counted orders. Titles and SKUs are the snapshots taken at sale, so a renamed product shows the name it sold under. Fold variants together with the grouping control.",
  filters: ["groupBy", "seller", "category", "product", "paymentMethod"],
  groupByOptions: [
    { value: "variant", label: "Per variant" },
    { value: "product", label: "Per product" },
  ],
  columns: PRODUCT_COLUMNS,
  defaultSort: "itemRevenuePaise",
  defaultOrder: "desc",
  async run(params) {
    const { rows, total, filters } = await fetchProducts(params, params.skip, params.pageSize);
    const [top, series] = await Promise.all([
      topProducts(params.range, { filters, limit: 10, by: "revenue", byProduct: true }),
      productSalesSeries(params.range, { bucket: "day", filters }),
    ]);
    const units = series.reduce((sum, item) => sum + item.units, 0);
    const revenue = series.reduce((sum, item) => sum + item.itemRevenuePaise, 0);
    const lines = series.reduce((sum, item) => sum + item.lines, 0);
    return {
      rows,
      meta: reportPageMeta(total, params),
      totals: [
        moneyTotal("revenue", "Item revenue", revenue, "Line totals − refunds"),
        countTotal("units", "Units sold", units),
        countTotal("lines", "Order lines", lines),
        countTotal("skus", "Variants sold", total),
        moneyTotal("avgUnit", "Avg unit price", units > 0 ? Math.round(revenue / units) : 0),
      ],
      chart: {
        kind: "bar",
        horizontal: true,
        valueFormat: "money",
        title: "Top products by revenue",
        data: top.rows.map((item) => ({ label: item.title, value: item.itemRevenuePaise })),
      },
    };
  },
  async exportPage(params, skip, take) {
    return (await fetchProducts(params, skip, take)).rows;
  },
  async headline(range) {
    const series = await productSalesSeries(range, { bucket: "month" });
    return countTotal("units", "Units sold", series.reduce((sum, item) => sum + item.units, 0));
  },
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const CATEGORY_COLUMNS: readonly ReportColumn[] = [
  { key: "name", label: "Category", type: "string", sortable: true, locked: true, hrefKey: "href", subtitleKey: "path" },
  { key: "units", label: "Units", type: "number", sortable: true, total: true },
  { key: "lines", label: "Lines", type: "number", sortable: true, total: true, defaultHidden: true },
  { key: "orders", label: "Orders", type: "number", sortable: true, total: true },
  { key: "discountPaise", label: "Discounts", type: "money", sortable: true, total: true, defaultHidden: true },
  { key: "taxPaise", label: "Tax", type: "money", sortable: true, total: true, defaultHidden: true },
  { key: "itemRevenuePaise", label: "Revenue", type: "money", sortable: true, total: true, hint: "Line totals − refunds" },
  { key: "sharePct", label: "Share", type: "percent", sortable: true, hint: "Of the range's item revenue" },
];

function categoryRow(item: CategorySales, totalRevenue: number): ReportRow {
  return {
    id: item.path ?? "uncategorised",
    name: item.name,
    path: item.path ?? "",
    href: item.categoryId ? (`/admin/categories/${item.categoryId}` as Route) : undefined,
    units: item.units,
    lines: item.lines,
    orders: item.orders,
    discountPaise: item.discountPaise,
    taxPaise: item.taxPaise,
    itemRevenuePaise: item.itemRevenuePaise,
    sharePct: pct(item.itemRevenuePaise, totalRevenue),
  };
}

async function categoryRows(params: ReportRunParams) {
  const filters = await productFilters(params);
  const level = params.filters.level ?? "root";
  const items = await salesByCategory(params.range, { level, filters });
  const totalRevenue = items.reduce((sum, item) => sum + item.itemRevenuePaise, 0);
  const rows = sortRows(
    items.map((item) => categoryRow(item, totalRevenue)),
    params.sort,
    params.order,
    "name",
  );
  return { rows, items, totalRevenue, level };
}

export const categoriesReport = defineReport({
  key: "categories",
  about:
    "Sales rolled up the category tree from each line's category at the time of sale. Top-level groups every descendant under its root; switch to leaf categories for the exact path.",
  filters: ["level", "seller", "category", "paymentMethod"],
  columns: CATEGORY_COLUMNS,
  defaultSort: "itemRevenuePaise",
  defaultOrder: "desc",
  async run(params) {
    const { rows, items, totalRevenue, level } = await categoryRows(params);
    const units = items.reduce((sum, item) => sum + item.units, 0);
    const top = [...items].sort((a, b) => b.itemRevenuePaise - a.itemRevenuePaise).slice(0, 10);
    return {
      ...pageRows(rows, params),
      totals: [
        moneyTotal("revenue", "Item revenue", totalRevenue),
        countTotal("units", "Units", units),
        countTotal("categories", level === "root" ? "Root categories" : "Leaf categories", items.length),
        percentTotal("topShare", "Top category share", pct(top[0]?.itemRevenuePaise ?? 0, totalRevenue), top[0]?.name),
      ],
      chart: {
        kind: "bar",
        horizontal: true,
        valueFormat: "money",
        title: `Revenue by ${level === "root" ? "top-level" : "leaf"} category`,
        data: top.map((item) => ({ label: item.name, value: item.itemRevenuePaise })),
      },
      note: "Lines without a category snapshot are shown as Uncategorised so the totals still reconcile with the products report.",
    };
  },
  async exportPage(params, skip, take) {
    return slicePage((await categoryRows(params)).rows, skip, take);
  },
  async headline(range) {
    const items = await salesByCategory(range, { level: "root" });
    return countTotal("categories", "Categories sold", items.filter((item) => item.path).length);
  },
});

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

const INVENTORY_COLUMNS: readonly ReportColumn[] = [
  { key: "title", label: "Product", type: "string", sortable: true, locked: true, hrefKey: "href", subtitleKey: "subtitle" },
  { key: "sellerName", label: "Seller", type: "string", defaultHidden: true },
  { key: "categoryName", label: "Category", type: "string", defaultHidden: true },
  { key: "stockState", label: "State", type: "status", statusKind: "stock", sortable: true },
  { key: "onHand", label: "On hand", type: "number", sortable: true, total: true },
  { key: "reserved", label: "Reserved", type: "number", sortable: true, total: true },
  { key: "available", label: "Available", type: "number", sortable: true, total: true },
  { key: "lowStockThreshold", label: "Threshold", type: "number", defaultHidden: true },
  { key: "unitCostPaise", label: "Unit cost", type: "money" },
  { key: "costValuePaise", label: "Value at cost", type: "money", sortable: true, total: true },
  { key: "unitPricePaise", label: "Unit price", type: "money", defaultHidden: true },
  { key: "retailValuePaise", label: "Value at price", type: "money", sortable: true, total: true },
  { key: "updatedAt", label: "Updated", type: "datetime", sortable: true, defaultHidden: true },
];

const INVENTORY_SORT: Record<string, string> = {
  title: "title",
  stockState: "stockState",
  onHand: "onHand",
  reserved: "reserved",
  available: "available",
  costValuePaise: "costValue",
  retailValuePaise: "retailValue",
  updatedAt: "updatedAt",
};

function inventoryRow(item: InventoryValuationRow): ReportRow {
  return {
    id: item.variantId,
    title: item.title,
    subtitle: [item.variantName, item.sku].filter(Boolean).join(" · "),
    href: `/admin/inventory?variant=${item.variantId}` as Route,
    sellerName: item.sellerName ?? "Platform",
    categoryName: item.categoryName ?? "",
    stockState: item.stockState,
    onHand: item.onHand,
    reserved: item.reserved,
    available: item.available,
    lowStockThreshold: item.lowStockThreshold,
    unitCostPaise: item.unitCostPaise,
    costValuePaise: item.costValuePaise,
    unitPricePaise: item.unitPricePaise,
    retailValuePaise: item.retailValuePaise,
    updatedAt: item.updatedAt,
  };
}

async function inventoryScope(params: ReportRunParams) {
  return {
    sellerId: params.filters.sellerId,
    categoryPath: await resolveCategoryPath(params.filters.categoryId),
    stockState: params.filters.stockState,
  };
}

export const inventoryReport = defineReport({
  key: "inventory",
  about:
    "Stock on hand per variant valued at cost and at list price, with the stock state the storefront sees. This is a snapshot of now; the date range does not apply.",
  filters: ["stockState", "seller", "category"],
  columns: INVENTORY_COLUMNS,
  defaultSort: "costValuePaise",
  defaultOrder: "desc",
  async run(params) {
    const scope = await inventoryScope(params);
    const [page, valuation] = await Promise.all([
      inventoryValuationRows(scope, {
        skip: params.skip,
        take: params.pageSize,
        sort: INVENTORY_SORT[params.sort] ?? "costValue",
        order: params.order,
      }),
      inventoryValuation({ ...scope, stockState: undefined }),
    ]);
    const states = Object.entries(valuation.byState) as Array<[StockState, number]>;
    return {
      rows: page.rows.map(inventoryRow),
      meta: reportPageMeta(page.total, params),
      totals: [
        moneyTotal("costValue", "Value at cost", valuation.costValuePaise, valuation.uncostedSkus ? `${valuation.uncostedSkus} variants have no cost` : undefined),
        moneyTotal("retailValue", "Value at price", valuation.retailValuePaise),
        countTotal("units", "Units on hand", valuation.unitsOnHand),
        countTotal("reserved", "Reserved", valuation.unitsReserved),
        countTotal("low", "Low stock", valuation.byState.LOW_STOCK),
        countTotal("out", "Out of stock", valuation.byState.OUT_OF_STOCK + valuation.byState.BACKORDER),
      ],
      chart: {
        kind: "donut",
        valueFormat: "number",
        centerLabel: "variants",
        title: "Variants by stock state",
        data: states.filter(([, count]) => count > 0).map(([state, count]) => ({ key: state, label: STOCK_STATE_META[state].label, value: count })),
      },
      note: "Value at cost uses the variant cost, falling back to the product cost; variants without either count as zero. Soft-deleted variants and products are excluded.",
    };
  },
  async exportPage(params, skip, take) {
    const scope = await inventoryScope(params);
    const page = await inventoryValuationRows(scope, { skip, take, sort: INVENTORY_SORT[params.sort] ?? "costValue", order: params.order });
    return page.rows.map(inventoryRow);
  },
  async headline() {
    const valuation = await inventoryValuation();
    return moneyTotal("costValue", "Stock at cost", valuation.costValuePaise);
  },
});
