import { apiOk, withAdminApi } from "@/lib/api/admin";

/**
 * GET /api/admin/me → the signed-in actor's identity and grants. What a
 * client needs to render permission-aware UI; never the session token.
 */
export const GET = withAdminApi(async ({ actor }) =>
  apiOk({
    id: actor.id,
    email: actor.email,
    name: actor.name,
    image: actor.image,
    roleSlug: actor.roleSlug,
    roleName: actor.roleName,
    isSuperAdmin: actor.isSuperAdmin,
    permissions: [...actor.permissions].sort(),
    twoFactorEnabled: actor.twoFactorEnabled,
    forcePasswordChange: actor.forcePasswordChange,
    sessionId: actor.sessionId,
  }),
);
