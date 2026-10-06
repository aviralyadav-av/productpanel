import { parseJsonBody } from "@/lib/api/admin";
import { privateJson, withPublicApi } from "@/lib/api/public";

import { decodeParam, guardIntegration } from "@/features/customers/integration-guard";
import { replaceWishlist } from "@/features/customers/integration-service";
import { integrationWishlistSchema } from "@/features/customers/schemas";

/**
 * PUT /api/v1/integration/customers/:email/wishlist   (X-Storefront-Key; 600/min per key)
 * body: { items: [{ productId, variantId? }] }  - full replace; a missing variantId resolves to the product's default variant.
 * -> { items: [{ productId, variantId }], skipped: [{ productId, variantId, reason }] }   404 when the email is unknown.
 */
export const PUT = withPublicApi<{ email: string }>(
  async ({ req, params }) => {
    await guardIntegration(req);
    const input = await parseJsonBody(req, integrationWishlistSchema);
    return privateJson(await replaceWishlist(decodeParam(params.email), input), { req });
  },
  { rateLimit: { limit: 600, windowMs: 60_000 } },
);

export const OPTIONS = PUT;
