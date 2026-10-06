import "server-only";

import { writeAudit, type AuditActor } from "@/lib/audit";
import { exportRows, paginateAll, type ExportColumn, type ExportFormat } from "@/lib/export";
import { getSettingString } from "@/lib/settings";

import { pageAuditForExport } from "./queries";
import type { AuditFilters, AuditSort } from "./schemas";

/**
 * Audit log export (blueprint D13: every export is itself audited, with the
 * filter and the row count).
 *
 * Streamed page by page - this table is the largest in the database and the
 * one most likely to be exported wholesale during an incident.
 */
export const AUDIT_EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: "createdAt", label: "When (IST)", type: "date" },
  { key: "actorEmail", label: "Actor" },
  { key: "actorName", label: "Actor name" },
  { key: "action", label: "Action" },
  { key: "entityType", label: "Entity type" },
  { key: "entityId", label: "Entity id" },
  { key: "entityLabel", label: "Entity" },
  { key: "summary", label: "Summary" },
  { key: "ip", label: "IP" },
  { key: "diff", label: "Diff (JSON, secrets redacted)" },
];

export async function exportAuditLog(input: {
  format: ExportFormat;
  filters: AuditFilters;
  sort: AuditSort;
  order: "asc" | "desc";
  actor: AuditActor;
  ip?: string | null;
}): Promise<Response> {
  const storeName = await getSettingString("store.name").catch(() => "DIY Baazar");
  const stamp = new Date().toISOString().slice(0, 10);

  return exportRows({
    format: input.format,
    filename: `audit-log-${stamp}`,
    title: `Audit log - ${stamp}`,
    storeName,
    columns: AUDIT_EXPORT_COLUMNS,
    rows: paginateAll(
      (skip, take) => pageAuditForExport(input.filters, input.sort, input.order, skip, take),
      { pageSize: 1000 },
    ),
    onComplete: (rowCount) =>
      writeAudit({
        actor: input.actor,
        action: "audit.export",
        entityType: "AuditLog",
        summary: `Exported ${rowCount} audit row(s) as ${input.format.toUpperCase()}.`,
        diff: {
          format: input.format,
          rowCount,
          filters: {
            q: input.filters.q,
            actorId: input.filters.actorId ?? null,
            entityType: input.filters.entityType ?? null,
            actionPrefix: input.filters.actionPrefix ?? null,
            from: input.filters.from?.toISOString() ?? null,
            to: input.filters.to?.toISOString() ?? null,
          },
        },
        ip: input.ip,
      }),
  });
}
