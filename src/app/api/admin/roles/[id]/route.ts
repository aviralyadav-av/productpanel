import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getRoleDetail } from "@/features/roles/queries";
import { roleFormSchema } from "@/features/roles/schemas";
import { deleteRole, updateRole } from "@/features/roles/service";

/**
 * GET    /api/admin/roles/:id   (roles.view)   -> RoleDetail with its users
 * PUT    /api/admin/roles/:id   (roles.manage) replaces the whole grant list
 * DELETE /api/admin/roles/:id   (roles.manage) refused for system roles and
 *        for any role that still has users (§11.16)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const role = await getRoleDetail(String(params.id));
    if (!role) throw notFound("Role");
    return apiOk(role);
  },
  { permission: "roles.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const body = await parseJsonBody(req, roleFormSchema);
    return apiOk(await updateRole(String(params.id), body, actor, { ip }));
  },
  { permission: "roles.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ params, actor, ip }) => {
    await deleteRole(String(params.id), actor, { ip });
    return apiNoContent();
  },
  { permission: "roles.manage" },
);
