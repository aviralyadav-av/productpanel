import { parseListQuery, withAdminApi } from "@/lib/api/admin";
import { parseExportFormat } from "@/lib/export";
import { resolveDateRangeParams } from "@/components/shared/date-range";

import { exportPayouts } from "@/features/finance/export";
import { parsePayoutFilters } from "@/features/finance/ui-schemas";

/**
 * GET /api/admin/payouts/export?format=csv|xlsx&<statement filters>  (payouts.view)
 * Streamed and audited (D13).
 */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip }) => {
    const query = parseListQuery(searchParams, { defaultSort: "createdAt", defaultOrder: "desc" });
    const filters = parsePayoutFilters(query.raw);
    const range =
      query.raw.range || query.raw.from || query.raw.to
        ? resolveDateRangeParams(query.raw, "30d")
        : undefined;

    return exportPayouts({
      format: parseExportFormat(searchParams.get("format")),
      filters,
      range,
      actor,
      ip,
    });
  },
  { permission: "payouts.view", rateLimit: { limit: 20, windowMs: 60_000 } },
);
