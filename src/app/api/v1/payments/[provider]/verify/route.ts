import { ApiError } from "@/lib/api/errors";
import { handleOptions, privateJson, withPublicApi } from "@/lib/api/public";
import { paymentProviderSchema } from "@/lib/enums";
import {
  PaymentProviderError,
  getPaymentProvider,
  settlePaymentEvent,
  type ProviderWebhookEvent,
} from "@/lib/payments";

/**
 * POST /api/v1/payments/:provider/verify (blueprint §14.B6).
 *
 * The storefront posts the gateway's browser-side success callback here so
 * the customer sees "paid" immediately instead of waiting for the webhook.
 * The callback is signature-verified by the provider, then applied through
 * the SAME settlement as the webhook - whichever arrives second is a no-op.
 *
 * The callback carries no amount for most gateways; settlement then trusts
 * the stored OrderPayment (which we created) and the webhook cross-checks the
 * gateway's amount later. Responses are `no-store`.
 */

const MAX_BODY_BYTES = 32 * 1024;

export const POST = withPublicApi<{ provider: string }>(
  async ({ req, params, ip }) => {
    const parsedCode = paymentProviderSchema.safeParse(params.provider.toUpperCase());
    if (!parsedCode.success) throw new ApiError(404, "NOT_FOUND", "Unknown payment provider.");
    const code = parsedCode.data;

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) throw new ApiError(413, "BAD_REQUEST", "Payload too large.");
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new ApiError(400, "BAD_REQUEST", "Request body must be valid JSON.");
    }

    let provider;
    try {
      provider = await getPaymentProvider(code);
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        throw new ApiError(404, "NOT_FOUND", "Payment provider is not available.");
      }
      throw error;
    }
    if (!provider.supportsOnline) throw new ApiError(404, "NOT_FOUND", "Payment provider is not available.");

    const callback = await provider.verifyClientCallback(payload);
    if (!callback.ok) {
      throw new ApiError(
        callback.reason === "signature" ? 401 : 400,
        callback.reason === "signature" ? "UNAUTHORIZED" : "BAD_REQUEST",
        callback.reason === "signature" ? "Payment signature is invalid." : "Malformed payment callback.",
      );
    }

    const event: ProviderWebhookEvent = {
      providerEventId: `client:${callback.providerPaymentId}`,
      type: "client.callback",
      providerOrderId: callback.providerOrderId,
      providerPaymentId: callback.providerPaymentId,
      amountPaise: callback.amountPaise,
      currency: callback.currency,
      status: "SUCCEEDED",
      mode: null,
      raw: callback.raw,
    };

    const result = await settlePaymentEvent({ provider: code, event, source: "client", ip });
    if (!result.ok) {
      if (result.reason === "unknown_order") throw new ApiError(404, "NOT_FOUND", "Payment attempt not found.");
      if (result.reason === "conflict") throw new ApiError(409, "CONFLICT", "Payment was already settled differently.");
      throw new ApiError(400, "BAD_REQUEST", "Payment callback does not match the payment attempt.");
    }

    return privateJson(
      {
        orderNumber: result.orderNumber,
        paymentStatus: result.paymentStatus,
        payment: { id: result.paymentId, status: result.orderPaymentStatus },
      },
      { req },
    );
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);

export const OPTIONS = handleOptions;
