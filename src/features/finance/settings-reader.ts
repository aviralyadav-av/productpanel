import type { Prisma, PrismaClient } from "@prisma/client";

import { db } from "@/lib/db";
import { settingDefinition } from "@/lib/settings-keys";

/**
 * Setting reads for SERVICE code.
 *
 * `src/lib/settings.ts` is the cached reader the admin UI uses, but it is
 * marked `server-only`, and that marker throws the moment a plain `tsx`
 * process (the seed, the job worker) imports it. Services must run in both
 * worlds, so they read the Setting table through the transaction they are
 * already in - which also means a service sees a setting an admin changed a
 * second ago rather than a value cached up to a minute earlier. For money
 * (payout hold, minimum payout, charges) that immediacy is the correct trade.
 *
 * Parsing mirrors `parseSettingValue` in settings.ts; the definition's seeded
 * default fills in for a missing row so a fresh database behaves like an old
 * one.
 */

export type Db = Prisma.TransactionClient | PrismaClient;

async function readRaw(tx: Db, keys: readonly string[]): Promise<Map<string, string>> {
  const rows = await tx.setting.findMany({
    where: { key: { in: [...keys] } },
    select: { key: true, value: true },
  });
  const found = new Map(rows.map((row) => [row.key, row.value]));
  const result = new Map<string, string>();
  for (const key of keys) {
    result.set(key, found.get(key) ?? settingDefinition(key)?.defaultValue ?? "");
  }
  return result;
}

export async function readSettingString(tx: Db | undefined, key: string): Promise<string> {
  const raw = await readRaw(tx ?? db, [key]);
  return raw.get(key) ?? "";
}

export async function readSettingNumber(tx: Db | undefined, key: string): Promise<number> {
  const raw = await readSettingString(tx, key);
  const parsed = Number(raw);
  if (raw.trim() !== "" && Number.isFinite(parsed)) return parsed;
  return Number(settingDefinition(key)?.defaultValue) || 0;
}

export async function readSettingBoolean(tx: Db | undefined, key: string): Promise<boolean> {
  const raw = await readSettingString(tx, key);
  return raw === "true" || raw === "1";
}

export async function readSettingJson<T = unknown>(
  tx: Db | undefined,
  key: string,
  fallback: T,
): Promise<T> {
  const raw = await readSettingString(tx, key);
  try {
    return JSON.parse(raw) as T;
  } catch {
    try {
      return JSON.parse(settingDefinition(key)?.defaultValue ?? "") as T;
    } catch {
      return fallback;
    }
  }
}

/** Several string values in one round trip. */
export async function readSettingStrings(
  tx: Db | undefined,
  keys: readonly string[],
): Promise<Record<string, string>> {
  const raw = await readRaw(tx ?? db, keys);
  return Object.fromEntries(keys.map((key) => [key, raw.get(key) ?? ""]));
}
