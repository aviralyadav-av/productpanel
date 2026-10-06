/**
 * Per-provider field descriptions for Settings -> Payments (blueprint §4.9,
 * §14.D4).
 *
 * `src/lib/payments` owns WHICH credential keys a provider stores
 * (PROVIDER_CREDENTIAL_KEYS) and the encryption; this file only says how to
 * label them for an operator and which non-secret settings each provider
 * understands, so the form is generated rather than hand-written seven times.
 *
 * Client-safe: no db, no crypto, no next imports.
 */
import {
  PAYMENT_PROVIDERS,
  PAYMENT_PROVIDER_META,
  type PaymentProviderCode,
} from "@/lib/enums";

export type ProviderCredentialField = {
  key: string;
  label: string;
  helpText: string;
  /** Some gateways use a short numeric index rather than a long secret. */
  short?: boolean;
};

export type ProviderSettingField = {
  key: string;
  label: string;
  helpText: string;
  type: "money" | "number" | "boolean" | "string";
};

export type ProviderFormSpec = {
  code: PaymentProviderCode;
  label: string;
  description: string;
  /** COD/MANUAL are offline: no gateway, no webhook. */
  online: boolean;
  credentials: readonly ProviderCredentialField[];
  settings: readonly ProviderSettingField[];
  /** Methods the checkout may advertise for this provider. */
  methods: readonly string[];
};

const CREDENTIALS: Record<PaymentProviderCode, readonly ProviderCredentialField[]> = {
  COD: [],
  MANUAL: [],
  MOCK: [
    { key: "webhookSecret", label: "Webhook secret", helpText: "Signs the simulated webhook. Any string works in TEST." },
  ],
  RAZORPAY: [
    { key: "keyId", label: "Key ID", helpText: "rzp_test_… or rzp_live_…; sent to the browser checkout." },
    { key: "keySecret", label: "Key secret", helpText: "Server-side only. Never leaves this server." },
    { key: "webhookSecret", label: "Webhook secret", helpText: "Set the same value in the Razorpay dashboard webhook." },
  ],
  STRIPE: [
    { key: "secretKey", label: "Secret key", helpText: "sk_test_… or sk_live_…" },
    { key: "webhookSecret", label: "Webhook signing secret", helpText: "whsec_… from the Stripe webhook endpoint." },
  ],
  PAYU: [
    { key: "merchantKey", label: "Merchant key", helpText: "From the PayU dashboard." },
    { key: "merchantSalt", label: "Merchant salt", helpText: "Used to sign requests and verify responses." },
  ],
  PHONEPE: [
    { key: "merchantId", label: "Merchant ID", helpText: "PGTESTPAYUAT for the sandbox." },
    { key: "saltKey", label: "Salt key", helpText: "Signs the X-VERIFY header." },
    { key: "saltIndex", label: "Salt index", helpText: "Usually 1.", short: true },
  ],
};

const SETTINGS: Record<PaymentProviderCode, readonly ProviderSettingField[]> = {
  COD: [
    {
      key: "feePaiseOverride",
      label: "COD fee override",
      helpText: "Overrides orders.cod_fee_paise for this provider. Leave empty to use the Orders setting.",
      type: "money",
    },
    {
      key: "maxOrderPaiseOverride",
      label: "Maximum order value override",
      helpText: "Overrides orders.cod_max_paise. Leave empty to use the Orders setting.",
      type: "money",
    },
  ],
  MANUAL: [
    {
      key: "instructions",
      label: "Instructions for the operator",
      helpText: "Shown on the record-payment dialog, e.g. which bank account to check.",
      type: "string",
    },
  ],
  MOCK: [
    { key: "alwaysSucceed", label: "Always succeed", helpText: "Off makes every mock payment fail, for testing the failure path.", type: "boolean" },
  ],
  RAZORPAY: [
    { key: "themeColor", label: "Checkout theme colour", helpText: "Hex colour used by the Razorpay modal, e.g. #0f172a.", type: "string" },
  ],
  STRIPE: [],
  PAYU: [],
  PHONEPE: [],
};

const METHODS: Record<PaymentProviderCode, readonly string[]> = {
  COD: ["COD"],
  MANUAL: ["BANK_TRANSFER", "UPI", "CASH"],
  MOCK: ["CARD", "UPI"],
  RAZORPAY: ["CARD", "UPI", "NETBANKING", "WALLET"],
  STRIPE: ["CARD"],
  PAYU: ["CARD", "UPI", "NETBANKING"],
  PHONEPE: ["UPI", "CARD"],
};

const DESCRIPTIONS: Record<PaymentProviderCode, string> = {
  COD: "Cash collected by the courier. No gateway; the order is placed unpaid and the payment is recorded on delivery.",
  MANUAL: "Bank transfer or UPI reconciled by hand. An operator records the payment against the order.",
  MOCK: "Built-in fake gateway for testing the full online flow without a real account. Never enable in LIVE mode.",
  RAZORPAY: "Cards, UPI, netbanking and wallets through Razorpay.",
  STRIPE: "Card payments through Stripe. Not implemented yet - configuration is stored, but checkout will refuse it.",
  PAYU: "Cards, UPI and netbanking through PayU. Not implemented yet.",
  PHONEPE: "UPI-first gateway. Not implemented yet.",
};

export const PROVIDER_FORMS: readonly ProviderFormSpec[] = PAYMENT_PROVIDERS.map((code) => ({
  code,
  label: PAYMENT_PROVIDER_META[code].label,
  description: DESCRIPTIONS[code],
  online: code !== "COD" && code !== "MANUAL",
  credentials: CREDENTIALS[code],
  settings: SETTINGS[code],
  methods: METHODS[code],
}));

export function providerForm(code: string): ProviderFormSpec | undefined {
  return PROVIDER_FORMS.find((item) => item.code === code);
}

/** Where the gateway must POST its webhooks (D5). Shown with a copy button. */
export function providerWebhookUrl(origin: string, code: PaymentProviderCode): string {
  return `${origin.replace(/\/+$/, "")}/api/v1/payments/${code.toLowerCase()}/webhook`;
}
