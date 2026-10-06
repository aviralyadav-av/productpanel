import { parseListQuery, withAdminApi } from "@/lib/api/admin";

import { listReturns, returnKpis, returnStatusCounts } from "@/features/returns/queries";
import { RETURN_SORTS, parseReturnFilters, resolveReturnSort } from "@/features/returns/schemas";

/**
 * GET /api/admin/returns?page&pageSize&sort&order&q&state&status&reason&resolution
 *     &seller&customer&order&range|from&to      (returns.view)
 *     -> { data: ReturnListRow[], meta, counts, kpis }
 *
 * The same three queries the screen runs, so an integration driving the admin
 * over REST sees exactly what an operator sees, tab counts included.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "requested", defaultOrder: "desc", allowedSorts: RETURN_SORTS });
    const filters = parseReturnFilters(searchParams);
    const sort = resolveReturnSort(query.sort);

    const [list, counts, kpis] = await Promise.all([
      listReturns({ ...query, sort }, filters),
      returnStatusCounts(filters, query.q),
      returnKpis(),
    ]);

    return Response.json({ data: list.rows, meta: list.meta, counts, kpis }, { headers: { "Cache-Control": "no-store" } });
  },
  { permission: "returns.view" },
);
