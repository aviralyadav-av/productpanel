import { createHash, createHmac } from "node:crypto";

import { constantTimeEqual, hmacSign } from "@/lib/crypto";
import type {
  ClientCallbackResult,
  PaymentProvider,
  ProviderContext,
  ProviderEventStatus,
  ProviderWebhookEvent,
} from "../types";

/**
 * MOCK gateway for local end-to-end testing (blueprint §12: "Mock gateway
 * (testing)" is seeded enabled in TEST mode).
 *
 * It behaves like a real gateway from the platform's point of view - it issues
 * an order id, expects a signed client callback and a signed webhook, and
 * refuses bad signatures - so the checkout, /verify and /webhook code paths
 * are exercised for real. Ids are deterministic functions of our order id so a
 * test can predict them, and every signature is HMAC-SHA256 with the
 * `webhookSecret` credential; when no secret is configured the HMAC falls back
 * to the platform's own `payments` key, so a fresh checkout works with zero
 * configuration while still refusing unsigned requests.
 *
 * Helpers `signMockCallback` / `signMockWebhook` are exported for the test
 * suite and for a developer poking the endpoints with curl.
 */

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";
export const MOCK_EVENT_ID_HEADER = "x-mock-event-id";

export type MockCallbackPayload = {
  providerOrderId: string;
  providerPaymentId: string;
  amountPaise: number;
  currency?: string;
  signature: string;
};

export type MockWebhookBody = {
  id: string;
  type: "payment.succeeded" | "payment.failed" | "refund.completed";
  providerOrderId: string;
  providerPaymentId: string;
  amountPaise: number;
  currency: string;
  mode?: "TEST" | "LIVE";
  failureCode?: string;
  failureMessage?: string;
};

function sign(secret: string | undefined, message: string): string {
  if (secret) return createHmac("sha256", secret).update(message).digest("hex");
  return hmacSign("payments", message);
}

export function mockOrderId(orderId: string): string {
  return `mock_order_${createHash("sha256").update(orderId).digest("hex").slice(0, 16)}`;
}

export function mockPaymentId(providerOrderId: string, attempt = 1): string {
  return `mock_pay_${createHash("sha256").update(`${providerOrderId}:${attempt}`).digest("hex").slice(0, 16)}`;
}

export function callbackMessage(p: { providerOrderId: string; providerPaymentId: string; amountPaise: number }): string {
  return `${p.providerOrderId}|${p.providerPaymentId}|${p.amountPaise}`;
}

/** Produce the `signature` field of a client callback. */
export function signMockCallback(
  payload: Omit<MockCallbackPayload, "signature">,
  secret?: string,
): string {
  return sign(secret, callbackMessage(payload));
}

/** Produce the `X-Mock-Signature` header for a raw webhook body. */
export function signMockWebhook(rawBody: string, secret?: string): string {
  return sign(secret, rawBody);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

const STATUS_BY_TYPE: Record<MockWebhookBody["type"], ProviderEventStatus> = {
  "payment.succeeded": "SUCCEEDED",
  "payment.failed": "FAILED",
  "refund.completed": "REFUNDED",
};

export function createMockProvider(ctx: ProviderContext): PaymentProvider {
  const secret = ctx.credentials.webhookSecret || undefined;

  return {
    code: "MOCK",
    displayName: ctx.displayName,
    supportsOnline: true,
    mode: ctx.mode,

    async createPayment({ order, amountPaise, currency }) {
      const providerOrderId = mockOrderId(order.id);
      return {
        providerOrderId,
        clientParams: {
          provider: "MOCK",
          providerOrderId,
          amountPaise,
          currency,
          orderNumber: order.orderNumber,
          // The storefront's mock checkout page posts this back to /verify
          // with a signature it obtains from the same helper (test builds).
          suggestedPaymentId: mockPaymentId(providerOrderId),
          mode: ctx.mode,
        },
      };
    },

    async getClientParams(payment) {
      return {
        provider: "MOCK",
        providerOrderId: payment.providerOrderId,
        amountPaise: payment.amountPaise,
        currency: payment.currency,
        suggestedPaymentId: payment.providerOrderId ? mockPaymentId(payment.providerOrderId) : null,
        mode: ctx.mode,
      };
    },

    async verifyClientCallback(payload): Promise<ClientCallbackResult> {
      const body = asRecord(payload);
      if (
        !body ||
        typeof body.providerOrderId !== "string" ||
        typeof body.providerPaymentId !== "string" ||
        !isInt(body.amountPaise) ||
        typeof body.signature !== "string"
      ) {
        return { ok: false, reason: "malformed" };
      }
      const expected = sign(
        secret,
        callbackMessage({
          providerOrderId: body.providerOrderId,
          providerPaymentId: body.providerPaymentId,
          amountPaise: body.amountPaise,
        }),
      );
      if (!constantTimeEqual(expected, body.signature)) return { ok: false, reason: "signature" };

      return {
        ok: true,
        providerOrderId: body.providerOrderId,
        providerPaymentId: body.providerPaymentId,
        amountPaise: body.amountPaise,
        currency: typeof body.currency === "string" ? body.currency : null,
        raw: body,
      };
    },

    async verifyWebhook({ rawBody, headers }) {
      const signature = headers.get(MOCK_SIGNATURE_HEADER);
      if (!signature) return { ok: false, reason: "signature" };
      if (!constantTimeEqual(sign(secret, rawBody), signature)) return { ok: false, reason: "signature" };

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return { ok: false, reason: "malformed" };
      }
      const body = asRecord(parsed);
      if (
        !body ||
        typeof body.type !== "string" ||
        !(body.type in STATUS_BY_TYPE) ||
        typeof body.providerOrderId !== "string" ||
        typeof body.providerPaymentId !== "string" ||
        !isInt(body.amountPaise)
      ) {
        return { ok: false, reason: "malformed" };
      }

      const eventId =
        (typeof body.id === "string" && body.id) || headers.get(MOCK_EVENT_ID_HEADER);
      if (!eventId) return { ok: false, reason: "malformed" };

      const event: ProviderWebhookEvent = {
        providerEventId: eventId,
        type: body.type,
        providerOrderId: body.providerOrderId,
        providerPaymentId: body.providerPaymentId,
        amountPaise: body.amountPaise,
        currency: typeof body.currency === "string" ? body.currency : "INR",
        status: STATUS_BY_TYPE[body.type as MockWebhookBody["type"]],
        mode: body.mode === "LIVE" ? "LIVE" : body.mode === "TEST" ? "TEST" : null,
        failureCode: typeof body.failureCode === "string" ? body.failureCode : null,
        failureMessage: typeof body.failureMessage === "string" ? body.failureMessage : null,
        raw: body,
      };
      return { ok: true, event };
    },

    async capture(providerPaymentId) {
      return { ok: true, status: "SUCCEEDED", providerPaymentId };
    },

    async refund({ payment, amountPaise }) {
      const providerRefundId = `mock_rf_${createHash("sha256")
        .update(`${payment.id}:${amountPaise}:${Date.now()}`)
        .digest("hex")
        .slice(0, 16)}`;
      return { providerRefundId, status: "COMPLETED" };
    },
  };
}
