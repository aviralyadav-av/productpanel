import { parseListQuery, withAdminApi } from "@/lib/api/admin";

import {
  listNotifications,
  notificationOverview,
  notificationTypeCounts,
} from "@/features/notifications/queries";
import { parseNotificationFilters } from "@/features/notifications/schemas";

/**
 * GET /api/admin/notifications?type=&severity=&unread=1&from=&to=&q=&page=&pageSize=
 *
 * The signed-in actor's own inbox (blueprint §5.2). There is no `userId`
 * parameter by design: notifications are fanned out per recipient, and one
 * admin reading another's inbox is not a feature, it is a leak.
 *
 * The envelope carries `counts` (per type, with the type filter dropped) and
 * `overview` (unread / critical / today) because the bell and the page header
 * need them on every render.
 */
export const GET = withAdminApi(
  async ({ actor, searchParams }) => {
    const query = parseListQuery(searchParams, {
      defaultSort: "createdAt",
      defaultOrder: "desc",
      pageSize: 30,
    });
    const filters = parseNotificationFilters(query.raw);

    const [result, counts, overview] = await Promise.all([
      listNotifications(actor.id, query, filters),
      notificationTypeCounts(actor.id, filters),
      notificationOverview(actor.id),
    ]);

    return Response.json(
      { data: result.rows, meta: result.meta, counts, overview },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
  { permission: "notifications.view" },
);
