import "server-only";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { listMaskedProviderConfigs } from "@/lib/payments";
import { SETTING_DEFINITIONS, SETTING_GROUPS, type SettingGroup } from "@/lib/settings-keys";
import { getMediaAssets } from "@/features/media/queries";

import { providerWebhookUrl } from "./payment-providers";
import {
  isMediaSettingKey,
  type PaymentProviderView,
  type SettingFieldView,
  type SettingsGroupView,
} from "./schemas";
import { maskSecret, readStoredValues } from "./service";

/**
 * Read side of /admin/settings.
 *
 * The tab is generated from the registry, not from the Setting table: a key
 * that has never been saved still renders (with its seeded default), so a
 * fresh database and a long-lived one look identical. Secrets are replaced by
 * `{ isSet, last4 }` before they leave this file (D4) - the stored ciphertext
 * never reaches a client component.
 */

function definitionsFor(group: SettingGroup) {
  return SETTING_DEFINITIONS.filter((item) => item.group === group);
}

export async function getSettingsGroup(group: SettingGroup): Promise<SettingsGroupView> {
  const definitions = definitionsFor(group);
  const keys = definitions.map((item) => item.key);

  const [stored, rows] = await Promise.all([
    readStoredValues(keys),
    db.setting.findMany({
      where: { key: { in: keys } },
      select: { key: true, updatedAt: true },
    }),
  ]);
  const updatedAt = new Map(rows.map((row) => [row.key, row.updatedAt.toISOString()]));

  // Only the three media-id keys need a round trip, and only when they are set.
  const mediaIds = definitions
    .filter((item) => isMediaSettingKey(item.key))
    .map((item) => stored[item.key])
    .filter((value): value is string => Boolean(value));
  const assets = mediaIds.length > 0 ? await getMediaAssets([...new Set(mediaIds)]) : [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  const fields: SettingFieldView[] = definitions.map((definition) => {
    const raw = stored[definition.key] ?? "";
    const asset = isMediaSettingKey(definition.key) ? assetById.get(raw) : undefined;

    return {
      key: definition.key,
      type: definition.type,
      label: definition.label,
      helpText: definition.helpText,
      isPublic: definition.isPublic,
      // A secret's editable value is always empty: blank means "unchanged".
      value: definition.type === "secret" ? "" : raw,
      secret: definition.type === "secret" ? maskSecret(raw) : null,
      media: asset
        ? { id: asset.id, url: asset.url, alt: asset.alt, filename: asset.filename }
        : null,
      updatedAt: updatedAt.get(definition.key) ?? null,
    };
  });

  return {
    group,
    label: SETTING_GROUPS[group].label,
    description: SETTING_GROUPS[group].description,
    fields,
  };
}

/** Plain values for the few keys a page wants to show outside the form. */
export async function getSettingValues(
  keys: readonly string[],
): Promise<Record<string, string>> {
  return readStoredValues(keys);
}

/**
 * Every provider row, masked, plus the webhook URL it must be pointed at.
 * `APP_ORIGIN` rather than a request header: a spoofed Host must never be able
 * to make the screen print somebody else's webhook URL (D8).
 */
export async function listProviderViews(): Promise<PaymentProviderView[]> {
  const configs = await listMaskedProviderConfigs();
  return configs
    .map((config) => ({
      provider: config.provider,
      displayName: config.displayName,
      isEnabled: config.isEnabled,
      mode: config.mode,
      position: config.position,
      supportedMethods: config.supportedMethods,
      settings: config.settings,
      credentials: config.credentialKeys.map((key) => ({
        key,
        isSet: config.credentials[key]?.isSet ?? false,
        last4: config.credentials[key]?.last4 ?? null,
      })),
      implemented: config.implemented,
      webhookUrl: providerWebhookUrl(env.APP_ORIGIN, config.provider),
    }))
    .sort((a, b) => a.position - b.position || a.provider.localeCompare(b.provider));
}

export type SecuritySummary = {
  sessionHours: number;
  idleMinutes: number;
  require2faForSuperAdmin: boolean;
  activeSessions: number;
  adminsWithTwoFactor: number;
  activeAdmins: number;
  superAdmins: number;
  failedLogins24h: number;
};

/**
 * The read-only half of the Security tab: what the login policy currently is
 * and what it is doing. The numbers are the reason the tab exists - "require
 * 2FA for super-admins" is a different decision when two of three of them have
 * it switched off.
 */
export async function getSecuritySummary(): Promise<SecuritySummary> {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const values = await readStoredValues([
    "security.session_hours",
    "security.idle_minutes",
    "security.require_2fa_for_super_admin",
  ]);

  const [activeSessions, adminsWithTwoFactor, activeAdmins, superAdmins, failedLogins24h] =
    await Promise.all([
      db.adminSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      db.user.count({ where: { deletedAt: null, isActive: true, twoFactorEnabled: true } }),
      db.user.count({ where: { deletedAt: null, isActive: true } }),
      db.user.count({
        where: { deletedAt: null, isActive: true, role: { slug: "super-admin" } },
      }),
      db.loginAttempt.count({ where: { success: false, createdAt: { gte: since } } }),
    ]);

  return {
    sessionHours: Number(values["security.session_hours"]) || 12,
    idleMinutes: Number(values["security.idle_minutes"]) || 60,
    require2faForSuperAdmin: values["security.require_2fa_for_super_admin"] === "true",
    activeSessions,
    adminsWithTwoFactor,
    activeAdmins,
    superAdmins,
    failedLogins24h,
  };
}
