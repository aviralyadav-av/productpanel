import "server-only";

import { writeAudit, type AuditActor } from "@/lib/audit";
import { exportRows, paginateAll, type ExportColumn, type ExportFormat } from "@/lib/export";

import { pageReturnsForExport } from "./queries";
import type { ReturnListFilters } from "./schemas";

/**
 * Return export (§11.28, D13). Streamed in pages so a year of RMAs never
 * lands in memory at once, and audited with the filter plus the row count.
 */

export const RETURN_EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: "rmaNumber", label: "RMA" },
  { key: "orderNumber", label: "Order" },
  { key: "customer", label: "Customer" },
  { key: "email", label: "Email" },
  { key: "item", label: "Item" },
  { key: "variant", label: "Variant" },
  { key: "quantity", label: "Units", type: "number" },
  { key: "seller", label: "Seller" },
  { key: "reason", label: "Reason" },
  { key: "requestedResolution", label: "Requested resolution" },
  { key: "resolution", label: "Resolution" },
  { key: "status", label: "Status" },
  { key: "requestedAt", label: "Requested", type: "date" },
  { key: "updatedAt", label: "Updated", type: "date" },
  { key: "handledBy", label: "Handled by" },
  { key: "refundNumber", label: "Refund" },
  { key: "refundAmountPaise", label: "Refund amount", type: "money" },
];

export async function exportReturns(input: {
  format: ExportFormat;
  filters: ReturnListFilters;
  q: string;
  actor: AuditActor;
  ip?: string | null;
}): Promise<Response> {
  const { format, filters, q, actor, ip } = input;
  return exportRows({
    format,
    filename: `returns-${new Date().toISOString().slice(0, 10)}`,
    title: "Returns",
    columns: RETURN_EXPORT_COLUMNS,
    rows: paginateAll((skip, take) => pageReturnsForExport(filters, q, skip, take)),
    onComplete: (rowCount) =>
      writeAudit({
        actor,
        action: "return.export",
        entityType: "ReturnRequest",
        summary: `Exported ${rowCount} return${rowCount === 1 ? "" : "s"} as ${format.toUpperCase()}.`,
        diff: { filters: JSON.parse(JSON.stringify({ ...filters, q })), rowCount },
        ip: ip ?? null,
      }),
  });
}
