import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { markReadSchema } from "@/features/notifications/schemas";
import { markRead, unreadCount } from "@/features/notifications/service";

/**
 * PUT /api/admin/notifications/read  { ids: string[] } | { all: true }
 *
 * Scoped to the actor: `markRead` filters on `userId`, so passing another
 * admin's notification id marks nothing and reports 0 rather than 403 - there
 * is nothing to leak either way.
 *
 * Deliberately not audited (D13 lists what must be recorded; personal read
 * state is not on it, and an audit log full of "marked 12 read" is an audit
 * log nobody reads).
 */
export const PUT = withAdminApi(
  async ({ req, actor }) => {
    const body = await parseJsonBody(req, markReadSchema);
    const count = await markRead(actor.id, body.all ? "all" : (body.ids ?? []));
    const unread = await unreadCount(actor.id);
    return apiOk({ count, unread });
  },
  { permission: "notifications.view" },
);
