import { apiCreated, apiList, parseJsonBody, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { listSubscribers, subscriberStatusCounts } from "@/features/newsletter/queries";
import { NEWSLETTER_SORTS, addSubscriberSchema, parseNewsletterFilters, parseNewsletterSort } from "@/features/newsletter/schemas";
import { addSubscriber } from "@/features/newsletter/service";

/**
 * GET  /api/admin/newsletter?page&pageSize&sort&order&q&status&source&from&to  (newsletter.view)
 *      -> { data: SubscriberRow[], meta } plus X-Status-Counts for the tab badges.
 * POST /api/admin/newsletter { email, name?, source?, status? }                (newsletter.manage)
 *      -> 201 { data: SubscriberRow }; 409 when the address is already on the list.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "subscribedAt", defaultOrder: "desc", allowedSorts: NEWSLETTER_SORTS });
    const filters = parseNewsletterFilters(query.raw);
    const [result, counts] = await Promise.all([
      listSubscribers({ ...query, sort: parseNewsletterSort(query.sort) }, filters),
      subscriberStatusCounts(filters),
    ]);
    const response = apiList(result.rows, result.meta);
    response.headers.set("X-Status-Counts", JSON.stringify(counts));
    return response;
  },
  { permission: "newsletter.view" },
);

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const body = await parseJsonBody(req, addSubscriberSchema);
    const row = await addSubscriber(body, actor, { ip });
    return apiCreated({
      id: row.id,
      email: row.email,
      name: row.name,
      status: row.status,
      source: row.source,
      subscribedAt: row.subscribedAt,
      unsubscribedAt: row.unsubscribedAt,
    });
  },
  { permission: "newsletter.manage" },
);
