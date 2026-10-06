import { conflict, notFound } from "@/lib/api/errors";
import { handleOptions, privateJson, withPublicApi } from "@/lib/api/public";
import { paiseToRupees } from "@/lib/money";

import { createPaymentAttempt } from "@/features/orders/payments";
import { resolveOrderByToken } from "@/features/orders/public";

/**
 * POST /api/v1/orders/:number/retry-payment?token=… (blueprint §5.3, §14.D1, B6).
 *
 * A shopper who closed the gateway window still has a PENDING order with its
 * stock reserved; this opens a fresh attempt against the same order rather
 * than making them re-enter the whole basket. Each retry cancels the previous
 * open attempt, so a late callback for the abandoned widget cannot settle a
 * second charge.
 *
 * A wrong token is the same 404 as an unknown order number (D1); an order
 * that no longer needs paying answers 409 rather than silently creating a
 * charge nobody expects.
 */
export const POST = withPublicApi<{ number: string }>(
  async ({ params, searchParams, req }) => {
    const orderNumber = params.number.trim().toUpperCase();
    const record = await resolveOrderByToken(orderNumber, searchParams.get("token"));
    if (!record) throw notFound("Order");

    if (record.paymentMethod !== "ONLINE") throw conflict("This order is not paid online.");
    if (record.status !== "PENDING" || record.paymentStatus === "PAID") throw conflict("This order no longer needs a payment.");

    const attempt = await createPaymentAttempt({ orderId: record.id });

    return privateJson(
      {
        order: { number: orderNumber, total: paiseToRupees(record.totalPaise) },
        payment: {
          provider: attempt.provider,
          providerOrderId: attempt.providerOrderId,
          amount: paiseToRupees(attempt.amountPaise),
          clientParams: attempt.clientParams,
        },
      },
      { status: 201, req },
    );
  },
  { rateLimit: { limit: 10, windowMs: 60_000 } },
);

export const OPTIONS = handleOptions;
