import { notFound, rateLimited } from "@/lib/api/errors";
import { handleOptions, privateJson, withPublicApi } from "@/lib/api/public";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";

import { getPublicOrder, resolveOrderByToken } from "@/features/orders/public";

/**
 * GET /api/v1/orders/:number?token=… — order tracking (blueprint §5.3, §14.D1, D11).
 *
 * An unknown order number and a wrong token produce the identical 404, so the
 * endpoint cannot be walked to discover which numbers exist. On top of the
 * wrapper's 20/min/IP there is a 100-per-day cap on each order number, which
 * is what stops a leaked link being brute-forced from many addresses.
 *
 * The payload is an explicit allowlist (`getPublicOrder`); `no-store` is set
 * by `privateJson` because the body is specific to one customer.
 */
export const GET = withPublicApi<{ number: string }>(
  async ({ params, searchParams, req }) => {
    const orderNumber = params.number.trim().toUpperCase();

    const perOrder = await rateLimit(rateLimitKey("order-track", orderNumber), { limit: 100, windowMs: 24 * 60 * 60 * 1000 });
    if (!perOrder.ok) throw rateLimited(perOrder.retryAfterSec);

    const record = await resolveOrderByToken(orderNumber, searchParams.get("token"));
    if (!record) throw notFound("Order");

    const order = await getPublicOrder(record.id);
    if (!order) throw notFound("Order");

    return privateJson(order, { req });
  },
  { rateLimit: { limit: 20, windowMs: 60_000 } },
);

export const OPTIONS = handleOptions;
