import { parseListQuery, withAdminApi } from "@/lib/api/admin";
import { parseExportFormat } from "@/lib/export";
import { resolveDateRangeParams } from "@/components/shared/date-range";

import { exportLedger } from "@/features/finance/export";
import { parseLedgerFilters } from "@/features/finance/ui-schemas";

/**
 * GET /api/admin/payouts/ledger/export?format=csv|xlsx&<ledger filters>  (payouts.view)
 *
 * Streams the whole filtered set (not the visible page) and audits the export
 * with its filter and row count, per D13.
 */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip }) => {
    const query = parseListQuery(searchParams, { defaultSort: "createdAt", defaultOrder: "desc" });
    const filters = parseLedgerFilters(query.raw);
    const range =
      query.raw.range || query.raw.from || query.raw.to
        ? resolveDateRangeParams(query.raw, "30d")
        : undefined;

    return exportLedger({
      format: parseExportFormat(searchParams.get("format")),
      filters,
      range,
      actor,
      ip,
    });
  },
  { permission: "payouts.view", rateLimit: { limit: 20, windowMs: 60_000 } },
);
