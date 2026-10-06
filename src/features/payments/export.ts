import "server-only";

import { writeAudit, type AuditActor } from "@/lib/audit";
import { exportRows, paginateAll, type ExportColumn, type ExportFormat } from "@/lib/export";

import { pagePaymentsForExport } from "./queries";
import type { PaymentListFilters } from "./schemas";

/**
 * Payment export (§11.28, D13). Transaction ids and customer emails leave the
 * building in this file, so the audit row records the filter and the count.
 */

export const PAYMENT_EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: "transactionId", label: "Transaction id" },
  { key: "providerOrderId", label: "Gateway order id" },
  { key: "orderNumber", label: "Order" },
  { key: "customer", label: "Customer" },
  { key: "email", label: "Email" },
  { key: "amountPaise", label: "Amount", type: "money" },
  { key: "currency", label: "Currency" },
  { key: "provider", label: "Gateway" },
  { key: "method", label: "Method" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "createdAt", label: "Created", type: "date" },
  { key: "capturedAt", label: "Captured", type: "date" },
  { key: "refundNumber", label: "Refund" },
];

export async function exportPayments(input: {
  format: ExportFormat;
  filters: PaymentListFilters;
  q: string;
  actor: AuditActor;
  ip?: string | null;
}): Promise<Response> {
  const { format, filters, q, actor, ip } = input;
  return exportRows({
    format,
    filename: `payments-${new Date().toISOString().slice(0, 10)}`,
    title: "Payments",
    columns: PAYMENT_EXPORT_COLUMNS,
    rows: paginateAll((skip, take) => pagePaymentsForExport(filters, q, skip, take)),
    onComplete: (rowCount) =>
      writeAudit({
        actor,
        action: "payment.export",
        entityType: "OrderPayment",
        summary: `Exported ${rowCount} payment${rowCount === 1 ? "" : "s"} as ${format.toUpperCase()}.`,
        diff: { filters: JSON.parse(JSON.stringify({ ...filters, q })), rowCount },
        ip: ip ?? null,
      }),
  });
}
