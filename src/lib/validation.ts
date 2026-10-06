import { z } from "zod";

/**
 * Shared Zod primitives (blueprint §14.D12 `safeUrlSchema`, §14.F).
 *
 * Every feature's schemas.ts composes these instead of re-declaring a regex,
 * so "what counts as a valid pincode" is decided exactly once. Feature
 * schemas may still add context-specific messages via `.describe()` or by
 * wrapping with `.refine`.
 *
 * No Next imports - the seed and worker validate with these too.
 */

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/** Control characters and whitespace have no place in a URL we store. */
function hasControlOrSpace(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Accepts a site-relative path ("/products/bags") or an absolute http(s) URL.
 * Rejects protocol-relative ("//evil"), `javascript:`, `data:` and anything
 * a browser might interpret as a scheme we did not intend.
 */
export function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return false;
  if (hasControlOrSpace(trimmed)) return false;
  if (trimmed.startsWith("/")) return !trimmed.startsWith("//");
  if (trimmed.startsWith("#")) return true;
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const safeUrlSchema = z
  .string()
  .trim()
  .max(2048, "URL is too long.")
  .refine(isSafeUrl, "Enter a valid http(s) URL or a path starting with /.");

/** Same, but "" / null become null - for optional URL columns. */
export const optionalUrlSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  safeUrlSchema.nullable(),
);

/** Absolute http(s) only - for storefront base URL, CORS origins, webhooks. */
export const absoluteUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value) && isSafeUrl(value), "Enter a full http(s) URL.");

// ---------------------------------------------------------------------------
// Identifiers and text
// ---------------------------------------------------------------------------

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required.")
  .max(120, "Slug is too long.")
  .regex(SLUG_PATTERN, "Use lowercase letters, numbers and single hyphens.");

/** Turn any title into a slug candidate; validate with slugSchema after. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    // Strip combining marks left behind by NFKD ("é" → "e" + acute).
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** Prisma cuid() ids. Rejects obviously wrong input before it hits the DB. */
export const idSchema = z.string().trim().cuid("Invalid id.");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email is too long.")
  .pipe(z.email("Enter a valid email address."));

/**
 * Indian mobile numbers normalise to "+91XXXXXXXXXX" whether typed as
 * "98765 43210", "098765-43210" or "+91 98765 43210". Other countries pass as
 * E.164 ("+" and 8-15 digits). Landlines with STD codes are accepted as
 * digits only when they carry a leading 0 and 10-11 digits.
 */
export function normalizePhone(value: string): string | null {
  const compact = value.replace(/[\s\-().]/g, "");
  const indian = compact.match(/^(?:\+?91|0)?([6-9]\d{9})$/);
  if (indian) return `+91${indian[1]}`;
  if (/^\+\d{8,15}$/.test(compact)) return compact;
  if (/^0\d{9,10}$/.test(compact)) return compact;
  return null;
}

export const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "Enter a valid phone number." });
      return z.NEVER;
    }
    return normalized;
  });

/** Indian PIN codes: six digits, first digit 1-9. */
export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{5}$/, "Enter a 6-digit PIN code.");

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Enter a colour like #1a2b3c.")
  .transform((value) => value.toLowerCase());

// ---------------------------------------------------------------------------
// Money and rates (§14.B: Int paise, Int bps)
// ---------------------------------------------------------------------------

/** Whole paise, never negative, within a Postgres Int4 column. */
export const paiseSchema = z
  .number({ error: "Enter an amount." })
  .int("Amounts are whole paise.")
  .min(0, "Amount cannot be negative.")
  .max(2_147_483_647, "Amount is too large.");

/** Basis points: 0..10000 (0% .. 100%). */
export const bpsSchema = z
  .number({ error: "Enter a rate." })
  .int("Rates are whole basis points.")
  .min(0, "Rate cannot be negative.")
  .max(10_000, "Rate cannot exceed 100%.");

/** Non-negative integer quantity, capped to something a warehouse could hold. */
export const quantitySchema = z.number().int().min(0).max(1_000_000);

/** `?page=2` style numeric strings from forms and query strings. */
export const intFromStringSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
  z.number().int(),
);

/** Checkbox / query booleans: "true" | "1" | "on" → true. */
export const boolFromStringSchema = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "on", "yes"].includes(value.toLowerCase());
  return value;
}, z.boolean());

/** Trimmed, required, bounded text - the default for every name/title column. */
export function textSchema(max: number, label = "This field") {
  return z.string().trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);
}

/** Trimmed optional text; "" becomes null so columns stay NULL not "". */
export function optionalTextSchema(max: number) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable(),
  );
}
