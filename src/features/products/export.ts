import "server-only";

import { writeAudit, type AuditActor } from "@/lib/audit";
import { exportRows, paginateAll, type ExportColumn, type ExportFormat } from "@/lib/export";
import { getSettingString } from "@/lib/settings";
import type { ListParams } from "@/lib/list-params";

import type { ProductListFilters } from "./filters";
import { listProducts, type ProductRow } from "./queries";

/**
 * Product list export (blueprint E4, D13). Streams the CURRENT filter in
 * pages through the shared exporter so a 50k-row catalogue never sits in
 * memory, and audits the export with its filter and row count once the last
 * row is written.
 */

export const PRODUCT_EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "slug", label: "Slug" },
  { key: "baseSku", label: "Base SKU" },
  { key: "status", label: "Status" },
  { key: "categoryPath", label: "Category" },
  { key: "sellerName", label: "Seller" },
  { key: "pricePaise", label: "Price", type: "money" },
  { key: "salePricePaise", label: "Sale price", type: "money" },
  { key: "effectivePricePaise", label: "Effective price", type: "money" },
  { key: "onHand", label: "On hand", type: "number" },
  { key: "available", label: "Available", type: "number" },
  { key: "stockState", label: "Stock state" },
  { key: "variantCount", label: "Variants", type: "number" },
  { key: "isFeatured", label: "Featured", type: "boolean" },
  { key: "isNewArrival", label: "New arrival", type: "boolean" },
  { key: "isBestseller", label: "Bestseller", type: "boolean" },
  { key: "isTrending", label: "Trending", type: "boolean" },
  { key: "isCustomizable", label: "Customisable", type: "boolean" },
  { key: "createdAt", label: "Created", type: "date" },
  { key: "updatedAt", label: "Updated", type: "date" },
];

export async function exportProducts(input: {
  format: ExportFormat;
  params: ListParams;
  filters: ProductListFilters;
  actor: AuditActor;
  ip?: string | null;
}): Promise<Response> {
  const storeName = await getSettingString("store.name").catch(() => "DIY Baazar");
  const stamp = new Date().toISOString().slice(0, 10);
  return exportRows({
    format: input.format,
    filename: `products-${stamp}`,
    title: `Products - ${stamp}`,
    storeName,
    columns: PRODUCT_EXPORT_COLUMNS,
    rows: paginateAll<ProductRow>(
      async (skip, take) => (await listProducts({ ...input.params, skip, page: Math.floor(skip / take) + 1, pageSize: take }, input.filters)).rows,
      { pageSize: 1000, map: (row) => ({ ...row, sellerName: row.sellerName ?? "Platform" }) },
    ),
    onComplete: (rowCount) =>
      writeAudit({
        actor: input.actor,
        action: "product.export",
        entityType: "product",
        summary: `Exported ${rowCount} product row(s) as ${input.format.toUpperCase()}.`,
        diff: { format: input.format, rowCount, filters: JSON.parse(JSON.stringify(input.filters)) },
        ip: input.ip,
      }),
  });
}
