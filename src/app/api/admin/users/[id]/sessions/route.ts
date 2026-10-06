import { apiOk, withAdminApi } from "@/lib/api/admin";

import { listUserSessionRows } from "@/features/users/queries";
import { revokeAllUserSessions, revokeUserSession } from "@/features/users/service";

/**
 * GET    /api/admin/users/:id/sessions             (users.view)
 * DELETE /api/admin/users/:id/sessions?session=id  (users.edit) one session,
 *        or every session when `session` is omitted. Revocation takes effect
 *        on that device's next request (§11.17).
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params, actor }) => {
    const userId = String(params.id);
    const sessions = await listUserSessionRows(
      userId,
      actor.id === userId ? actor.sessionId : null,
    );
    return apiOk({ sessions });
  },
  { permission: "users.view" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ params, actor, ip, searchParams }) => {
    const userId = String(params.id);
    const sessionId = searchParams.get("session");
    if (sessionId) {
      return apiOk(await revokeUserSession(userId, sessionId, actor, { ip }));
    }
    return apiOk(await revokeAllUserSessions(userId, actor, { ip }));
  },
  { permission: "users.edit" },
);
