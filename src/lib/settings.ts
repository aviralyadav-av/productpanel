import { db } from "@/lib/db";
import {
  SETTING_DEFINITIONS,
  settingDefinition,
  type SettingDefinition,
} from "@/lib/settings-keys";

/**
 * Typed reads of the Setting table with a small in-memory cache.
 *
 * Settings are read on almost every request (tax mode, COD fee, store name) but
 * change a few times a year, so a 60 second TTL is the right trade: one query
 * per minute per process, and an edit propagates within a minute without any
 * invalidation plumbing. Services that must see their own write immediately
 * call `invalidateSettingsCache()` after saving.
 *
 * Values fall back to the seeded default when the row is missing, so a fresh
 * database and an old one behave identically.
 */
const TTL_MS = 60_000;

type CacheEntry = { value: string; cachedAt: number };
const cache = new Map<string, CacheEntry>();

export type SettingValue = string | number | boolean | unknown;

/** Parse a stored string by the definition's type. */
export function parseSettingValue(
  definition: SettingDefinition | undefined,
  raw: string,
): SettingValue {
  switch (definition?.type) {
    case "number":
    case "money": {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : Number(definition.defaultValue) || 0;
    }
    case "boolean":
      return raw === "true" || raw === "1";
    case "json":
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        try {
          return JSON.parse(definition.defaultValue) as unknown;
        } catch {
          return null;
        }
      }
    default:
      return raw;
  }
}

function fresh(entry: CacheEntry | undefined, now: number): entry is CacheEntry {
  return Boolean(entry && now - entry.cachedAt < TTL_MS);
}

async function loadRaw(keys: readonly string[]): Promise<Map<string, string>> {
  const now = Date.now();
  const result = new Map<string, string>();
  const missing: string[] = [];

  for (const key of keys) {
    const entry = cache.get(key);
    if (fresh(entry, now)) result.set(key, entry.value);
    else missing.push(key);
  }

  if (missing.length > 0) {
    const rows = await db.setting.findMany({
      where: { key: { in: missing } },
      select: { key: true, value: true },
    });
    const found = new Map(rows.map((row) => [row.key, row.value]));

    for (const key of missing) {
      const value = found.get(key) ?? settingDefinition(key)?.defaultValue ?? "";
      cache.set(key, { value, cachedAt: now });
      result.set(key, value);
    }
  }

  return result;
}

/** Raw string value (default when unset). */
export async function getSettingRaw(key: string): Promise<string> {
  const values = await loadRaw([key]);
  return values.get(key) ?? "";
}

/** Typed value: number for number/money, boolean, parsed JSON, else string. */
export async function getSetting<T extends SettingValue = SettingValue>(key: string): Promise<T> {
  const raw = await getSettingRaw(key);
  return parseSettingValue(settingDefinition(key), raw) as T;
}

export async function getSettingString(key: string): Promise<string> {
  return String(await getSetting(key) ?? "");
}

export async function getSettingNumber(key: string): Promise<number> {
  const value = await getSetting(key);
  return typeof value === "number" ? value : Number(value) || 0;
}

export async function getSettingBoolean(key: string): Promise<boolean> {
  const value = await getSetting(key);
  return value === true || value === "true";
}

/** Several typed values in one round trip. */
export async function getSettings(
  keys: readonly string[],
): Promise<Record<string, SettingValue>> {
  const raw = await loadRaw(keys);
  const output: Record<string, SettingValue> = {};
  for (const key of keys) {
    output[key] = parseSettingValue(settingDefinition(key), raw.get(key) ?? "");
  }
  return output;
}

/**
 * Everything flagged isPublic, typed, for /api/v1/settings. Secrets are
 * excluded regardless of the flag (D11).
 */
export async function getPublicSettings(): Promise<Record<string, SettingValue>> {
  const definitions = SETTING_DEFINITIONS.filter(
    (item) => item.isPublic && item.type !== "secret",
  );
  return getSettings(definitions.map((item) => item.key));
}

/** Drop cached values so the next read hits the database. */
export function invalidateSettingsCache(keys?: readonly string[]): void {
  if (!keys) {
    cache.clear();
    return;
  }
  for (const key of keys) cache.delete(key);
}
