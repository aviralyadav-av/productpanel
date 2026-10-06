import { apiOk, withAdminApi } from "@/lib/api/admin";

import { sendUserResetLink } from "@/features/users/service";

/**
 * POST /api/admin/users/:id/reset-link  (users.edit, 30/h/actor)
 *
 * Mints the same single-use 30-minute token the public forgot-password form
 * does and emails it. The plaintext token is never returned - not to the
 * caller, not to the operator (D3: admins never learn a colleague's password
 * or their reset link).
 */
export const POST = withAdminApi<{ id: string }>(
  async ({ params, actor, ip }) => apiOk(await sendUserResetLink(String(params.id), actor, { ip })),
  { permission: "users.edit", rateLimit: { limit: 30, windowMs: 60 * 60_000 } },
);
