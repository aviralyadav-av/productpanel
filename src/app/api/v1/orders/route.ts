import { badRequest, validationError } from "@/lib/api/errors";
import { handleOptions, privateJson, withPublicApi } from "@/lib/api/public";
import { paiseToRupees } from "@/lib/money";

import { storefrontOrderSchema } from "@/features/orders/schemas";
import { createStorefrontOrder } from "@/features/orders/service";

/**
 * POST /api/v1/orders — checkout intake (blueprint §5.3, §10, §14.D1, D9, D15).
 *
 * The body describes what the shopper wants; it never says what it costs.
 * The service re-loads every product, revalidates the customisation answers,
 * re-evaluates the coupon, re-quotes shipping and recomputes the totals
 * inside the same transaction that reserves the stock - so a tampered price
 * in the request changes nothing.
 *
 * The response carries the D1 access token exactly once: it is stored only as
 * a SHA-256 hash, so a website that loses it must ask the customer to use the
 * link in their confirmation email. 10 requests per minute per IP, plus the
 * D15 per-email and per-IP caps enforced inside the transaction.
 */
export const POST = withPublicApi(
  async ({ req, ip }) => {
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw badRequest("Send a JSON body.");
    }

    const parsed = storefrontOrderSchema.safeParse(json);
    if (!parsed.success) {
      const details: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (key && !details[key]) details[key] = issue.message;
      }
      throw validationError(details, "Please check the order details.");
    }

    const result = await createStorefrontOrder({
      ...parsed.data,
      ip,
      userAgent: req.headers.get("user-agent"),
    });

    return privateJson(
      {
        order: {
          number: result.orderNumber,
          total: paiseToRupees(result.totalPaise),
          status: result.status,
          paymentMethod: result.paymentMethod,
          accessToken: result.accessToken,
        },
        payment: result.payment
          ? {
              provider: result.payment.provider,
              providerOrderId: result.payment.providerOrderId,
              amount: paiseToRupees(result.payment.amountPaise),
              clientParams: result.payment.clientParams,
            }
          : null,
        paymentError: result.paymentError,
      },
      { status: 201, req },
    );
  },
  { rateLimit: { limit: 10, windowMs: 60_000 } },
);

export const OPTIONS = handleOptions;
