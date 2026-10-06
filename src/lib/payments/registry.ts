import type { Prisma } from "@prisma/client";

import { decrypt, encrypt, isEncrypted, last4 } from "@/lib/crypto";
import { db } from "@/lib/db";
import {
  paymentProviderModeSchema,
  paymentProviderSchema,
  type PaymentProviderCode,
  type PaymentProviderMode,
} from "@/lib/enums";
import { createCodProvider } from "./providers/cod";
import { createManualProvider } from "./providers/manual";
import { createMockProvider } from "./providers/mock";
import { createRazorpayProvider } from "./providers/razorpay";
import {
  PaymentProviderError,
  type EnabledProviderSummary,
  type MaskedProviderConfig,
  type MaskedSecret,
  type PaymentProvider,
  type ProviderFactory,
} from "./types";

/**
 * Provider registry over the PaymentProviderConfig table (blueprint §10, D4).
 *
 * `credentialsEnc` holds `{ key: "v1:..." }` - every value AES-GCM encrypted
 * with purpose `payments`. Decryption happens here and only here; everything
 * above this module (settings UI, API) receives `{ isSet, last4 }`. This file
 * is the payments "service" in the D4 sense.
 *
 * Provider instances are not cached: an admin toggling TEST→LIVE or rotating a
 * secret must take effect on the next webhook, and constructing a provider is
 * a handful of string reads.
 */

const FACTORIES: Partial<Record<PaymentProviderCode, ProviderFactory>> = {
  COD: createCodProvider,
  MANUAL: createManualProvider,
  MOCK: createMockProvider,
  RAZORPAY: createRazorpayProvider,
};

/** Which credential keys each provider's settings form shows (D4 masked GET). */
export const PROVIDER_CREDENTIAL_KEYS: Record<PaymentProviderCode, readonly string[]> = {
  COD: [],
  MANUAL: [],
  MOCK: ["webhookSecret"],
  RAZORPAY: ["keyId", "keySecret", "webhookSecret"],
  STRIPE: ["secretKey", "webhookSecret"],
  PAYU: ["merchantKey", "merchantSalt"],
  PHONEPE: ["merchantId", "saltKey", "saltIndex"],
};

export const ONLINE_PROVIDERS: readonly PaymentProviderCode[] = ["MOCK", "RAZORPAY", "STRIPE", "PAYU", "PHONEPE"];

export function isProviderImplemented(code: PaymentProviderCode): boolean {
  return Boolean(FACTORIES[code]);
}

type ConfigRow = {
  provider: string;
  displayName: string;
  isEnabled: boolean;
  mode: string;
  credentialsEnc: Prisma.JsonValue;
  settings: Prisma.JsonValue;
  supportedMethods: string[];
  position: number;
};

function asStringMap(value: Prisma.JsonValue): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

function asObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseCode(code: string): PaymentProviderCode {
  const parsed = paymentProviderSchema.safeParse(code.toUpperCase());
  if (!parsed.success) {
    throw new PaymentProviderError("UNKNOWN_PROVIDER", `Unknown payment provider "${code}".`);
  }
  return parsed.data;
}

function parseMode(mode: string): PaymentProviderMode {
  const parsed = paymentProviderModeSchema.safeParse(mode);
  return parsed.success ? parsed.data : "TEST";
}

function decryptCredentials(enc: Prisma.JsonValue): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(asStringMap(enc))) {
    // A plain value can only come from a hand-edited row; accept it so a
    // developer's local database works, but never write one back unencrypted.
    out[key] = isEncrypted(value) ? decrypt(value, "payments") : value;
  }
  return out;
}

async function loadConfig(code: PaymentProviderCode): Promise<ConfigRow | null> {
  return db.paymentProviderConfig.findUnique({ where: { provider: code } });
}

export type GetProviderOptions = {
  /** Default true: a disabled provider throws DISABLED (D5). */
  requireEnabled?: boolean;
  /** Test seam for the network layer. */
  fetch?: typeof fetch;
};

/**
 * Instantiate a provider from its stored config. Throws PaymentProviderError
 * (UNKNOWN_PROVIDER / NOT_IMPLEMENTED / DISABLED) so routes can map to 404/503.
 */
export async function getPaymentProvider(
  codeInput: string,
  options: GetProviderOptions = {},
): Promise<PaymentProvider> {
  const code = parseCode(codeInput);
  const factory = FACTORIES[code];
  if (!factory) {
    throw new PaymentProviderError("NOT_IMPLEMENTED", `${code} is not available in this build.`);
  }

  const row = await loadConfig(code);
  const enabled = row?.isEnabled ?? false;
  if ((options.requireEnabled ?? true) && !enabled) {
    throw new PaymentProviderError("DISABLED", `${code} is not enabled.`);
  }

  return factory({
    code,
    displayName: row?.displayName ?? code,
    mode: parseMode(row?.mode ?? "TEST"),
    credentials: row ? decryptCredentials(row.credentialsEnc) : {},
    settings: row ? asObject(row.settings) : {},
    fetch: options.fetch ?? fetch,
  });
}

/** Stored mode for a provider, for the D5 mode-mismatch check. */
export async function getProviderMode(codeInput: string): Promise<PaymentProviderMode | null> {
  const row = await loadConfig(parseCode(codeInput));
  return row ? parseMode(row.mode) : null;
}

/** Enabled, implemented providers in display order - the checkout's method list. */
export async function listEnabledProviders(): Promise<EnabledProviderSummary[]> {
  const rows = await db.paymentProviderConfig.findMany({
    where: { isEnabled: true },
    orderBy: { position: "asc" },
  });
  const out: EnabledProviderSummary[] = [];
  for (const row of rows) {
    const parsed = paymentProviderSchema.safeParse(row.provider);
    if (!parsed.success || !isProviderImplemented(parsed.data)) continue;
    out.push({
      code: parsed.data,
      displayName: row.displayName,
      mode: parseMode(row.mode),
      supportsOnline: ONLINE_PROVIDERS.includes(parsed.data),
      supportedMethods: row.supportedMethods,
      position: row.position,
    });
  }
  return out;
}

function maskAll(code: PaymentProviderCode, enc: Prisma.JsonValue): Record<string, MaskedSecret> {
  const stored = asStringMap(enc);
  const masked: Record<string, MaskedSecret> = {};
  for (const key of PROVIDER_CREDENTIAL_KEYS[code]) {
    const value = stored[key];
    if (!value) {
      masked[key] = { isSet: false, last4: null };
      continue;
    }
    let plain: string | null = null;
    try {
      plain = isEncrypted(value) ? decrypt(value, "payments") : value;
    } catch {
      plain = null; // rotated key: report "set" but no tail
    }
    masked[key] = { isSet: true, last4: plain ? last4(plain) : null };
  }
  return masked;
}

function toMasked(code: PaymentProviderCode, row: ConfigRow | null): MaskedProviderConfig {
  return {
    provider: code,
    displayName: row?.displayName ?? code,
    isEnabled: row?.isEnabled ?? false,
    mode: parseMode(row?.mode ?? "TEST"),
    supportedMethods: row?.supportedMethods ?? [],
    position: row?.position ?? 0,
    settings: row ? asObject(row.settings) : {},
    credentials: maskAll(code, row?.credentialsEnc ?? {}),
    credentialKeys: PROVIDER_CREDENTIAL_KEYS[code],
    implemented: isProviderImplemented(code),
  };
}

/** D4 GET shape for one provider: settings plus `{ isSet, last4 }` per secret. */
export async function maskedProviderConfig(codeInput: string): Promise<MaskedProviderConfig> {
  const code = parseCode(codeInput);
  return toMasked(code, await loadConfig(code));
}

/** Every provider row, masked, for the Settings → Payments tab. */
export async function listMaskedProviderConfigs(): Promise<MaskedProviderConfig[]> {
  const rows = await db.paymentProviderConfig.findMany({ orderBy: { position: "asc" } });
  return rows
    .filter((row) => paymentProviderSchema.safeParse(row.provider).success)
    .map((row) => toMasked(row.provider as PaymentProviderCode, row));
}

export type SaveProviderConfigInput = {
  provider: string;
  /**
   * Plaintext values by key. `undefined`/empty = leave the stored secret
   * unchanged (D4); `null` = clear it. Unknown keys are dropped.
   */
  credentials?: Record<string, string | null | undefined>;
  settings?: Record<string, unknown>;
  isEnabled?: boolean;
  mode?: PaymentProviderMode;
  displayName?: string;
  supportedMethods?: string[];
  position?: number;
  tx?: Prisma.TransactionClient;
};

export type SaveProviderConfigResult = {
  config: MaskedProviderConfig;
  /** Credential keys whose value changed - the audit row records names only (D13). */
  changedCredentialKeys: string[];
};

/**
 * Upsert a provider's config, encrypting every supplied credential. Returns
 * the masked view so callers never see plaintext coming back out.
 */
export async function saveProviderConfig(input: SaveProviderConfigInput): Promise<SaveProviderConfigResult> {
  const code = parseCode(input.provider);
  const client = input.tx ?? db;
  const existing = await client.paymentProviderConfig.findUnique({ where: { provider: code } });

  const stored = asStringMap(existing?.credentialsEnc ?? {});
  const next: Record<string, string> = { ...stored };
  const changedCredentialKeys: string[] = [];

  for (const key of PROVIDER_CREDENTIAL_KEYS[code]) {
    if (!input.credentials || !(key in input.credentials)) continue;
    const value = input.credentials[key];
    if (value === undefined || value === "") continue; // unchanged
    if (value === null) {
      if (key in next) {
        delete next[key];
        changedCredentialKeys.push(key);
      }
      continue;
    }
    next[key] = encrypt(value.trim(), "payments");
    changedCredentialKeys.push(key);
  }

  const data = {
    displayName: input.displayName ?? existing?.displayName ?? code,
    isEnabled: input.isEnabled ?? existing?.isEnabled ?? false,
    mode: input.mode ?? parseMode(existing?.mode ?? "TEST"),
    credentialsEnc: next as Prisma.InputJsonObject,
    settings: (input.settings ?? asObject(existing?.settings ?? {})) as Prisma.InputJsonObject,
    supportedMethods: input.supportedMethods ?? existing?.supportedMethods ?? [],
    position: input.position ?? existing?.position ?? 0,
  };

  const row = await client.paymentProviderConfig.upsert({
    where: { provider: code },
    update: data,
    create: { provider: code, ...data },
  });

  return { config: toMasked(code, row), changedCredentialKeys };
}
