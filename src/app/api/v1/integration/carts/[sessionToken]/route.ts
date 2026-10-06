import { parseJsonBody } from "@/lib/api/admin";
import { privateJson, withPublicApi } from "@/lib/api/public";

import { decodeParam, guardIntegration } from "@/features/customers/integration-guard";
import { upsertCart } from "@/features/customers/integration-service";
import { integrationCartSchema } from "@/features/customers/schemas";

/**
 * PUT /api/v1/integration/carts/:sessionToken   (X-Storefront-Key; 600/min per key)
 * body: { email?, couponCode?, items: [{ productId, variantId?, quantity, customization? }] }
 * -> { cartId, status: "ACTIVE", customerId, expiresAt, items: [{ productId, variantId, quantity }], skipped[] }
 * Upserts the Cart by the website's session token and replaces its lines; `email` links it to a known customer.
 */
export const PUT = withPublicApi<{ sessionToken: string }>(
  async ({ req, params }) => {
    await guardIntegration(req);
    const input = await parseJsonBody(req, integrationCartSchema);
    return privateJson(await upsertCart(decodeParam(params.sessionToken), input), { req });
  },
  { rateLimit: { limit: 600, windowMs: 60_000 } },
);

export const OPTIONS = PUT;
