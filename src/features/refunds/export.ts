import "server-only";

import { writeAudit, type AuditActor } from "@/lib/audit";
import { exportRows, paginateAll, type ExportColumn, type ExportFormat } from "@/lib/export";

import { pageRefundsForExport } from "./queries";
import type { RefundListFilters } from "./schemas";

/**
 * Refund export (§11.28, D13). A refund file is a financial record, so the
 * audit row keeps the filter and the row count.
 */

export const REFUND_EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: "refundNumber", label: "Refund" },
  { key: "orderNumber", label: "Order" },
  { key: "customer", label: "Customer" },
  { key: "email", label: "Email" },
  { key: "amountPaise", label: "Amount", type: "money" },
  { key: "method", label: "Method" },
  { key: "provider", label: "Provider" },
  { key: "status", label: "Status" },
  { key: "rmaNumber", label: "RMA" },
  { key: "reason", label: "Reason" },
  { key: "createdAt", label: "Created", type: "date" },
  { key: "completedAt", label: "Completed", type: "date" },
  { key: "approvedBy", label: "Approved by" },
];

export async function exportRefunds(input: {
  format: ExportFormat;
  filters: RefundListFilters;
  q: string;
  actor: AuditActor;
  ip?: string | null;
}): Promise<Response> {
  const { format, filters, q, actor, ip } = input;
  return exportRows({
    format,
    filename: `refunds-${new Date().toISOString().slice(0, 10)}`,
    title: "Refunds",
    columns: REFUND_EXPORT_COLUMNS,
    rows: paginateAll((skip, take) => pageRefundsForExport(filters, q, skip, take)),
    onComplete: (rowCount) =>
      writeAudit({
        actor,
        action: "refund.export",
        entityType: "Refund",
        summary: `Exported ${rowCount} refund${rowCount === 1 ? "" : "s"} as ${format.toUpperCase()}.`,
        diff: { filters: JSON.parse(JSON.stringify({ ...filters, q })), rowCount },
        ip: ip ?? null,
      }),
  });
}
