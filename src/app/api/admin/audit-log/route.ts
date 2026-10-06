import { apiList, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { getAuditFacets, listAuditLog } from "@/features/audit/queries";
import { AUDIT_SORTS, parseAuditFilters, resolveAuditSort } from "@/features/audit/schemas";

/**
 * GET /api/admin/audit-log?q=&actor=&action=&entity=&range=|from=&to=&sort=&order=&page=&pageSize=
 * (audit.view) -> { data: AuditRow[], meta } and, with ?facets=1, the filter
 * options as X-Audit-Facets.
 *
 * Server-side pagination only (§11.28): this table grows forever.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, {
      defaultSort: "createdAt",
      defaultOrder: "desc",
      allowedSorts: AUDIT_SORTS,
      pageSize: 50,
    });
    const filters = parseAuditFilters(query.raw);
    const result = await listAuditLog({ ...query, sort: resolveAuditSort(query.sort) }, filters);

    const response = apiList(result.rows, result.meta);
    if (searchParams.get("facets") === "1") {
      response.headers.set("X-Audit-Facets", JSON.stringify(await getAuditFacets()));
    }
    return response;
  },
  { permission: "audit.view" },
);
