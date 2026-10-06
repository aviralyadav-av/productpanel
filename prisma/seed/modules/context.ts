import type { PrismaClient } from "@prisma/client";

/**
 * Shared by every seed module. Modules are idempotent: they upsert on stable
 * keys (slug, code, key, email) and never overwrite values an admin may have
 * edited unless the field is structural (labels, groupings, system flags).
 */
export type SeedContext = {
  adminEmail: string;
  adminPassword: string;
  /** Fixed id of the SYSTEM actor used for audit attribution (D13). */
  systemUserId: string;
  /** Set by seedAccess; later modules attribute their writes to it. */
  adminUserId: string | null;
  /** Wave 2b demo data toggle (SEED_DEMO_DATA). Wave 1 seeds no demo rows. */
  demo: boolean;
  log: (message: string) => void;
};

export type SeedModule = (db: PrismaClient, ctx: SeedContext) => Promise<void>;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
