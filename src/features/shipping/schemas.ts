import { z } from "zod";

import { SHIPPING_METHODS, shippingMethodSchema } from "@/lib/enums";
import { many, one, type SearchParams } from "@/lib/list-params";
import {
  emailSchema,
  optionalTextSchema,
  optionalUrlSchema,
  paiseSchema,
  phoneSchema,
  pincodeSchema,
  textSchema,
} from "@/lib/validation";

import { INDIAN_STATE_CODES } from "@/features/shipping/india";
import { trackingTemplateProblem } from "@/features/shipping/tracking";

/**
 * Every write into the shipping module (blueprint §4.6, §14.F) and the
 * vocabulary of the pincode list URL. Ids are opaque strings rather than
 * cuids because the seed addresses rows by readable ids.
 */

export { SHIPPING_METHODS, shippingMethodSchema };

export const SHIPPING_TABS = ["zones", "rates", "pincodes", "partners"] as const;
export type ShippingTab = (typeof SHIPPING_TABS)[number];

export function resolveShippingTab(raw: string | undefined): ShippingTab {
  return (SHIPPING_TABS as readonly string[]).includes(raw ?? "") ? (raw as ShippingTab) : "zones";
}

export const shippingIdSchema = z
  .string()
  .trim()
  .min(1, "Missing id.")
  .max(64, "Invalid id.")
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid id.");

/** "" / undefined → null so optional relations stay NULL not "". */
const nullableIdSchema = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  shippingIdSchema.nullable(),
);

/** "" → null for optional numeric columns typed through MoneyInput / steppers. */
const nullableInt = (max: number, label: string) =>
  z.preprocess(
    (value) => (value === "" || value === undefined || Number.isNaN(value) ? null : value),
    z.number().int(`${label} must be a whole number.`).min(0, `${label} cannot be negative.`).max(max, `${label} is too large.`).nullable(),
  );

const nullablePaise = z.preprocess(
  (value) => (value === "" || value === undefined || Number.isNaN(value) ? null : value),
  paiseSchema.nullable(),
);

const positionSchema = z.number().int().min(0).max(100_000).default(0);

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

export const PINCODE_PREFIX_PATTERN = /^\d{2,4}$/;

export const zoneInputSchema = z.object({
  name: textSchema(80, "Zone name"),
  description: optionalTextSchema(300),
  countries: z
    .array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use two-letter country codes."))
    .max(20)
    .default(["IN"])
    .transform((codes) => (codes.length === 0 ? ["IN"] : [...new Set(codes)])),
  states: z
    .array(z.string().trim().toUpperCase())
    .max(40)
    .default([])
    .refine((codes) => codes.every((code) => INDIAN_STATE_CODES.includes(code)), "Unknown state code.")
    .transform((codes) => [...new Set(codes)]),
  pincodePrefixes: z
    .array(z.string().trim().regex(PINCODE_PREFIX_PATTERN, "Prefixes are 2 to 4 digits."))
    .max(200, "At most 200 prefixes per zone.")
    .default([])
    .transform((prefixes) => [...new Set(prefixes)]),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  position: positionSchema,
});
export type ZoneInput = z.input<typeof zoneInputSchema>;
export type ZoneData = z.output<typeof zoneInputSchema>;

export const reorderSchema = z.object({
  ids: z.array(shippingIdSchema).min(1).max(500),
});

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

export const MAX_ESTIMATE_DAYS = 60;

export const rateInputSchema = z
  .object({
    zoneId: shippingIdSchema,
    name: textSchema(80, "Rate name"),
    method: shippingMethodSchema.default("STANDARD"),
    ratePaise: paiseSchema,
    freeAbovePaise: nullablePaise,
    minWeightGrams: nullableInt(1_000_000, "Minimum weight"),
    maxWeightGrams: nullableInt(1_000_000, "Maximum weight"),
    minOrderPaise: nullablePaise,
    maxOrderPaise: nullablePaise,
    codAvailable: z.boolean().default(true),
    codFeePaise: paiseSchema.default(0),
    estimatedDaysMin: z.number().int().min(0).max(MAX_ESTIMATE_DAYS),
    estimatedDaysMax: z.number().int().min(0).max(MAX_ESTIMATE_DAYS),
    isActive: z.boolean().default(true),
    position: positionSchema,
  })
  .superRefine((value, ctx) => {
    if (value.minWeightGrams !== null && value.maxWeightGrams !== null && value.minWeightGrams > value.maxWeightGrams) {
      ctx.addIssue({ code: "custom", path: ["maxWeightGrams"], message: "Maximum weight must be at least the minimum." });
    }
    if (value.minOrderPaise !== null && value.maxOrderPaise !== null && value.minOrderPaise > value.maxOrderPaise) {
      ctx.addIssue({ code: "custom", path: ["maxOrderPaise"], message: "Maximum order value must be at least the minimum." });
    }
    if (value.estimatedDaysMin > value.estimatedDaysMax) {
      ctx.addIssue({ code: "custom", path: ["estimatedDaysMax"], message: "Latest estimate must be at least the earliest." });
    }
  });
export type RateInput = z.input<typeof rateInputSchema>;
export type RateData = z.output<typeof rateInputSchema>;

// ---------------------------------------------------------------------------
// Partners
// ---------------------------------------------------------------------------

/** Slug-like, stored upper-case to match the seeded DELHIVERY / BLUEDART codes. */
export const partnerCodeSchema = z
  .string()
  .trim()
  .min(2, "Code needs at least 2 characters.")
  .max(32, "Code is too long.")
  .regex(/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/, "Use letters, numbers and single hyphens or underscores.")
  .transform((value) => value.toUpperCase());

const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  emailSchema.nullable(),
);
const optionalPhone = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  phoneSchema.nullable(),
);

export const partnerInputSchema = z.object({
  code: partnerCodeSchema,
  name: textSchema(80, "Partner name"),
  trackingUrlTemplate: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z
      .string()
      .trim()
      .max(2048, "Template is too long.")
      .nullable()
      .superRefine((value, ctx) => {
        const problem = trackingTemplateProblem(value);
        if (problem) ctx.addIssue({ code: "custom", message: problem });
      }),
  ),
  phone: optionalPhone,
  email: optionalEmail,
  website: optionalUrlSchema,
  isActive: z.boolean().default(true),
  position: positionSchema,
});
export type PartnerInput = z.input<typeof partnerInputSchema>;
export type PartnerData = z.output<typeof partnerInputSchema>;

// ---------------------------------------------------------------------------
// Pincodes
// ---------------------------------------------------------------------------

export const pincodeInputSchema = z.object({
  pincode: pincodeSchema,
  city: optionalTextSchema(120),
  state: optionalTextSchema(120),
  zoneId: nullableIdSchema,
  isServiceable: z.boolean().default(true),
  codAvailable: z.boolean().default(true),
  estimatedDays: nullableInt(MAX_ESTIMATE_DAYS, "Estimated days"),
});
export type PincodeInput = z.input<typeof pincodeInputSchema>;
export type PincodeData = z.output<typeof pincodeInputSchema>;

/** PUT /pincodes/:pin - everything but the key. */
export const pincodeUpdateSchema = pincodeInputSchema.omit({ pincode: true }).partial();
export type PincodeUpdate = z.output<typeof pincodeUpdateSchema>;

export const PINCODE_BULK_ACTIONS = ["serviceable_on", "serviceable_off", "cod_on", "cod_off", "assign_zone"] as const;
export type PincodeBulkAction = (typeof PINCODE_BULK_ACTIONS)[number];

/** §11.33: bulk actions capped at 500 ids, one transaction, summary result. */
export const MAX_BULK_PINCODES = 500;

export const pincodeBulkSchema = z
  .object({
    pincodes: z.array(pincodeSchema).min(1, "Select at least one pincode.").max(MAX_BULK_PINCODES, `At most ${MAX_BULK_PINCODES} pincodes per bulk action.`),
    action: z.enum(PINCODE_BULK_ACTIONS),
    zoneId: nullableIdSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "assign_zone" && value.zoneId === undefined) {
      ctx.addIssue({ code: "custom", path: ["zoneId"], message: "Pick a zone (or none) to assign." });
    }
  });
export type PincodeBulkInput = z.input<typeof pincodeBulkSchema>;
export type PincodeBulkData = z.output<typeof pincodeBulkSchema>;

/** 50k rows × ~40 bytes leaves room; anything larger is refused before parsing. */
export const MAX_IMPORT_CSV_BYTES = 6 * 1024 * 1024;

export const pincodeImportSchema = z.object({
  csv: z.string().min(1, "Attach a CSV file.").max(MAX_IMPORT_CSV_BYTES, "The file is larger than 6 MB."),
});

export const PINCODE_SORTS = ["pincode", "city", "state", "updatedAt"] as const;
export type PincodeSort = (typeof PINCODE_SORTS)[number];

export type PincodeListFilters = {
  /** Prefix search on the pincode, or a city/state contains-match when not numeric. */
  q?: string;
  /** Zone id, or "none" for unassigned. */
  zoneId?: string;
  serviceable?: boolean;
  cod?: boolean;
};

function boolParam(value: string | undefined): boolean | undefined {
  if (value === "yes" || value === "true" || value === "1") return true;
  if (value === "no" || value === "false" || value === "0") return false;
  return undefined;
}

/** Same vocabulary for the page (`SearchParams`) and the REST list route (`URLSearchParams`). */
export function parsePincodeListFilters(params: SearchParams | URLSearchParams): PincodeListFilters {
  const get = (key: string) =>
    params instanceof URLSearchParams ? (params.get(key) ?? undefined) : one(params, key);
  const q = get("q")?.trim();
  const zone = get("zone")?.trim();
  return {
    q: q || undefined,
    zoneId: zone && shippingIdSchema.safeParse(zone).success ? zone : zone === "none" ? "none" : undefined,
    serviceable: boolParam(get("serviceable")),
    cod: boolParam(get("cod")),
  };
}

/** Rates tab filter. */
export function parseRateZoneFilter(params: SearchParams): string | undefined {
  const zone = one(params, "zone");
  return zone && shippingIdSchema.safeParse(zone).success ? zone : undefined;
}

export function selectedPincodes(params: SearchParams): string[] {
  return many(params, "pin");
}

// ---------------------------------------------------------------------------
// Quotes (admin preview and public endpoint share the request shape)
// ---------------------------------------------------------------------------

export const QUOTE_PAYMENT_METHODS = ["COD", "ONLINE", "MANUAL"] as const;

export const quoteItemSchema = z
  .object({
    productId: shippingIdSchema.optional(),
    variantId: shippingIdSchema.optional(),
    quantity: z.number().int().min(1, "Quantity must be at least 1.").max(1000, "Quantity is too large."),
  })
  .refine((item) => item.productId || item.variantId, "Each item needs a productId or a variantId.");

export const quoteRequestSchema = z.object({
  pinCode: pincodeSchema,
  state: z.string().trim().max(120).optional(),
  items: z.array(quoteItemSchema).min(1, "Add at least one item.").max(100, "At most 100 items per quote."),
  paymentMethod: z.enum(QUOTE_PAYMENT_METHODS).default("ONLINE"),
  /** Admin preview may override the priced subtotal (e.g. after a coupon). */
  discountedSubtotalPaise: paiseSchema.optional(),
});
export type QuoteRequest = z.output<typeof quoteRequestSchema>;
