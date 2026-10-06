import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { setUserStatusSchema } from "@/features/users/schemas";
import { setUserStatus } from "@/features/users/service";

/**
 * PUT /api/admin/users/:id/status { isActive, reason? }  (users.edit)
 *
 * Deactivating revokes every live session. You cannot deactivate yourself or
 * the last active super-admin (§11.16).
 */
export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const body = await parseJsonBody(req, setUserStatusSchema);
    const user = await setUserStatus(String(params.id), body.isActive, actor, {
      ip,
      reason: body.reason,
    });
    return apiOk({ id: user.id, isActive: user.isActive, revokedSessions: user.revokedSessions });
  },
  { permission: "users.edit" },
);
