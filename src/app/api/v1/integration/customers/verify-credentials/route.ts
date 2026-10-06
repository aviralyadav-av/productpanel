import { parseJsonBody } from "@/lib/api/admin";
import { privateJson, withPublicApi } from "@/lib/api/public";

import { guardIntegration } from "@/features/customers/integration-guard";
import { verifyCustomerCredentials } from "@/features/customers/integration-service";
import { integrationVerifyCredentialsSchema } from "@/features/customers/schemas";

/**
 * POST /api/v1/integration/customers/verify-credentials   (X-Storefront-Key; 600/min per key, 60/min per IP)
 * body: { email, password }
 * -> 200 { ok: true, customer: { id, email, fullName } } | 200 { ok: false, reason: "INVALID" | "BLOCKED" }
 * Always a 200 with one bcrypt compare, so neither status code nor timing reveals whether the email exists.
 */
export const POST = withPublicApi(
  async ({ req }) => {
    await guardIntegration(req);
    const input = await parseJsonBody(req, integrationVerifyCredentialsSchema);
    return privateJson(await verifyCustomerCredentials(input.email, input.password), { req });
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);

export const OPTIONS = POST;
