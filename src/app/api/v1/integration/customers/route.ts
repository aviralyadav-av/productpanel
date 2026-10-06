import { parseJsonBody } from "@/lib/api/admin";
import { privateJson, publicCreated, withPublicApi } from "@/lib/api/public";

import { guardIntegration } from "@/features/customers/integration-guard";
import { upsertCustomerFromIntegration } from "@/features/customers/integration-service";
import { integrationUpsertSchema } from "@/features/customers/schemas";

/**
 * PUT /api/v1/integration/customers   (X-Storefront-Key; 600/min per key)
 * body: { email, fullName?, phone?, acceptsMarketing?, emailVerifiedAt?, password? }
 * -> 201 { customer } on create (welcome email queued), 200 { customer } on update.
 * Only fields present in the body change; `password` is bcrypt-hashed.
 */
export const PUT = withPublicApi(
  async ({ req, ip }) => {
    await guardIntegration(req);
    const input = await parseJsonBody(req, integrationUpsertSchema);
    const result = await upsertCustomerFromIntegration(input, { ip });
    return result.created ? publicCreated({ customer: result.customer, created: true }, req) : privateJson({ customer: result.customer, created: false }, { req });
  },
  { rateLimit: { limit: 600, windowMs: 60_000 } },
);

export const OPTIONS = PUT;
