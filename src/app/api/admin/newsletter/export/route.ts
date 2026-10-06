import { parseListQuery, withAdminApi } from "@/lib/api/admin";
import { parseExportFormat } from "@/lib/export";

import { exportSubscribers } from "@/features/newsletter/export";
import { NEWSLETTER_SORTS, parseNewsletterFilters, parseNewsletterSort } from "@/features/newsletter/schemas";

/**
 * GET /api/admin/newsletter/export?format=csv|xlsx&<list filters>
 * Requires `newsletter.export` (not just .view): downloading the whole list is
 * a bigger privilege than reading a page of it. Streamed; audited with the
 * filter and row count (D13).
 */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip }) => {
    const query = parseListQuery(searchParams, { defaultSort: "subscribedAt", defaultOrder: "desc", allowedSorts: NEWSLETTER_SORTS });
    return exportSubscribers({
      format: parseExportFormat(searchParams.get("format")),
      filters: parseNewsletterFilters(query.raw),
      sort: parseNewsletterSort(query.sort),
      order: query.order,
      actor,
      ip,
    });
  },
  { permission: "newsletter.export" },
);
