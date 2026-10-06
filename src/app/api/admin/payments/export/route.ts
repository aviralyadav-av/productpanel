import { parseListQuery, withAdminApi } from "@/lib/api/admin";
import { parseExportFormat } from "@/lib/export";

import { exportPayments } from "@/features/payments/export";
import { PAYMENT_SORTS, parsePaymentFilters } from "@/features/payments/schemas";

/** GET /api/admin/payments/export?format=csv|xlsx|print&<filters>  (payments.view, audited D13) */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip }) => {
    const query = parseListQuery(searchParams, { defaultSort: "created", defaultOrder: "desc", allowedSorts: PAYMENT_SORTS });
    return exportPayments({
      format: parseExportFormat(searchParams.get("format")),
      filters: parsePaymentFilters(searchParams),
      q: query.q,
      actor,
      ip,
    });
  },
  { permission: "payments.view", rateLimit: { limit: 10, windowMs: 60_000 } },
);
