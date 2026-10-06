import "server-only";

import { writeAudit, type AuditActor } from "@/lib/audit";
import type { DateRange } from "@/lib/dates";
import { formatIstDate } from "@/lib/dates";
import {
  exportRows,
  paginateAll,
  type ExportColumn,
  type ExportFormat,
  type ExportRow,
} from "@/lib/export";

import { pageLedgerForExport, pagePayoutsForExport } from "./payout-queries";
import type { LedgerFilters, PayoutListFilters } from "./ui-schemas";

/**
 * Statement and ledger exports (blueprint §14.D13: every export is audited
 * with its filter and row count; §D15: the shared writer defuses spreadsheet
 * formula injection).
 *
 * Rows are streamed through `paginateAll` so a year of ledger entries never
 * lands in memory at once. The fetch callbacks return EXACTLY what the query
 * returned - no JS-side filtering - because `paginateAll` treats a short page
 * as end-of-stream and would silently truncate the file otherwise.
 */

export const PAYOUT_EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: "payoutNumber", label: "Statement" },
  { key: "sellerName", label: "Seller" },
  { key: "status", label: "Status" },
  { key: "method", label: "Method" },
  { key: "periodFrom", label: "Period from", type: "date" },
  { key: "periodTo", label: "Period to", type: "date" },
  { key: "grossSalesPaise", label: "Gross sales", type: "money" },
  { key: "commissionPaise", label: "Commission", type: "money" },
  { key: "chargesPaise", label: "Charges", type: "money" },
  { key: "refundsPaise", label: "Refund reversals", type: "money" },
  { key: "adjustmentsPaise", label: "Adjustments", type: "money" },
  { key: "netPaise", label: "Net payable", type: "money" },
  { key: "entryCount", label: "Entries", type: "number" },
  { key: "referenceNumber", label: "Bank reference" },
  { key: "createdAt", label: "Created", type: "date" },
  { key: "paidAt", label: "Paid", type: "date" },
];

export const LEDGER_EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: "createdAt", label: "Recorded", type: "date" },
  { key: "sellerName", label: "Seller" },
  { key: "typeLabel", label: "Type" },
  { key: "amountPaise", label: "Amount", type: "money" },
  { key: "statusLabel", label: "Status" },
  { key: "availableAt", label: "Available at", type: "date" },
  { key: "description", label: "Description" },
  { key: "orderNumber", label: "Order" },
  { key: "itemTitle", label: "Item" },
  { key: "payoutNumber", label: "Statement" },
];

function rangeLabel(range?: DateRange): string {
  return range ? `${formatIstDate(range.from)} to ${formatIstDate(range.to)}` : "all time";
}

export async function exportPayouts(input: {
  format: ExportFormat;
  filters: PayoutListFilters;
  range?: DateRange;
  actor: AuditActor;
  ip?: string | null;
}): Promise<Response> {
  const { format, filters, range, actor, ip } = input;

  return exportRows({
    format,
    filename: `payout-statements-${new Date().toISOString().slice(0, 10)}`,
    title: `Payout statements · ${rangeLabel(range)}`,
    columns: PAYOUT_EXPORT_COLUMNS,
    rows: paginateAll<ExportRow>((skip, take) =>
      pagePayoutsForExport(filters, range, skip, take) as Promise<ExportRow[]>,
    ),
    onComplete: async (rowCount) => {
      await writeAudit({
        actor,
        action: "payout.export",
        entityType: "SellerPayout",
        entityId: null,
        entityLabel: "Payout statements",
        summary: `Exported ${rowCount} payout statement${rowCount === 1 ? "" : "s"} as ${format.toUpperCase()}`,
        diff: { format, filters, range: rangeLabel(range), rowCount },
        ip,
      });
    },
  });
}

export async function exportLedger(input: {
  format: ExportFormat;
  filters: LedgerFilters;
  range?: DateRange;
  actor: AuditActor;
  ip?: string | null;
}): Promise<Response> {
  const { format, filters, range, actor, ip } = input;

  return exportRows({
    format,
    filename: `seller-ledger-${new Date().toISOString().slice(0, 10)}`,
    title: `Seller ledger · ${rangeLabel(range)}`,
    columns: LEDGER_EXPORT_COLUMNS,
    rows: paginateAll<ExportRow>((skip, take) =>
      pageLedgerForExport(filters, range, skip, take) as Promise<ExportRow[]>,
    ),
    onComplete: async (rowCount) => {
      await writeAudit({
        actor,
        action: "payout.ledger_export",
        entityType: "SellerLedgerEntry",
        entityId: null,
        entityLabel: "Seller ledger",
        summary: `Exported ${rowCount} ledger entr${rowCount === 1 ? "y" : "ies"} as ${format.toUpperCase()}`,
        diff: { format, filters, range: rangeLabel(range), rowCount },
        ip,
      });
    },
  });
}
