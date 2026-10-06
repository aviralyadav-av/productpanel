import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { setUserRoleSchema } from "@/features/users/schemas";
import { setUserRole } from "@/features/users/service";

/**
 * PUT /api/admin/users/:id/role { roleId }  (users.edit)
 *
 * D3 lives in the service: the actor may only assign a role whose permissions
 * are a subset of their own, never their own role, and never demote the last
 * active super-admin.
 */
export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const body = await parseJsonBody(req, setUserRoleSchema);
    const user = await setUserRole(String(params.id), body.roleId, actor, { ip });
    return apiOk({ id: user.id, roleId: user.roleId, role: user.role?.slug ?? null });
  },
  { permission: "users.edit" },
);
