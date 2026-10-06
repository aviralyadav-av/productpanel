import "server-only";

import { writeAudit, type AuditActor } from "@/lib/audit";
import { exportRows, paginateAll, type ExportColumn, type ExportFormat } from "@/lib/export";
import { CUSTOMER_SEGMENT_META } from "@/lib/enums";
import type { ListParams } from "@/lib/list-params";
import { getSettingString } from "@/lib/settings";

import type { CustomerListFilters } from "./filters";
import { listCustomers, resolveSegmentThresholds, type CustomerRow } from "./queries";

/**
 * Customer list export (blueprint E4, D13). Streams the CURRENT filter (or an
 * explicit id list from the bulk bar) through the shared exporter and audits
 * the filter plus row count once the last row is written. Formula-injection
 * quoting is handled by the exporter (D15).
 */

export const CUSTOMER_EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: "id", label: "ID" },
  { key: "fullName", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "status", label: "Status" },
  { key: "segmentLabel", label: "Segment" },
  { key: "tagList", label: "Tags" },
  { key: "acceptsMarketing", label: "Accepts marketing", type: "boolean" },
  { key: "orderCount", label: "Orders", type: "number" },
  { key: "totalSpentPaise", label: "Total spent", type: "money" },
  { key: "firstOrderAt", label: "First order", type: "date" },
  { key: "lastOrderAt", label: "Last order", type: "date" },
  { key: "lastLoginAt", label: "Last login", type: "date" },
  { key: "createdAt", label: "Registered", type: "date" },
];

export async function exportCustomers(input: {
  format: ExportFormat;
  params: ListParams;
  filters: CustomerListFilters;
  /** From the bulk bar: restrict to these ids (still within the filter). */
  ids?: string[];
  actor: AuditActor;
  ip?: string | null;
}): Promise<Response> {
  const [storeName, thresholds] = await Promise.all([getSettingString("store.name").catch(() => "DIY Baazar"), resolveSegmentThresholds()]);
  const stamp = new Date().toISOString().slice(0, 10);
  // The id list narrows the SQL, not the fetched page: filtering in JS would
  // hand paginateAll a short page and stop the stream early (it treats
  // `page.length < take` as "no more rows").
  const filters: CustomerListFilters = input.ids && input.ids.length > 0 ? { ...input.filters, ids: input.ids } : input.filters;

  return exportRows({
    format: input.format,
    filename: `customers-${stamp}`,
    title: `Customers - ${stamp}`,
    storeName,
    columns: CUSTOMER_EXPORT_COLUMNS,
    rows: paginateAll<CustomerRow>(
      async (skip, take) => {
        const page = await listCustomers({ ...input.params, skip, page: Math.floor(skip / take) + 1, pageSize: take }, filters, thresholds);
        return page.rows;
      },
      {
        pageSize: 1000,
        map: (row) => ({
          ...row,
          segmentLabel: row.segment ? CUSTOMER_SEGMENT_META[row.segment].label : "",
          tagList: row.tags.join(", "),
        }),
      },
    ),
    onComplete: (rowCount) =>
      writeAudit({
        actor: input.actor,
        action: "customer.export",
        entityType: "customer",
        summary: `Exported ${rowCount} customer row(s) as ${input.format.toUpperCase()}.`,
        diff: { format: input.format, rowCount, ids: input.ids?.length ?? null, filters: JSON.parse(JSON.stringify(input.filters)) },
        ip: input.ip,
      }),
  });
}
