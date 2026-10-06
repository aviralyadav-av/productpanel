import { z } from "zod";

import {
  COUPON_APPLIES_TO,
  COUPON_STATUSES,
  COUPON_TYPES,
  DISCOUNT_FUNDERS,
  couponAppliesToSchema,
  couponTypeSchema,
  discountFunderSchema,
  type CouponAppliesTo,
  type CouponStatus,
  type CouponType,
  type DiscountFunder,
} from "@/lib/enums";
import type { SearchParams } from "@/lib/list-params";
import { one } from "@/lib/list-params";
import { optionalTextSchema, paiseSchema, textSchema } from "@/lib/validation";
import type { EntityRef } from "@/components/shared/entity-picker";

import { DATE_INPUT_PATTERN, istEndOfDay, istStartOfDay } from "./dates";

/**
 * The coupons contract: URL state, Server Action / REST inputs and the plain
 * shapes the queries hand to the UI. Client-safe - no Prisma, no server-only.
 *
 * Money arrives as PAISE (MoneyInput already converts) and percentages as
 * whole percent points, because that is what `Coupon.value` stores and what
 * `applyCoupon` in finance/math.ts multiplies by 100 to get basis points.
 */

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

export const COUPON_SORTS = ["code", "type", "value", "usage", "startsAt", "endsAt", "updatedAt"] as const;
export type CouponSort = (typeof COUPON_SORTS)[number];

export function resolveCouponSort(raw: string | undefined): CouponSort {
  return (COUPON_SORTS as readonly string[]).includes(raw ?? "") ? (raw as CouponSort) : "updatedAt";
}

export type CouponListFilters = {
  status?: CouponStatus;
  type?: CouponType;
  fundedBy?: DiscountFunder;
  appliesTo?: CouponAppliesTo;
};

function pick<T extends string>(values: readonly T[], raw: string | null | undefined): T | undefined {
  return raw && (values as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

export function parseCouponListFilters(params: SearchParams | URLSearchParams): CouponListFilters {
  const get = (key: string) => (params instanceof URLSearchParams ? params.get(key) : one(params, key));
  return {
    status: pick(COUPON_STATUSES, get("status")),
    type: pick(COUPON_TYPES, get("type")),
    fundedBy: pick(DISCOUNT_FUNDERS, get("fundedBy")),
    appliesTo: pick(COUPON_APPLIES_TO, get("appliesTo")),
  };
}

// ---------------------------------------------------------------------------
// Form input
// ---------------------------------------------------------------------------

/** Stored uppercase; letters, digits, hyphen and underscore only. */
export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3, "Codes need at least 3 characters.")
  .max(32, "Keep the code under 32 characters.")
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Use letters, numbers, hyphens and underscores only.");

const idList = z.array(z.string().trim().min(1)).max(500, "That is more than 500 items.").default([]);

const optionalDate = (edge: "start" | "end") =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z
      .string()
      .regex(DATE_INPUT_PATTERN, "Enter a date.")
      .nullable()
      .transform((value) => (value ? (edge === "start" ? istStartOfDay(value) : istEndOfDay(value)) : null)),
  );

const optionalPositiveInt = (label: string) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z
      .number({ error: `${label} must be a whole number.` })
      .int(`${label} must be a whole number.`)
      .min(1, `${label} must be at least 1.`)
      .max(1_000_000)
      .nullable(),
  );

export const couponFormSchema = z
  .object({
    code: couponCodeSchema,
    name: textSchema(120, "Name"),
    description: optionalTextSchema(500),
    isActive: z.boolean().default(true),
    isPublic: z.boolean().default(true),
    fundedBy: discountFunderSchema.default("PLATFORM"),
    type: couponTypeSchema,
    /** Percent points for PERCENT, paise for FIXED, ignored for FREE_SHIPPING. */
    value: z.number({ error: "Enter a value." }).int("Whole numbers only.").min(0),
    maxDiscountPaise: paiseSchema.nullable().default(null),
    minOrderPaise: paiseSchema.nullable().default(null),
    appliesTo: couponAppliesToSchema.default("ALL"),
    categoryIds: idList,
    productIds: idList,
    sellerIds: idList,
    excludedProductIds: idList,
    firstOrderOnly: z.boolean().default(false),
    customerIds: idList,
    usageLimit: optionalPositiveInt("Usage limit"),
    perCustomerLimit: optionalPositiveInt("Per-customer limit"),
    startsAt: optionalDate("start"),
    endsAt: optionalDate("end"),
  })
  .superRefine((value, ctx) => {
    if (value.type === "PERCENT" && (value.value < 1 || value.value > 100)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a percentage between 1 and 100." });
    }
    if (value.type === "FIXED" && value.value < 1) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter an amount greater than zero." });
    }
    if (value.type !== "PERCENT" && value.maxDiscountPaise !== null) {
      ctx.addIssue({ code: "custom", path: ["maxDiscountPaise"], message: "A cap only applies to percentage coupons." });
    }
    if (value.appliesTo === "CATEGORIES" && value.categoryIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["categoryIds"], message: "Choose at least one category." });
    }
    if (value.appliesTo === "PRODUCTS" && value.productIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["productIds"], message: "Choose at least one product." });
    }
    if (value.appliesTo === "SELLERS" && value.sellerIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["sellerIds"], message: "Choose at least one seller." });
    }
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The coupon must end after it starts." });
    }
    if (value.usageLimit !== null && value.perCustomerLimit !== null && value.perCustomerLimit > value.usageLimit) {
      ctx.addIssue({ code: "custom", path: ["perCustomerLimit"], message: "Cannot exceed the total usage limit." });
    }
  })
  .transform((value) => ({
    ...value,
    // FREE_SHIPPING has no value; normalise so the row never carries a stray number.
    value: value.type === "FREE_SHIPPING" ? 0 : value.value,
    maxDiscountPaise: value.type === "PERCENT" ? value.maxDiscountPaise : null,
    // Only the id list for the chosen scope is kept; the others are cleared so
    // switching ALL -> PRODUCTS -> ALL leaves no ghost scope behind.
    categoryIds: value.appliesTo === "CATEGORIES" ? value.categoryIds : [],
    productIds: value.appliesTo === "PRODUCTS" ? value.productIds : [],
    sellerIds: value.appliesTo === "SELLERS" ? value.sellerIds : [],
  }));

export type CouponFormInput = z.input<typeof couponFormSchema>;
export type CouponFormValues = z.output<typeof couponFormSchema>;

export const couponIdSchema = z.string().trim().min(1, "Missing coupon id.");

export const COUPON_BULK_OPS = ["ENABLE", "DISABLE", "DELETE"] as const;
export type CouponBulkOp = (typeof COUPON_BULK_OPS)[number];

export const couponBulkSchema = z.object({
  ids: z
    .array(couponIdSchema)
    .min(1, "Select at least one coupon.")
    .max(500, "Bulk actions are capped at 500 coupons."),
  op: z.enum(COUPON_BULK_OPS),
});
export type CouponBulkInput = z.input<typeof couponBulkSchema>;

// ---------------------------------------------------------------------------
// Read shapes
// ---------------------------------------------------------------------------

export type CouponRow = {
  id: string;
  code: string;
  name: string;
  type: CouponType;
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number | null;
  appliesTo: CouponAppliesTo;
  scopeCount: number;
  /** "All", "3 categories", "Kalakriti Studio" - computed server-side. */
  scopeLabel: string;
  excludedCount: number;
  usageCount: number;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  isPublic: boolean;
  fundedBy: DiscountFunder;
  firstOrderOnly: boolean;
  targetedCustomers: number;
  status: CouponStatus;
  updatedAt: Date;
};

export type CouponEditorData = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: CouponType;
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number | null;
  appliesTo: CouponAppliesTo;
  categories: EntityRef[];
  products: EntityRef[];
  sellers: EntityRef[];
  excludedProducts: EntityRef[];
  customers: EntityRef[];
  firstOrderOnly: boolean;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usageCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  isPublic: boolean;
  fundedBy: DiscountFunder;
  status: CouponStatus;
  createdAt: Date;
  updatedAt: Date;
  createdByEmail: string | null;
  redemptions: number;
  discountGivenPaise: number;
};

export type CouponUsageRow = {
  id: string;
  orderId: string;
  orderNumber: string | null;
  orderStatus: string | null;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  discountPaise: number;
  createdAt: Date;
};

// ---------------------------------------------------------------------------
// Helpers shared by the form and the list
// ---------------------------------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A readable random code: no 0/O or 1/I, 8 characters, optional prefix. */
export function generateCouponCode(prefix = "", length = 8): string {
  let code = "";
  const bytes = new Uint32Array(length);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 0xffffffff);
  }
  for (let i = 0; i < length; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  const clean = prefix.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 12);
  return clean ? `${clean}${code}` : code;
}
