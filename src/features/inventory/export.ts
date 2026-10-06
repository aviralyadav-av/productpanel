import "server-only";

import { writeAudit, type AuditActor } from "@/lib/audit";
import { exportRows, paginateAll, type ExportColumn, type ExportFormat } from "@/lib/export";
import { STOCK_MOVEMENT_META, STOCK_STATE_META } from "@/lib/enums";
import { formatIstDateTime } from "@/lib/dates";
import {
  buildMovementScope,
  buildVariantScope,
  fetchInventoryPage,
  fetchMovementPage,
  inventoryOrderBy,
  withStockFilter,
} from "./queries";
import type { InventoryFilters, InventorySort, MovementFilters } from "./schemas";

/**
 * Exports stream the same rows the tables show, page by page (§11.28), and
 * every export is audited with its filter and row count (D13). Money columns
 * are paise in and rupees out - the export library owns that conversion.
 */

const LEVEL_COLUMNS: readonly ExportColumn[] = [
  { key: "product", label: "Product" },
  { key: "variant", label: "Variant" },
  { key: "sku", label: "SKU" },
  { key: "seller", label: "Seller" },
  { key: "category", label: "Category" },
  { key: "onHand", label: "On hand", type: "number" },
  { key: "reserved", label: "Reserved", type: "number" },
  { key: "available", label: "Available", type: "number" },
  { key: "threshold", label: "Low-stock threshold", type: "number" },
  { key: "allowBackorder", label: "Allow backorder", type: "boolean" },
  { key: "state", label: "State" },
  { key: "unitCost", label: "Unit cost", type: "money" },
  { key: "value", label: "Value at cost", type: "money" },
  { key: "updatedAt", label: "Updated (IST)" },
];

const MOVEMENT_COLUMNS: readonly ExportColumn[] = [
  { key: "at", label: "Time (IST)" },
  { key: "product", label: "Product" },
  { key: "variant", label: "Variant" },
  { key: "sku", label: "SKU" },
  { key: "type", label: "Type" },
  { key: "delta", label: "Change", type: "number" },
  { key: "reservedDelta", label: "Reserved change", type: "number" },
  { key: "balance", label: "Balance", type: "number" },
  { key: "reservedBalance", label: "Reserved balance", type: "number" },
  { key: "reason", label: "Reason" },
  { key: "note", label: "Note" },
  { key: "order", label: "Order" },
  { key: "actor", label: "By" },
];

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function exportInventoryLevels(input: {
  format: ExportFormat;
  q: string;
  sort: InventorySort;
  order: "asc" | "desc";
  filters: InventoryFilters;
  actor: AuditActor;
  ip?: string | null;
}): Promise<Response> {
  const scope = await buildVariantScope(input.q, input.filters);
  const where = withStockFilter(scope, input.filters);
  const orderBy = inventoryOrderBy(input.sort, input.order);

  return exportRows({
    format: input.format,
    filename: `inventory-${stamp()}`,
    title: "Stock levels",
    columns: LEVEL_COLUMNS,
    rows: paginateAll((skip, take) => fetchInventoryPage(where, orderBy, skip, take), {
      map: (row) => ({
        product: row.productTitle,
        variant: row.variantName,
        sku: row.sku ?? "",
        seller: row.sellerName ?? "Platform",
        category: row.categoryName ?? "",
        onHand: row.onHand,
        reserved: row.reserved,
        available: row.available,
        threshold: row.lowStockThreshold,
        allowBackorder: row.allowBackorder,
        state: STOCK_STATE_META[row.stockState].label,
        unitCost: row.costPaise,
        value: row.valuePaise,
        updatedAt: row.updatedAt ? formatIstDateTime(row.updatedAt) : "",
      }),
    }),
    onComplete: (rowCount) =>
      writeAudit({
        actor: input.actor,
        action: "inventory.export",
        entityType: "InventoryItem",
        summary: `Exported ${rowCount} stock rows (${input.format})`,
        diff: { scope: "levels", format: input.format, q: input.q, ...serialisable(input.filters), rowCount },
        ip: input.ip,
      }),
  });
}

export async function exportStockMovements(input: {
  format: ExportFormat;
  filters: MovementFilters & { q?: string; orderId?: string };
  actor: AuditActor;
  ip?: string | null;
}): Promise<Response> {
  const scope = buildMovementScope(input.filters);
  const where = input.filters.type ? { ...scope, type: input.filters.type } : scope;

  return exportRows({
    format: input.format,
    filename: `stock-movements-${stamp()}`,
    title: "Stock movements",
    columns: MOVEMENT_COLUMNS,
    rows: paginateAll((skip, take) => fetchMovementPage(where, skip, take), {
      map: (row) => ({
        at: formatIstDateTime(row.createdAt),
        product: row.productTitle,
        variant: row.variantName,
        sku: row.sku ?? "",
        type: STOCK_MOVEMENT_META[row.type]?.label ?? row.type,
        delta: row.delta,
        reservedDelta: row.reservedDelta,
        balance: row.balance,
        reservedBalance: row.reservedBalance,
        reason: row.reason ?? "",
        note: row.note ?? "",
        order: row.orderNumber ?? "",
        actor: row.actorName ?? "System",
      }),
    }),
    onComplete: (rowCount) =>
      writeAudit({
        actor: input.actor,
        action: "inventory.export",
        entityType: "StockMovement",
        summary: `Exported ${rowCount} stock movements (${input.format})`,
        diff: { scope: "movements", format: input.format, ...serialisable(input.filters), rowCount },
        ip: input.ip,
      }),
  });
}

/** Dates → ISO strings and undefineds dropped so the diff is valid JSON. */
function serialisable(filters: Record<string, unknown>): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    if (value instanceof Date) out[key] = value.toISOString();
    else if (Array.isArray(value)) out[key] = value.map(String);
    else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}
