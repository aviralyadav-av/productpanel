import { randomBytes } from "node:crypto";

import { env } from "@/lib/env";
import { LocalDiskAdapter } from "@/lib/storage/local";
import type { StorageAdapter } from "@/lib/storage/types";

export type {
  PutObjectInput,
  PutObjectResult,
  StorageAdapter,
  StorageStat,
  StorageVisibility,
} from "@/lib/storage/types";
export { IMMUTABLE_CACHE_CONTROL, assertSafeStorageKey, isSafeStorageKey } from "@/lib/storage/types";
export {
  ALLOWED_MIME_TYPES,
  extensionForMime,
  extensionOf,
  isAllowedMime,
  kindForMime,
  mimeFromExtension,
  sniffMime,
  type MediaKind,
} from "@/lib/storage/mime";

/**
 * Storage entry point (blueprint §10). `getStorage()` picks the adapter from
 * STORAGE_DRIVER once per process; the S3 client is loaded lazily so the
 * local driver never pulls the AWS SDK into memory.
 */

let instance: StorageAdapter | null = null;
let pending: Promise<StorageAdapter> | null = null;

export async function getStorage(): Promise<StorageAdapter> {
  if (instance) return instance;
  if (!pending) {
    pending = (async () => {
      if (env.STORAGE_DRIVER === "s3") {
        const { S3Adapter } = await import("@/lib/storage/s3");
        instance = new S3Adapter();
      } else {
        instance = new LocalDiskAdapter();
      }
      return instance;
    })();
  }
  return pending;
}

/** For tests and the seed: swap the adapter without touching env. */
export function setStorageForTesting(adapter: StorageAdapter | null): void {
  instance = adapter;
  pending = null;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Lowercase, URL-safe, no vowels that could spell something regrettable. */
const KEY_ALPHABET = "0123456789bcdfghjkmnpqrstvwxz";
const KEY_RANDOM_LENGTH = 20;

function randomKeyPart(): string {
  const bytes = randomBytes(KEY_RANDOM_LENGTH);
  let out = "";
  for (let i = 0; i < KEY_RANDOM_LENGTH; i += 1) out += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return out;
}

function sanitizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 64);
}

/**
 * `folder/yyyy/mm/<random>.<ext>`. The client's filename never enters the key:
 * it is stored on MediaAsset.filename for display only. The date prefix keeps
 * directories small on disk and makes lifecycle rules trivial on S3.
 */
export function buildStorageKey({
  folder,
  ext,
  now = new Date(),
}: {
  folder?: string | null;
  ext: string;
  now?: Date;
}): string {
  const cleanExt = sanitizeSegment(ext.replace(/^\./, ""));
  if (!cleanExt || cleanExt.includes(".")) {
    throw new Error(`Invalid file extension "${ext}".`);
  }
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const folderSegments = (folder ?? "")
    .split("/")
    .map(sanitizeSegment)
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");

  return [...folderSegments, year, month, `${randomKeyPart()}.${cleanExt}`].join("/");
}
