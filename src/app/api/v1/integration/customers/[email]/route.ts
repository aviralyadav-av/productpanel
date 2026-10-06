import { notFound } from "@/lib/api/errors";
import { privateJson, withPublicApi } from "@/lib/api/public";

import { decodeParam, guardIntegration } from "@/features/customers/integration-guard";
import { getIntegrationCustomer } from "@/features/customers/integration-service";

/**
 * GET /api/v1/integration/customers/:email   (X-Storefront-Key; 600/min per key)
 * -> { customer: { id, email, fullName, phone, status, emailVerifiedAt, acceptsMarketing, hasPassword,
 *                  createdAt, lastLoginAt, counters { orderCount, totalSpentPaise, firstOrderAt, lastOrderAt }, addresses[] } }
 * D11: the website's own signed-in customer; staff notes, tags and hashes are never included. `no-store`.
 */
export const GET = withPublicApi<{ email: string }>(
  async ({ req, params }) => {
    await guardIntegration(req);
    const customer = await getIntegrationCustomer(decodeParam(params.email));
    if (!customer) throw notFound("Customer");
    return privateJson({ customer }, { req });
  },
  { rateLimit: { limit: 600, windowMs: 60_000 } },
);

export const OPTIONS = GET;
