import { createHmac } from "node:crypto";

import { constantTimeEqual } from "@/lib/crypto";
import type {
  ClientCallbackResult,
  PaymentProvider,
  ProviderContext,
  ProviderEventStatus,
  ProviderWebhookEvent,
} from "../types";
import { PaymentProviderError } from "../types";

/**
 * Razorpay (https://razorpay.com/docs/api/). Skeleton with the real wire
 * shapes; every HTTP call goes through `ctx.fetch`, so the module compiles and
 * is unit-testable without network access, and the live behaviour is enabled
 * simply by an admin entering credentials in Settings → Payments.
 *
 * Credentials: `keyId`, `keySecret` (REST basic auth + checkout signature),
 * `webhookSecret` (set separately in the Razorpay dashboard per webhook).
 *
 * Signatures (both HMAC-SHA256, hex):
 *   checkout callback : HMAC(keySecret,     `${razorpay_order_id}|${razorpay_payment_id}`) == razorpay_signature
 *   webhook           : HMAC(webhookSecret, rawBody) == X-Razorpay-Signature
 * Razorpay amounts are already integer paise for INR.
 */

const API_BASE = "https://api.razorpay.com/v1";
export const RAZORPAY_SIGNATURE_HEADER = "x-razorpay-signature";
export const RAZORPAY_EVENT_ID_HEADER = "x-razorpay-event-id";

type RazorpayOrder = { id: string; amount: number; currency: string; receipt?: string; status: string };
type RazorpayPayment = {
  id: string;
  order_id?: string | null;
  amount: number;
  currency: string;
  status: string;
  error_code?: string | null;
  error_description?: string | null;
};
type RazorpayRefund = { id: string; amount: number; status: string };
type RazorpayWebhook = {
  event: string;
  payload?: {
    payment?: { entity?: RazorpayPayment };
    refund?: { entity?: RazorpayRefund & { payment_id?: string } };
    order?: { entity?: RazorpayOrder };
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const EVENT_STATUS: Record<string, ProviderEventStatus> = {
  "payment.captured": "SUCCEEDED",
  "payment.authorized": "PENDING",
  "payment.failed": "FAILED",
  "order.paid": "SUCCEEDED",
  "refund.processed": "REFUNDED",
  "refund.created": "IGNORED",
  "refund.failed": "IGNORED",
};

export function createRazorpayProvider(ctx: ProviderContext): PaymentProvider {
  const keyId = ctx.credentials.keyId ?? "";
  const keySecret = ctx.credentials.keySecret ?? "";
  const webhookSecret = ctx.credentials.webhookSecret ?? "";

  function requireKeys(): void {
    if (!keyId || !keySecret) {
      throw new PaymentProviderError("NOT_CONFIGURED", "Razorpay key id / secret are not configured.");
    }
  }

  async function call<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    requireKeys();
    const response = await ctx.fetch(`${API_BASE}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const error = asRecord(asRecord(json)?.error);
      throw new PaymentProviderError(
        "GATEWAY_ERROR",
        `Razorpay ${path} failed (${response.status}): ${String(error?.description ?? "unknown error")}`,
        { status: response.status, code: error?.code },
      );
    }
    return json as T;
  }

  return {
    code: "RAZORPAY",
    displayName: ctx.displayName,
    supportsOnline: true,
    mode: ctx.mode,

    async createPayment({ order, amountPaise, currency, customer }) {
      const created = await call<RazorpayOrder>("/orders", {
        amount: amountPaise,
        currency,
        receipt: order.orderNumber,
        notes: { orderId: order.id, orderNumber: order.orderNumber },
      });
      return {
        providerOrderId: created.id,
        clientParams: {
          key: keyId,
          order_id: created.id,
          amount: amountPaise,
          currency,
          prefill: {
            email: customer.email ?? undefined,
            contact: customer.phone ?? undefined,
            name: customer.name ?? undefined,
          },
          notes: { orderNumber: order.orderNumber },
        },
      };
    },

    async getClientParams(payment) {
      return {
        key: keyId,
        order_id: payment.providerOrderId,
        amount: payment.amountPaise,
        currency: payment.currency,
      };
    },

    async verifyClientCallback(payload): Promise<ClientCallbackResult> {
      const body = asRecord(payload);
      const orderId = body?.razorpay_order_id;
      const paymentId = body?.razorpay_payment_id;
      const signature = body?.razorpay_signature;
      if (!body || typeof orderId !== "string" || typeof paymentId !== "string" || typeof signature !== "string") {
        return { ok: false, reason: "malformed" };
      }
      requireKeys();
      const expected = createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
      if (!constantTimeEqual(expected, signature)) return { ok: false, reason: "signature" };
      // The checkout callback carries no amount; the settlement compares the
      // stored OrderPayment against the webhook / a later fetch instead.
      return { ok: true, providerOrderId: orderId, providerPaymentId: paymentId, amountPaise: null, currency: null, raw: body };
    },

    async verifyWebhook({ rawBody, headers }) {
      if (!webhookSecret) return { ok: false, reason: "unsupported" };
      const signature = headers.get(RAZORPAY_SIGNATURE_HEADER);
      if (!signature) return { ok: false, reason: "signature" };
      const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
      if (!constantTimeEqual(expected, signature)) return { ok: false, reason: "signature" };

      let parsed: RazorpayWebhook;
      try {
        parsed = JSON.parse(rawBody) as RazorpayWebhook;
      } catch {
        return { ok: false, reason: "malformed" };
      }
      if (!parsed || typeof parsed.event !== "string") return { ok: false, reason: "malformed" };

      const payment = parsed.payload?.payment?.entity ?? null;
      const refund = parsed.payload?.refund?.entity ?? null;
      const eventId = headers.get(RAZORPAY_EVENT_ID_HEADER) ?? `${parsed.event}:${payment?.id ?? refund?.id ?? "unknown"}`;

      const event: ProviderWebhookEvent = {
        providerEventId: eventId,
        type: parsed.event,
        providerOrderId: payment?.order_id ?? parsed.payload?.order?.entity?.id ?? null,
        providerPaymentId: payment?.id ?? refund?.payment_id ?? null,
        amountPaise: payment?.amount ?? refund?.amount ?? null,
        currency: payment?.currency ?? null,
        status: EVENT_STATUS[parsed.event] ?? "IGNORED",
        // Razorpay keys are test (rzp_test_) or live (rzp_live_); the webhook
        // itself does not say, so the registry's mode check uses the key.
        mode: keyId.startsWith("rzp_live_") ? "LIVE" : keyId.startsWith("rzp_test_") ? "TEST" : null,
        failureCode: payment?.error_code ?? null,
        failureMessage: payment?.error_description ?? null,
        raw: parsed,
      };
      return { ok: true, event };
    },

    async capture(providerPaymentId, amountPaise, currency) {
      const captured = await call<RazorpayPayment>(`/payments/${encodeURIComponent(providerPaymentId)}/capture`, {
        amount: amountPaise,
        currency,
      });
      return {
        ok: captured.status === "captured",
        status: captured.status === "captured" ? "SUCCEEDED" : captured.status === "failed" ? "FAILED" : "PENDING",
        providerPaymentId: captured.id,
        raw: captured,
      };
    },

    async refund({ payment, amountPaise, reason }) {
      if (!payment.providerPaymentId) {
        throw new PaymentProviderError("UNSUPPORTED", "Cannot refund a payment without a gateway payment id.");
      }
      const refund = await call<RazorpayRefund>(`/payments/${encodeURIComponent(payment.providerPaymentId)}/refund`, {
        amount: amountPaise,
        speed: "normal",
        notes: reason ? { reason } : undefined,
      });
      return {
        providerRefundId: refund.id,
        status: refund.status === "processed" ? "COMPLETED" : refund.status === "failed" ? "FAILED" : "PROCESSING",
        raw: refund,
      };
    },
  };
}
