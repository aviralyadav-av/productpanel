import type { PaymentProvider, ProviderContext } from "../types";
import { PaymentProviderError } from "../types";

/**
 * Cash on delivery has no online leg at all: the OrderPayment row is created
 * by the shipment DELIVERED transition (B6), never by a gateway. Every online
 * verb therefore refuses loudly - a storefront that asks COD for client params
 * has a bug, and a silent `{}` would hide it.
 */
export function createCodProvider(ctx: ProviderContext): PaymentProvider {
  const unsupported = (verb: string) =>
    new PaymentProviderError("UNSUPPORTED", `Cash on delivery has no ${verb} step.`);

  return {
    code: "COD",
    displayName: ctx.displayName,
    supportsOnline: false,
    mode: ctx.mode,
    async createPayment() {
      throw unsupported("online payment");
    },
    async getClientParams() {
      return {};
    },
    async verifyClientCallback() {
      return { ok: false, reason: "malformed" };
    },
    async verifyWebhook() {
      return { ok: false, reason: "unsupported" };
    },
    async capture() {
      throw unsupported("capture");
    },
    async refund() {
      // COD money is refunded by bank transfer, recorded by an operator (B6).
      throw new PaymentProviderError(
        "UNSUPPORTED",
        "COD orders are refunded by bank transfer or manual entry, not through a gateway.",
      );
    },
  };
}
