import type { PaymentProviderCode, PaymentProviderMode } from "@/lib/enums";

/**
 * Payment provider contract (blueprint §10 + §14.B6, D5).
 *
 * Every gateway is reduced to the same seven verbs so the order flow, the
 * webhook route and the refund service never branch on provider code. Money
 * is integer paise throughout - Razorpay happens to agree; a provider that
 * speaks rupees converts at its own boundary.
 *
 * Network access goes through `ctx.fetch` so a provider can be exercised in a
 * unit test with a stub, and so the registry can inject a timeout wrapper
 * without each provider re-implementing it.
 */

export type ProviderCustomer = {
  email?: string | null;
  name?: string | null;
  phone?: string | null;
};

export type CreatePaymentInput = {
  order: { id: string; orderNumber: string };
  amountPaise: number;
  currency: string;
  customer: ProviderCustomer;
};

export type CreatePaymentResult = {
  /** The gateway's order/intent id, stored on OrderPayment.providerOrderId. */
  providerOrderId: string;
  /** Whatever the storefront SDK needs to open the checkout (key id, amount, ids). */
  clientParams: Record<string, unknown>;
};

/** The columns a provider may need from an OrderPayment row. */
export type PaymentRecord = {
  id: string;
  orderId: string;
  provider: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  amountPaise: number;
  currency: string;
  status: string;
};

export type ClientCallbackResult =
  | {
      ok: true;
      providerOrderId: string;
      providerPaymentId: string;
      /** Null when the callback does not carry an amount (Razorpay); the stored row is trusted then. */
      amountPaise: number | null;
      currency: string | null;
      raw: Record<string, unknown>;
    }
  | { ok: false; reason: "signature" | "malformed" };

/** Normalised gateway event, whatever the provider's own vocabulary. */
export type ProviderEventStatus = "SUCCEEDED" | "FAILED" | "PENDING" | "REFUNDED" | "IGNORED";

export type ProviderWebhookEvent = {
  providerEventId: string;
  /** Provider's own event name, kept for the audit trail. */
  type: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  amountPaise: number | null;
  currency: string | null;
  status: ProviderEventStatus;
  /** TEST | LIVE when the provider says; null when it does not distinguish. */
  mode: PaymentProviderMode | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  raw: unknown;
};

export type VerifyWebhookInput = {
  rawBody: string;
  headers: Headers;
};

export type VerifyWebhookResult =
  | { ok: true; event: ProviderWebhookEvent }
  | { ok: false; reason: "signature" | "malformed" | "unsupported" };

export type CaptureResult = {
  ok: boolean;
  status: "SUCCEEDED" | "FAILED" | "PENDING";
  providerPaymentId: string;
  raw?: unknown;
};

export type RefundInput = {
  payment: PaymentRecord;
  amountPaise: number;
  reason?: string | null;
};

export type RefundResult = {
  providerRefundId: string;
  /** PROCESSING when the gateway settles asynchronously; COMPLETED when instant. */
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  raw?: unknown;
};

export interface PaymentProvider {
  readonly code: PaymentProviderCode;
  readonly displayName: string;
  /** False for COD/MANUAL: no checkout, no webhook, no client callback. */
  readonly supportsOnline: boolean;
  readonly mode: PaymentProviderMode;

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Re-derive what the storefront SDK needs for an existing (retry) payment. */
  getClientParams(payment: PaymentRecord): Promise<Record<string, unknown>>;
  /** The browser-side success callback the storefront posts to /verify (B6). */
  verifyClientCallback(payload: unknown): Promise<ClientCallbackResult>;
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifyWebhookResult>;
  capture(providerPaymentId: string, amountPaise: number, currency: string): Promise<CaptureResult>;
  refund(input: RefundInput): Promise<RefundResult>;
}

/** What the registry hands a provider factory. */
export type ProviderContext = {
  code: PaymentProviderCode;
  displayName: string;
  mode: PaymentProviderMode;
  /** Decrypted credential values by key (empty for COD/MANUAL). */
  credentials: Record<string, string>;
  settings: Record<string, unknown>;
  fetch: typeof fetch;
};

export type ProviderFactory = (ctx: ProviderContext) => PaymentProvider;

/** Public shape of a provider for the storefront's payment-method list. */
export type EnabledProviderSummary = {
  code: PaymentProviderCode;
  displayName: string;
  mode: PaymentProviderMode;
  supportsOnline: boolean;
  supportedMethods: string[];
  position: number;
};

/** D4: secrets are never returned, only whether they are set and their tail. */
export type MaskedSecret = { isSet: boolean; last4: string | null };

export type MaskedProviderConfig = {
  provider: PaymentProviderCode;
  displayName: string;
  isEnabled: boolean;
  mode: PaymentProviderMode;
  supportedMethods: string[];
  position: number;
  settings: Record<string, unknown>;
  credentials: Record<string, MaskedSecret>;
  /** Credential keys this provider understands, for the settings form. */
  credentialKeys: readonly string[];
  implemented: boolean;
};

export class PaymentProviderError extends Error {
  constructor(
    public readonly code:
      | "UNKNOWN_PROVIDER"
      | "NOT_IMPLEMENTED"
      | "DISABLED"
      | "NOT_CONFIGURED"
      | "GATEWAY_ERROR"
      | "UNSUPPORTED",
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
