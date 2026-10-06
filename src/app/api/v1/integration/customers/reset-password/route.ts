import { parseJsonBody } from "@/lib/api/admin";
import { privateJson, withPublicApi } from "@/lib/api/public";

import { guardIntegration } from "@/features/customers/integration-guard";
import { completeCustomerPasswordReset } from "@/features/customers/integration-service";
import { integrationResetPasswordSchema } from "@/features/customers/schemas";

/**
 * POST /api/v1/integration/customers/reset-password   (X-Storefront-Key; 600/min per key, 20/min per IP)
 * body: { token, newPassword (>= 8 chars) }
 * -> 200 { ok: true, customerId, email } | 400 VALIDATION_ERROR when the token is unknown, used, expired or the account is blocked.
 * Marks the token used, drops siblings and revokes every mirrored session.
 */
export const POST = withPublicApi(
  async ({ req }) => {
    await guardIntegration(req);
    const input = await parseJsonBody(req, integrationResetPasswordSchema);
    const result = await completeCustomerPasswordReset(input.token, input.newPassword);
    return privateJson({ ok: true, ...result }, { req });
  },
  { rateLimit: { limit: 20, windowMs: 60_000 } },
);

export const OPTIONS = POST;
