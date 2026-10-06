/**
 * Payments entry point (blueprint §10, §14.B6, D4, D5).
 *
 *   getPaymentProvider(code)  → a PaymentProvider built from PaymentProviderConfig
 *   listEnabledProviders()    → checkout method list
 *   saveProviderConfig()      → encrypts credentials; maskedProviderConfig() → { isSet, last4 }
 *   settlePaymentEvent()      → the single webhook/verify → OrderPayment/Order transition
 */
export type {
  CaptureResult,
  ClientCallbackResult,
  CreatePaymentInput,
  CreatePaymentResult,
  EnabledProviderSummary,
  MaskedProviderConfig,
  MaskedSecret,
  PaymentProvider,
  PaymentRecord,
  ProviderContext,
  ProviderCustomer,
  ProviderEventStatus,
  ProviderFactory,
  ProviderWebhookEvent,
  RefundInput,
  RefundResult,
  VerifyWebhookInput,
  VerifyWebhookResult,
} from "./types";
export { PaymentProviderError } from "./types";
export {
  ONLINE_PROVIDERS,
  PROVIDER_CREDENTIAL_KEYS,
  getPaymentProvider,
  getProviderMode,
  isProviderImplemented,
  listEnabledProviders,
  listMaskedProviderConfigs,
  maskedProviderConfig,
  saveProviderConfig,
  type GetProviderOptions,
  type SaveProviderConfigInput,
  type SaveProviderConfigResult,
} from "./registry";
export { AFTER_PAYMENT_JOB, settlePaymentEvent, type SettleInput, type SettleResult, type SettleSource } from "./settle";
export {
  MOCK_EVENT_ID_HEADER,
  MOCK_SIGNATURE_HEADER,
  mockOrderId,
  mockPaymentId,
  signMockCallback,
  signMockWebhook,
} from "./providers/mock";
