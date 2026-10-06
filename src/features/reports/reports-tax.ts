import { countTotal, defineReport, moneyTotal, pageRows, pct, percentTotal, slicePage, sortRows, toItemFilters } from "./define";
import { taxSummary } from "./metrics-finance";
import { resolveCategoryPath, type ItemFilters } from "./sql";
import type { ReportColumn, ReportRunParams } from "./types";

/**
 * The tax report (E4: "Tax report groups by (hsnCodeSnapshot, taxRateBps)") -
 * the return an accountant asks for at the end of a period, kept in its own
 * file because it is read by a different audience than the seller-money
 * reports and its grouping is fixed by statute rather than by preference.
 *
 * Every figure comes from the tax SNAPSHOT on each order line, never from the
 * product's current tax settings: a rate changed in March must not rewrite
 * February's return.
 */

/** Report filters → line filters; the category id covers its whole subtree. */
async function itemFilters(params: ReportRunParams): Promise<ItemFilters> {
  return toItemFilters(params.filters, await resolveCategoryPath(params.filters.categoryId));
}

const TAX_COLUMNS: readonly ReportColumn[] = [
  { key: "hsnCode", label: "HSN", type: "string", sortable: true, locked: true },
  { key: "taxRateBps", label: "Rate", type: "bps", sortable: true },
  { key: "lines", label: "Lines", type: "number", sortable: true, total: true, defaultHidden: true },
  { key: "units", label: "Units", type: "number", sortable: true, total: true },
  { key: "taxableValuePaise", label: "Taxable value", type: "money", sortable: true, total: true },
  { key: "taxPaise", label: "Tax", type: "money", sortable: true, total: true },
  { key: "grossPaise", label: "Gross", type: "money", sortable: true, total: true, hint: "Taxable value + tax" },
];

async function taxRows(params: ReportRunParams) {
  const filters = await itemFilters(params);
  const items = await taxSummary(params.range, filters);
  const rows = sortRows(
    items.map((item) => ({
      id: `${item.hsnCode ?? "none"}:${item.taxRateBps}`,
      hsnCode: item.hsnCode ?? "No HSN",
      taxRateBps: item.taxRateBps,
      lines: item.lines,
      units: item.units,
      taxableValuePaise: item.taxableValuePaise,
      taxPaise: item.taxPaise,
      grossPaise: item.grossPaise,
    })),
    params.sort,
    params.order,
    "hsnCode",
  );
  return { items, rows };
}

export const taxReport = defineReport({
  key: "tax",
  about:
    "Taxable value and tax grouped by HSN code and rate, from the tax snapshot on every line of counted orders. Works for inclusive and exclusive pricing alike: taxable value is the line total less its tax.",
  filters: ["seller", "category", "product", "paymentMethod"],
  columns: TAX_COLUMNS,
  defaultSort: "taxPaise",
  defaultOrder: "desc",
  async run(params) {
    const { items, rows } = await taxRows(params);
    const taxable = items.reduce((sum, item) => sum + item.taxableValuePaise, 0);
    const tax = items.reduce((sum, item) => sum + item.taxPaise, 0);
    const byRate = new Map<number, number>();
    for (const item of items) byRate.set(item.taxRateBps, (byRate.get(item.taxRateBps) ?? 0) + item.taxPaise);
    return {
      ...pageRows(rows, params),
      totals: [
        moneyTotal("taxable", "Taxable value", taxable),
        moneyTotal("tax", "Tax", tax),
        moneyTotal("gross", "Gross", taxable + tax),
        percentTotal("effective", "Effective rate", pct(tax, taxable)),
        countTotal("hsn", "HSN codes", new Set(items.map((item) => item.hsnCode)).size),
      ],
      chart: {
        kind: "bar",
        valueFormat: "money",
        title: "Tax by rate",
        data: [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([bps, value]) => ({ label: `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`, value })),
      },
      note: "Shipping and COD fees carry no tax line and are not included. Refunds do not reduce the tax reported here; reconcile them against the refunds report.",
    };
  },
  async exportPage(params, skip, take) {
    return slicePage((await taxRows(params)).rows, skip, take);
  },
  async headline(range) {
    const items = await taxSummary(range);
    return moneyTotal("tax", "Tax collected", items.reduce((sum, item) => sum + item.taxPaise, 0));
  },
});
