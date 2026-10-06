import { withAdminApi } from "@/lib/api/admin";
import { parseExportFormat } from "@/lib/export";

import { exportAuditLog } from "@/features/audit/export";
import { AUDIT_SORTS, parseAuditFilters, resolveAuditSort } from "@/features/audit/schemas";

/**
 * GET /api/admin/audit-log/export?format=csv|xlsx&<the same filters as the list>
 * (audit.view)
 *
 * Streamed page by page, and audited as `audit.export` with the filter and the
 * row count - walking off with the log is itself an event worth recording (D13).
 */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip }) => {
    const raw: Record<string, string> = {};
    for (const key of new Set(searchParams.keys())) raw[key] = searchParams.get(key) ?? "";

    const sortParam = searchParams.get("sort") ?? "createdAt";
    const sort = resolveAuditSort(
      (AUDIT_SORTS as readonly string[]).includes(sortParam) ? sortParam : "createdAt",
    );

    return exportAuditLog({
      format: parseExportFormat(searchParams.get("format")),
      filters: parseAuditFilters(raw),
      sort,
      order: searchParams.get("order") === "asc" ? "asc" : "desc",
      actor,
      ip,
    });
  },
  { permission: "audit.view", rateLimit: { limit: 10, windowMs: 60_000 } },
);
