import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import bcrypt from "bcryptjs";

import { getEncryptionKey } from "@/lib/env";

/**
 * Cryptographic primitives for the panel (blueprint §14.D1, D2, D4, E6).
 *
 * Everything here is deliberately boring: Node's own AES-GCM, HKDF and HMAC,
 * with the small amount of glue (formats, purposes, TOTP arithmetic) kept in
 * one audited file so no feature module rolls its own.
 *
 * No Next imports - the seed and worker use this directly.
 */

// ---------------------------------------------------------------------------
// Purposes and key derivation
// ---------------------------------------------------------------------------

/**
 * Each purpose gets its own HKDF-derived subkey. If one purpose's ciphertexts
 * leak alongside a bug that lets an attacker request decryption of arbitrary
 * blobs (say, via a bank-account reveal endpoint), they still cannot use that
 * path to decrypt TOTP seeds or SMTP passwords.
 */
export const CRYPTO_PURPOSES = ["2fa", "bank", "payments", "smtp", "preview"] as const;
export type CryptoPurpose = (typeof CRYPTO_PURPOSES)[number];

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const FORMAT_VERSION = "v1";

const derivedKeyCache = new Map<string, Buffer>();

function deriveKey(purpose: CryptoPurpose, use: "encrypt" | "hmac"): Buffer {
  const cacheKey = `${use}:${purpose}`;
  const cached = derivedKeyCache.get(cacheKey);
  if (cached) return cached;

  const master = getEncryptionKey();
  const derived = Buffer.from(
    hkdfSync("sha256", master, Buffer.alloc(0), `diybaazar:${use}:${purpose}`, KEY_LENGTH),
  );
  derivedKeyCache.set(cacheKey, derived);
  return derived;
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

export function toBase64Url(input: Buffer | Uint8Array): string {
  return Buffer.from(input).toString("base64url");
}

export function fromBase64Url(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

// ---------------------------------------------------------------------------
// Symmetric encryption (D4)
// ---------------------------------------------------------------------------

/**
 * AES-256-GCM with a fresh random 12-byte IV per call. Output format is
 * `v1:<iv>:<tag>:<data>` in base64url so a future algorithm change can be
 * introduced by version prefix without re-encrypting everything at once.
 */
export function encrypt(plaintext: string, purpose: CryptoPurpose): string {
  const key = deriveKey(purpose, "encrypt");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_VERSION, toBase64Url(iv), toBase64Url(tag), toBase64Url(data)].join(":");
}

/**
 * Inverse of encrypt(). Throws on tampering or a purpose mismatch - the GCM
 * tag fails either way, which is the property we want: a `bank` blob cannot
 * be decrypted through a `2fa` code path.
 *
 * Call this only from service.ts files (D4); route and action layers receive
 * `{ isSet, last4 }` instead.
 */
export function decrypt(ciphertext: string, purpose: CryptoPurpose): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error("Unsupported ciphertext format.");
  }
  const [, ivPart, tagPart, dataPart] = parts;
  const iv = fromBase64Url(ivPart);
  const tag = fromBase64Url(tagPart);
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    throw new Error("Malformed ciphertext.");
  }

  const key = deriveKey(purpose, "encrypt");
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(fromBase64Url(dataPart)), decipher.final()]);
  return plaintext.toString("utf8");
}

/** True when the value looks like one of our ciphertexts (for migrations/UI). */
export function isEncrypted(value: string | null | undefined): boolean {
  return (
    typeof value === "string" &&
    value.startsWith(`${FORMAT_VERSION}:`) &&
    value.split(":").length === 4
  );
}

// ---------------------------------------------------------------------------
// Tokens and hashing (D1, D10)
// ---------------------------------------------------------------------------

/** Opaque, URL-safe random token. 32 bytes = 256 bits by default. */
export function randomToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes));
}

/**
 * SHA-256 hex of a high-entropy token. Tokens we generate are random, so a
 * plain hash (no salt, no bcrypt) is the right storage form: it is fast to
 * look up by equality and useless to an attacker who steals the column.
 * Never use this for passwords or short user-chosen codes.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Length-independent comparison. Different lengths still take the same time
 * as an equal-length mismatch because we hash both sides first.
 */
export function constantTimeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

// ---------------------------------------------------------------------------
// HMAC (E6 preview tokens, D5-style signatures)
// ---------------------------------------------------------------------------

export function hmacSign(purpose: CryptoPurpose, message: string): string {
  return createHmac("sha256", deriveKey(purpose, "hmac"))
    .update(message, "utf8")
    .digest("base64url");
}

export function hmacVerify(purpose: CryptoPurpose, message: string, signature: string): boolean {
  if (typeof signature !== "string" || signature.length === 0) return false;
  return constantTimeEqual(hmacSign(purpose, message), signature);
}

// ---------------------------------------------------------------------------
// TOTP (D2, RFC 6238 / RFC 4226)
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer | Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[=\s-]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 20 random bytes (160 bits), the size authenticator apps expect for SHA-1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** otpauth:// URI for the enrolment QR code. */
export function totpUri({
  issuer,
  account,
  secret,
  digits = 6,
  step = 30,
}: {
  issuer: string;
  account: string;
  secret: string;
  digits?: number;
  step?: number;
}): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(digits),
    period: String(step),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** HOTP value for one counter (RFC 4226 §5.3). */
export function hotp(secretBase32: string, counter: number, digits = 6): string {
  const key = base32Decode(secretBase32);
  const message = Buffer.alloc(8);
  // Counter is a 64-bit big-endian integer; JS numbers are exact to 2^53,
  // far beyond any time step we will see.
  message.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpCounter(nowMs: number, step = 30): number {
  return Math.floor(nowMs / 1000 / step);
}

/**
 * Verify a code within ±window steps of now. Returns the matching counter so
 * the caller can persist it as `User.lastTotpStep` and refuse a replay of the
 * same code inside the window (D2).
 */
export function verifyTotp({
  secret,
  code,
  window = 1,
  step = 30,
  digits = 6,
  now = Date.now(),
  lastCounter = null,
}: {
  secret: string;
  code: string;
  window?: number;
  step?: number;
  digits?: number;
  now?: number;
  /** Previously accepted counter; anything at or before it is rejected. */
  lastCounter?: number | null;
}): { ok: boolean; counter: number | null } {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d+$/.test(normalized) || normalized.length !== digits) {
    return { ok: false, counter: null };
  }
  const current = totpCounter(now, step);
  for (let offset = -window; offset <= window; offset += 1) {
    const counter = current + offset;
    if (lastCounter !== null && counter <= lastCounter) continue;
    if (constantTimeEqual(hotp(secret, counter, digits), normalized)) {
      return { ok: true, counter };
    }
  }
  return { ok: false, counter: null };
}

// ---------------------------------------------------------------------------
// Recovery codes (D2)
// ---------------------------------------------------------------------------

const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no i/l/o/0/1

/**
 * Human-typeable single-use codes, "xxxxx-xxxxx". Stored only as bcrypt
 * hashes because, unlike our random tokens, a user may write these down and
 * they are short enough to brute-force from a leaked SHA-256 column.
 */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    let raw = "";
    for (let j = 0; j < 10; j += 1) {
      raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    }
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function hashRecoveryCode(code: string): Promise<string> {
  return bcrypt.hash(normalizeRecoveryCode(code), 10);
}

export async function hashRecoveryCodes(codes: readonly string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => hashRecoveryCode(code)));
}

/**
 * Returns the index of the matching hash or -1, so the caller can remove
 * exactly that entry from `User.recoveryCodesHash`.
 */
export async function findRecoveryCode(
  code: string,
  hashes: readonly string[],
): Promise<number> {
  const normalized = normalizeRecoveryCode(code);
  for (let i = 0; i < hashes.length; i += 1) {
    if (await bcrypt.compare(normalized, hashes[i])) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** "••••1234" style display of a secret without revealing it (D4). */
export function last4(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, "");
  return compact.length <= 4 ? compact : compact.slice(-4);
}
