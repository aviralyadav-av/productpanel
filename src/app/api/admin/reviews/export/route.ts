import { parseListQuery, withAdminApi } from "@/lib/api/admin";
import { parseExportFormat } from "@/lib/export";

import { exportReviews } from "@/features/reviews/export";
import { REVIEW_SORTS, parseReviewFilters, parseReviewSort } from "@/features/reviews/schemas";

/** GET /api/admin/reviews/export?format=csv|xlsx&<list filters> (reviews.view) - streamed; audited with row count. */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip }) => {
    const query = parseListQuery(searchParams, { defaultSort: "createdAt", defaultOrder: "desc", allowedSorts: REVIEW_SORTS });
    return exportReviews({
      format: parseExportFormat(searchParams.get("format")),
      params: { ...query, sort: parseReviewSort(query.sort) },
      filters: parseReviewFilters(query.raw),
      actor,
      ip,
    });
  },
  { permission: "reviews.view" },
);
