import { apiOk, withAdminApi } from "@/lib/api/admin";

import { requestCustomerPasswordReset } from "@/features/customers/service";

/**
 * POST /api/admin/customers/:id/reset-password   (customers.reset_password)
 * -> { expiresAt, emailQueued }. The token itself is only ever in the email.
 */
export const POST = withAdminApi<{ id: string }>(
  async ({ params, actor, ip }) => apiOk(await requestCustomerPasswordReset(params.id, actor, { ip })),
  { permission: "customers.reset_password", rateLimit: { limit: 30, windowMs: 60 * 60_000 } },
);
