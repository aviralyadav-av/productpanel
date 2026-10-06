import { randomUUID } from "node:crypto";

import type { PaymentProvider, ProviderContext } from "../types";
import { PaymentProviderError } from "../types";

/**
 * MANUAL covers money that moved outside any gateway - a bank transfer the
 * operator saw on a statement, cash at a counter, a UPI screenshot. An
 * operator with `payments.manage` records the OrderPayment directly; the
 * provider exists so the code path is uniform and so a refund can be
 * "recorded" with a synthetic reference the operator can later match.
 */
export function createManualProvider(ctx: ProviderContext): PaymentProvider {
  return {
    code: "MANUAL",
    displayName: ctx.displayName,
    supportsOnline: false,
    mode: ctx.mode,
    async createPayment() {
      throw new PaymentProviderError("UNSUPPORTED", "Manual payments are recorded by an operator, not created online.");
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
    async capture(providerPaymentId) {
      return { ok: true, status: "SUCCEEDED", providerPaymentId };
    },
    async refund() {
      // The operator moves the money; we only mint a reference to pin it to.
      return { providerRefundId: `manual_rf_${randomUUID()}`, status: "COMPLETED" };
    },
  };
}
