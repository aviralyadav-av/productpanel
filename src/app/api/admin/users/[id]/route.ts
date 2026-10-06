import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getUserDetail } from "@/features/users/queries";
import { userProfileSchema } from "@/features/users/schemas";
import { deactivateUser, updateUserProfile } from "@/features/users/service";

/**
 * GET    /api/admin/users/:id           (users.view)   -> { user, permissions, roles }
 * PUT    /api/admin/users/:id           (users.edit)   name/email/phone; changing the
 *        email revokes every session of that user (D3).
 * DELETE /api/admin/users/:id?reason=   (users.delete) SOFT delete - the row survives
 *        with `<id>@deleted.local`; users are never hard-deleted.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params, actor }) => {
    const detail = await getUserDetail(String(params.id), actor);
    if (!detail) throw notFound("User");
    return apiOk(detail);
  },
  { permission: "users.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const body = await parseJsonBody(req, userProfileSchema);
    const user = await updateUserProfile(String(params.id), body, actor, { ip });
    return apiOk({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      revokedSessions: user.revokedSessions,
    });
  },
  { permission: "users.edit" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ params, actor, ip, searchParams }) => {
    await deactivateUser(String(params.id), actor, {
      ip,
      reason: searchParams.get("reason"),
    });
    return apiNoContent();
  },
  { permission: "users.delete" },
);
