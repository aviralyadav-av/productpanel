/**
 * Settings service (blueprint §14.E2, D4, D13).
 *
 * Three rules make this file worth reading:
 *
 *  1. Only keys in the registry are writable. The form is generated from
 *     SETTING_DEFINITIONS, so anything else is stale or hostile and is dropped
 *     rather than stored - the Setting table cannot grow keys nothing reads.
 *  2. Secrets are encrypted with the `smtp` purpose and a blank submission
 *     means "unchanged" (D4). There is no reveal path: the UI only ever learns
 *     `{ isSet, last4 }`.
 *  3. The audit row records KEY NAMES ONLY (D13). A settings diff carrying the
 *     new SMTP password would defeat the encryption it sits next to.
 *
 * No `server-only` / `next/*` imports: also used by the REST handlers and by
 * check scripts.
 */
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { validationError } from "@/lib/api/errors";
import { writeAudit, type AuditActor } from "@/lib/audit";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { decrypt, encrypt, isEncrypted, last4 } from "@/lib/crypto";
import { smtpConfigFromSettings, testSmtpConnection } from "@/lib/mailer";
import {
  maskedProviderConfig,
  saveProviderConfig,
  type MaskedProviderConfig,
} from "@/lib/payments";
import {
  SETTING_DEFINITIONS,
  settingDefinition,
  type SettingDefinition,
} from "@/lib/settings-keys";
import { invalidateSettingsCache } from "@/lib/settings";
import { queueRawEmail } from "@/features/email/service";

import type { SaveProviderValues, SecretState } from "./schemas";
import { changedSettingKeys, validateSettingValues } from "./values";

export type SettingsActor = AuditActor;
export type ClientMeta = { ip?: string | null };

type Db = Prisma.TransactionClient | typeof db;

// ---------------------------------------------------------------------------
// Reads shared with the server-only read side (queries.ts)
// ---------------------------------------------------------------------------

/** Stored strings for the given keys, falling back to the seeded default. */
export async function readStoredValues(
  keys: readonly string[],
  client: Db = db,
): Promise<Record<string, string>> {
  const rows = await client.setting.findMany({
    where: { key: { in: [...keys] } },
    select: { key: true, value: true },
  });
  const found = new Map(rows.map((row) => [row.key, row.value]));
  const output: Record<string, string> = {};
  for (const key of keys) {
    output[key] = found.get(key) ?? settingDefinition(key)?.defaultValue ?? "";
  }
  return output;
}

/**
 * D4 GET shape for a secret: whether one is stored and its last four
 * characters. `decrypt` is called only from this file, per D4.
 */
export function maskSecret(stored: string | null | undefined): SecretState {
  if (!stored) return { isSet: false, last4: null };
  if (!isEncrypted(stored)) return { isSet: true, last4: last4(stored) };
  try {
    return { isSet: true, last4: last4(decrypt(stored, "smtp")) };
  } catch {
    // ENCRYPTION_KEY was rotated: the value is there but unreadable. Say so by
    // reporting it set with no tail rather than pretending it is unset.
    return { isSet: true, last4: null };
  }
}

function safeDecrypt(value: string): string {
  try {
    return decrypt(value, "smtp");
  } catch {
    return "";
  }
}

/**
 * Plaintext email settings for the SMTP test only, never returned to a client.
 * An unsaved value typed into the form wins over the stored one so "Test
 * connection" checks what is on screen.
 */
export async function readSmtpValues(
  overrides: Record<string, string> = {},
): Promise<Record<string, string>> {
  const keys = SETTING_DEFINITIONS.filter((item) => item.group === "email").map(
    (item) => item.key,
  );
  const stored = await readStoredValues(keys);
  const values: Record<string, string> = {};

  for (const key of keys) {
    const definition = settingDefinition(key);
    const override = overrides[key];

    if (definition?.type === "secret") {
      if (override && override.trim() !== "") {
        values[key] = override.trim();
      } else {
        const raw = stored[key] ?? "";
        values[key] = raw && isEncrypted(raw) ? safeDecrypt(raw) : raw;
      }
      continue;
    }

    values[key] = override !== undefined && override !== "" ? override : (stored[key] ?? "");
  }
  return values;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export type UpdateSettingsResult = {
  changedKeys: string[];
  /** Groups touched, so the caller can revalidate the right tab. */
  groups: string[];
};

/**
 * Save a batch of settings. Only keys that actually changed are written, so
 * pressing Save on an untouched tab produces no audit noise and no updatedAt
 * churn.
 */
export async function updateSettings(
  submitted: Record<string, string>,
  actor: SettingsActor,
  meta: ClientMeta = {},
): Promise<UpdateSettingsResult> {
  const definitions = SETTING_DEFINITIONS.filter((item) => item.key in submitted);
  if (definitions.length === 0) return { changedKeys: [], groups: [] };

  const validated = validateSettingValues(definitions, submitted);
  if (!validated.ok) {
    throw validationError(validated.fieldErrors, "Some settings could not be saved.");
  }

  const stored = await readStoredValues(definitions.map((item) => item.key));
  const changed = changedSettingKeys(definitions, stored, submitted);
  if (changed.length === 0) return { changedKeys: [], groups: [] };

  const byKey = new Map(definitions.map((item) => [item.key, item]));

  await db.$transaction(async (tx) => {
    for (const key of changed) {
      const definition = byKey.get(key);
      if (!definition) continue;
      const plain = validated.values[key];
      if (plain === undefined) continue;
      const value = definition.type === "secret" ? encrypt(plain, "smtp") : plain;
      await upsertSetting(tx, definition, value);
    }

    // D13: names only. The diff says WHICH settings moved, never to what.
    await writeAudit(tx, {
      actor,
      action: "settings.update",
      entityType: "Setting",
      entityId: changed.length === 1 ? changed[0] : null,
      entityLabel: changed.length === 1 ? changed[0] : `${changed.length} settings`,
      summary: `Updated ${changed.length} setting(s): ${changed.slice(0, 8).join(", ")}${changed.length > 8 ? ", …" : ""}.`,
      diff: { keys: changed, groups: groupsOf(changed, byKey) },
      ip: meta.ip,
    });
  });

  invalidateSettingsCache(changed);
  await invalidatePublic(listTagsFor("setting"));

  return { changedKeys: changed, groups: groupsOf(changed, byKey) };
}

function groupsOf(keys: readonly string[], byKey: Map<string, SettingDefinition>): string[] {
  return [...new Set(keys.map((key) => byKey.get(key)?.group ?? "general"))];
}

/**
 * A Setting row may not exist yet (a key added to the registry after the seed
 * ran), so every write is an upsert carrying the registry's metadata - that is
 * what keeps `type`, `group`, `label` and `isPublic` in the database agreeing
 * with src/lib/settings-keys.ts.
 */
async function upsertSetting(
  tx: Db,
  definition: SettingDefinition,
  value: string,
): Promise<void> {
  const meta = {
    type: definition.type,
    group: definition.group,
    label: definition.label,
    helpText: definition.helpText || null,
    isPublic: definition.isPublic,
  };
  await tx.setting.upsert({
    where: { key: definition.key },
    create: { key: definition.key, value, ...meta },
    update: { value, ...meta },
  });
}

// ---------------------------------------------------------------------------
// Payment providers (D4; D13 "provider credential change - key names only")
// ---------------------------------------------------------------------------

export async function saveProvider(
  input: SaveProviderValues,
  actor: SettingsActor,
  meta: ClientMeta = {},
): Promise<MaskedProviderConfig> {
  const before = await maskedProviderConfig(input.provider);

  const { config, changedCredentialKeys } = await saveProviderConfig({
    provider: input.provider,
    isEnabled: input.isEnabled,
    mode: input.mode,
    displayName: input.displayName,
    position: input.position,
    supportedMethods: input.supportedMethods,
    credentials: input.credentials,
    settings: input.settings,
  });

  await writeAudit({
    actor,
    action: "settings.payment_provider_update",
    entityType: "PaymentProviderConfig",
    entityId: input.provider,
    entityLabel: config.displayName,
    summary:
      `Updated ${config.displayName} (${config.mode}, ${config.isEnabled ? "enabled" : "disabled"})` +
      (changedCredentialKeys.length > 0
        ? `; credentials changed: ${changedCredentialKeys.join(", ")}.`
        : "."),
    diff: {
      isEnabled: { from: before.isEnabled, to: config.isEnabled },
      mode: { from: before.mode, to: config.mode },
      position: { from: before.position, to: config.position },
      // Names only - never the values (D4/D13).
      credentialKeys: changedCredentialKeys,
      settings: { from: before.settings, to: config.settings } as Prisma.InputJsonValue,
    } as Prisma.InputJsonValue,
    ip: meta.ip,
  });

  await invalidatePublic(listTagsFor("setting"));
  return config;
}

// ---------------------------------------------------------------------------
// Email tests
// ---------------------------------------------------------------------------

export type SmtpTestOutcome = { ok: boolean; error: string | null; transport: string };

/**
 * Test the SMTP settings ON SCREEN, not only the saved ones: an operator who
 * has just typed a password should be able to prove it works before saving.
 */
export async function testSmtpSettings(
  overrides: Record<string, string> = {},
): Promise<SmtpTestOutcome> {
  const values = await readSmtpValues(overrides);
  const transport = (values["email.transport"] || "console").toLowerCase();

  if (transport !== "smtp") {
    return {
      ok: false,
      transport,
      error:
        "Transport is console: emails are printed to the server log and no SMTP connection is made. Switch it to smtp to test a real server.",
    };
  }

  const result = await testSmtpConnection(smtpConfigFromSettings(values));
  return { ok: result.ok, error: result.ok ? null : result.error, transport };
}

export type TestEmailResult = { queued: boolean; to: string; reason: string | null };

/**
 * Queue a real message through the normal outbox so the test exercises the
 * whole path (queue, worker, transport) rather than a shortcut that could pass
 * while production email is broken.
 */
export async function sendTestEmail(
  to: string,
  actor: SettingsActor,
  meta: ClientMeta = {},
): Promise<TestEmailResult> {
  const address = to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw validationError({ to: "Enter a valid email address." });
  }

  const values = await readStoredValues([
    "store.name",
    "email.transport",
    "email.from_address",
    "email.from_name",
  ]);
  const storeName = values["store.name"] || "DIY Baazar";

  const result = await queueRawEmail({
    to: { email: address, name: actor.email },
    subject: `${storeName} - test email`,
    html:
      `<p>This is a test message from the ${storeName} admin, requested by ${actor.email}.</p>` +
      `<p>Transport: <strong>${values["email.transport"]}</strong>. From: ${values["email.from_name"]} (${values["email.from_address"]}).</p>`,
    text: `Test message from the ${storeName} admin, requested by ${actor.email}. Transport: ${values["email.transport"]}.`,
    dedupeKey: null,
  });

  await writeAudit({
    actor,
    action: "settings.email_test",
    entityType: "Setting",
    entityId: "email.transport",
    entityLabel: "Email",
    summary: `Sent a test email to ${address} (transport ${values["email.transport"]}).`,
    ip: meta.ip,
  });

  return {
    queued: result.queued,
    to: address,
    reason: result.queued ? null : result.reason,
  };
}
