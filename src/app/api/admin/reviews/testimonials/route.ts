import { apiCreated, apiList, parseJsonBody, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { listTestimonials } from "@/features/reviews/queries";
import { parseReviewFilters, testimonialSchema } from "@/features/reviews/schemas";
import { createTestimonial } from "@/features/reviews/service";

/**
 * GET  /api/admin/reviews/testimonials?page&q&status&featured   (reviews.view)     position order
 * POST /api/admin/reviews/testimonials { authorName, authorLocation?, body, rating?, position?, isFeatured?, status? } (reviews.moderate)
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "position", defaultOrder: "asc" });
    const result = await listTestimonials(query, parseReviewFilters(query.raw));
    return apiList(result.rows, result.meta);
  },
  { permission: "reviews.view" },
);

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const body = await parseJsonBody(req, testimonialSchema);
    const review = await createTestimonial(body, actor, { ip });
    return apiCreated({ id: review.id });
  },
  { permission: "reviews.moderate" },
);
