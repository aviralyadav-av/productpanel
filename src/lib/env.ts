import { createHash } from "node:crypto";

/**
 * Typed access to process.env (blueprint §14.D4, D7, D8, D9).
 *
 * Every other module reads configuration through here so that a missing or
 * malformed variable fails in ONE place with a sentence naming the variable,
 * instead of surfacing as an undefined-property crash three calls deep at
 * request time. Values are read lazily (getters, not module constants) so
 * the seed and worker - which load dotenv after import - see the same values
 * as the Next server.
 *
 * No Next imports: the worker and seed import this as plain tsx processes.
 */

export const isProduction = process.env.NODE_ENV === "production";

function read(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireInProduction(name: string, fallback: string): string {
  const value = read(name);
  if (value) return value;
  if (isProduction) {
    throw new Error(`${name} must be set in production.`);
  }
  return fallback;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = read(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}".`);
  }
  return parsed;
}

function parseCsv(name: string): string[] {
  const raw = read(name);
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Normalise an origin so "https://shop.example.com/" and
 * "https://shop.example.com" compare equal. Anything unparseable is dropped
 * rather than silently allowed through a CORS allowlist.
 */
export function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ENCRYPTION_KEY (D4)
// ---------------------------------------------------------------------------

let encryptionKeyCache: Buffer | null = null;
let warnedDerivedKey = false;

/**
 * The 32-byte master key behind every encrypt()/decrypt() call.
 *
 * Production: must be present, must decode to exactly 32 bytes, and must not
 * simply reuse AUTH_SECRET - a leaked session-signing key would otherwise also
 * unlock every stored bank account and TOTP seed.
 *
 * Development: derived from AUTH_SECRET so a fresh checkout works without
 * ceremony, with a one-time warning so nobody ships that by accident.
 */
export function getEncryptionKey(): Buffer {
  if (encryptionKeyCache) return encryptionKeyCache;

  const raw = read("ENCRYPTION_KEY");
  const authSecret = read("AUTH_SECRET");
  const looksLikePlaceholder = raw?.startsWith("generate-with:") ?? false;

  if (raw && !looksLikePlaceholder) {
    if (isProduction && authSecret && raw === authSecret) {
      throw new Error("ENCRYPTION_KEY must not equal AUTH_SECRET.");
    }
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length !== 32) {
      throw new Error(
        "ENCRYPTION_KEY must be 32 random bytes encoded as base64 (openssl rand -base64 32).",
      );
    }
    encryptionKeyCache = decoded;
    return decoded;
  }

  if (isProduction) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`.",
    );
  }

  if (!authSecret) {
    throw new Error(
      "Neither ENCRYPTION_KEY nor AUTH_SECRET is set; cannot derive a development encryption key.",
    );
  }

  if (!warnedDerivedKey) {
    warnedDerivedKey = true;
    console.warn(
      "[env] ENCRYPTION_KEY is not set - deriving a development key from AUTH_SECRET. Set ENCRYPTION_KEY before deploying.",
    );
  }

  encryptionKeyCache = createHash("sha256")
    .update(`diybaazar-dev-encryption-key:${authSecret}`)
    .digest();
  return encryptionKeyCache;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type StorageDriver = "local" | "s3";

export const env = {
  get isProduction(): boolean {
    return isProduction;
  },

  /** Where THIS app is served; CSRF origin checks and reset links (D8, D10). */
  get APP_ORIGIN(): string {
    const value = requireInProduction("APP_ORIGIN", "http://localhost:3000");
    const origin = normalizeOrigin(value);
    if (!origin) throw new Error(`APP_ORIGIN is not a valid URL: "${value}".`);
    return origin;
  },

  /** Hostname of APP_ORIGIN, for next.config serverActions.allowedOrigins. */
  get APP_HOST(): string {
    return new URL(env.APP_ORIGIN).host;
  },

  get ENCRYPTION_KEY(): Buffer {
    return getEncryptionKey();
  },

  /** Header value for POST /api/internal/jobs/run; undefined → 503 there. */
  get CRON_SECRET(): string | undefined {
    const value = read("CRON_SECRET");
    return value && !value.startsWith("generate-with:") ? value : undefined;
  },

  /** Shared secret the storefront sends as X-Storefront-Key (E7). */
  get STOREFRONT_API_KEY(): string | undefined {
    const value = read("STOREFRONT_API_KEY");
    return value && !value.startsWith("generate-with:") ? value : undefined;
  },

  /** Normalised CORS allowlist (D7). Invalid entries are dropped. */
  get STOREFRONT_ORIGINS(): string[] {
    const seen = new Set<string>();
    for (const entry of parseCsv("STOREFRONT_ORIGINS")) {
      const origin = normalizeOrigin(entry);
      if (origin) seen.add(origin);
    }
    return [...seen];
  },

  get STORAGE_DRIVER(): StorageDriver {
    const value = read("STORAGE_DRIVER") ?? "local";
    if (value !== "local" && value !== "s3") {
      throw new Error(`STORAGE_DRIVER must be "local" or "s3", got "${value}".`);
    }
    return value;
  },

  /** Root of the local driver; {public,private} live beneath it (D6). */
  get STORAGE_LOCAL_DIR(): string {
    return read("STORAGE_LOCAL_DIR") ?? "storage";
  },

  get S3_ENDPOINT(): string | undefined {
    return read("S3_ENDPOINT");
  },
  get S3_REGION(): string | undefined {
    return read("S3_REGION");
  },
  get S3_BUCKET(): string | undefined {
    return read("S3_BUCKET");
  },
  get S3_ACCESS_KEY_ID(): string | undefined {
    return read("S3_ACCESS_KEY_ID");
  },
  get S3_SECRET_ACCESS_KEY(): string | undefined {
    return read("S3_SECRET_ACCESS_KEY");
  },
  /** Public base URL for S3 objects (CDN or bucket website endpoint). */
  get S3_PUBLIC_URL(): string | undefined {
    const value = read("S3_PUBLIC_URL");
    return value ? value.replace(/\/+$/, "") : undefined;
  },

  /** Reverse proxies between the client and this process (D9). */
  get TRUSTED_PROXY_HOPS(): number {
    return parseIntEnv("TRUSTED_PROXY_HOPS", 0);
  },
} as const;

/**
 * Origins whose images the sanitiser and image allowlists accept: our own
 * app, the S3/CDN host, and the storefront(s). Relative paths are always ok.
 */
export function mediaOrigins(): string[] {
  const origins = new Set<string>([env.APP_ORIGIN, ...env.STOREFRONT_ORIGINS]);
  const s3 = env.S3_PUBLIC_URL ? normalizeOrigin(env.S3_PUBLIC_URL) : null;
  if (s3) origins.add(s3);
  return [...origins];
}
