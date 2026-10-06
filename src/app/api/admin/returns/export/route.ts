import { parseListQuery, withAdminApi } from "@/lib/api/admin";
import { parseExportFormat } from "@/lib/export";

import { exportReturns } from "@/features/returns/export";
import { RETURN_SORTS, parseReturnFilters } from "@/features/returns/schemas";

/**
 * GET /api/admin/returns/export?format=csv|xlsx|print&<the list filters>
 * (returns.view) — streamed in pages (§11.28) and audited with the filter and
 * the row count (D13): the file carries customer names and emails.
 */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip }) => {
    const query = parseListQuery(searchParams, { defaultSort: "requested", defaultOrder: "desc", allowedSorts: RETURN_SORTS });
    return exportReturns({
      format: parseExportFormat(searchParams.get("format")),
      filters: parseReturnFilters(searchParams),
      q: query.q,
      actor,
      ip,
    });
  },
  { permission: "returns.view", rateLimit: { limit: 10, windowMs: 60_000 } },
);
