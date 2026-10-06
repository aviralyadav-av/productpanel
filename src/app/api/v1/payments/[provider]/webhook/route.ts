import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { handleOptions, privateJson, withPublicApi } from "@/lib/api/public";
import { paymentProviderSchema } from "@/lib/enums";
import { PaymentProviderError, getPaymentProvider, settlePaymentEvent } from "@/lib/payments";

/**
 * POST /api/v1/payments/:provider/webhook (blueprint §14.D5).
 *
 * Order of operations is the security model:
 *   1. raw body + headers → provider.verifyWebhook (constant-time HMAC). Bad
 *      signature → 4xx, nothing stored.
 *   2. provider disabled or TEST/LIVE mode mismatch → 4xx.
 *   3. INSERT WebhookEvent first; a duplicate providerEventId is a 200 no-op,
 *      so a gateway replaying the event during our retry window is harmless.
 *   4. settlePaymentEvent() in one transaction; 2xx only after commit.
 * Every response is `no-store` (privateJson). Errors from step 4 are recorded
 * on the WebhookEvent row so an operator can see why an order did not confirm.
 */

const MAX_BODY_BYTES = 256 * 1024;

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002",
  );
}

export const POST = withPublicApi<{ provider: string }>(
  async ({ req, params, ip }) => {
    const parsedCode = paymentProviderSchema.safeParse(params.provider.toUpperCase());
    if (!parsedCode.success) throw new ApiError(404, "NOT_FOUND", "Unknown payment provider.");
    const code = parsedCode.data;

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) throw new ApiError(413, "BAD_REQUEST", "Payload too large.");

    let provider;
    try {
      provider = await getPaymentProvider(code);
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        // Disabled or unimplemented: refuse without revealing which (D5).
        throw new ApiError(error.code === "DISABLED" ? 403 : 404, error.code === "DISABLED" ? "FORBIDDEN" : "NOT_FOUND", "Webhook not accepted.");
      }
      throw error;
    }
    if (!provider.supportsOnline) throw new ApiError(404, "NOT_FOUND", "Webhook not accepted.");

    const verified = await provider.verifyWebhook({ rawBody, headers: req.headers });
    if (!verified.ok) {
      throw new ApiError(
        verified.reason === "signature" ? 401 : 400,
        verified.reason === "signature" ? "UNAUTHORIZED" : "BAD_REQUEST",
        verified.reason === "signature" ? "Invalid webhook signature." : "Malformed webhook payload.",
      );
    }
    const { event } = verified;

    if (event.mode && event.mode !== provider.mode) {
      throw new ApiError(400, "BAD_REQUEST", `Event mode ${event.mode} does not match the configured ${provider.mode} mode.`);
    }

    // Insert-first idempotency (D5).
    let webhookEventId: string;
    try {
      const inserted = await db.webhookEvent.create({
        data: {
          provider: code,
          providerEventId: event.providerEventId,
          payload: (event.raw ?? {}) as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      webhookEventId = inserted.id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return privateJson({ received: true, duplicate: true }, { req });
      }
      throw error;
    }

    let result;
    try {
      result = await settlePaymentEvent({ provider: code, event, source: "webhook", ip, webhookEventId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.webhookEvent.update({
        where: { id: webhookEventId },
        data: { error: message.slice(0, 2000) },
      }).catch(() => undefined);
      throw error;
    }

    if (!result.ok) {
      await db.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date(), error: `${result.reason}: ${result.message}` },
      });
      // Amount/currency tampering is refused (D5); an unknown order or an
      // event we do not act on is acknowledged so the gateway stops retrying.
      if (result.reason === "amount_mismatch" || result.reason === "currency_mismatch") {
        throw new ApiError(400, "BAD_REQUEST", "Event does not match the payment attempt.");
      }
      return privateJson({ received: true, processed: false, reason: result.reason }, { req });
    }

    return privateJson(
      {
        received: true,
        processed: true,
        changed: result.changed,
        orderNumber: result.orderNumber,
        paymentStatus: result.paymentStatus,
      },
      { req },
    );
  },
  { rateLimit: { limit: 120, windowMs: 60_000 } },
);

export const OPTIONS = handleOptions;
