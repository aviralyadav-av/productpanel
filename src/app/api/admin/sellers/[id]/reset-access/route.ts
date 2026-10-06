import { apiOk, withAdminApi } from "@/lib/api/admin";

import { resetSellerAccess } from "@/features/sellers/service";

/**
 * POST /api/admin/sellers/:id/reset-access   (sellers.edit)
 *
 * Issues a hashed single-use token (24 h) and emails the storefront reset
 * link. The token is never returned to the admin - only when it expires.
 */
export const POST = withAdminApi<{ id: string }>(
  async ({ params, actor }) => {
    const result = await resetSellerAccess(params.id, actor);
    return apiOk({ expiresAt: result.expiresAt, emailQueued: result.emailQueued });
  },
  { permission: "sellers.edit", rateLimit: { limit: 10, windowMs: 60 * 60_000 } },
);
