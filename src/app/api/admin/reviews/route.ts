import { apiList, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { listReviews, listTestimonials } from "@/features/reviews/queries";
import { REVIEW_SORTS, parseReviewFilters, parseReviewSort } from "@/features/reviews/schemas";

/**
 * GET /api/admin/reviews?page&pageSize&sort&order&q&status&rating&product&seller&customer&verified&images&featured&from&to&tab=testimonials
 * (reviews.view) - `{ data: ReviewListRow[], meta }`, the same rows the list page renders.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "createdAt", defaultOrder: "desc", allowedSorts: REVIEW_SORTS });
    const filters = parseReviewFilters(query.raw);
    const result =
      query.filter("tab") === "testimonials"
        ? await listTestimonials(query, filters)
        : await listReviews({ ...query, sort: parseReviewSort(query.sort) }, filters);
    return apiList(result.rows, result.meta);
  },
  { permission: "reviews.view" },
);
