import { parseListQuery, withAdminApi } from "@/lib/api/admin";
import { parseExportFormat } from "@/lib/export";

import { exportRefunds } from "@/features/refunds/export";
import { REFUND_SORTS, parseRefundFilters } from "@/features/refunds/schemas";

/** GET /api/admin/refunds/export?format=csv|xlsx|print&<filters>  (refunds.view, audited) */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip }) => {
    const query = parseListQuery(searchParams, { defaultSort: "created", defaultOrder: "desc", allowedSorts: REFUND_SORTS });
    return exportRefunds({
      format: parseExportFormat(searchParams.get("format")),
      filters: parseRefundFilters(searchParams),
      q: query.q,
      actor,
      ip,
    });
  },
  { permission: "refunds.view", rateLimit: { limit: 10, windowMs: 60_000 } },
);
