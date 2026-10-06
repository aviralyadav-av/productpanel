import { z } from "zod";

import {
  DISCOUNT_FUNDERS,
  PROMOTION_APPLIES_TO,
  PROMOTION_DISCOUNT_TYPES,
  PROMOTION_TYPES,
  discountFunderSchema,
  promotionAppliesToSchema,
  promotionDiscountTypeSchema,
  promotionTypeSchema,
  type BadgeTone,
  type CouponAppliesTo,
  type DiscountFunder,
  type PromotionDiscountType,
  type PromotionType,
} from "@/lib/enums";
import type { SearchParams } from "@/lib/list-params";
import { one } from "@/lib/list-params";
import { optionalTextSchema, slugSchema, textSchema } from "@/lib/validation";
import type { EntityRef } from "@/components/shared/entity-picker";
import type { PickedAsset } from "@/components/shared/media-picker";

import { DATE_INPUT_PATTERN, istEndOfDay, istStartOfDay } from "@/features/coupons/dates";

/**
 * Promotions contract (blueprint §4.7, §14.A4, B2, B3). A promotion is a
 * scheduled price rule over a scope; the catalog's `recomputeProductPricing`
 * turns it into `Product.promotionPricePaise`, so the storefront shows the
 * lower of sale and promotion and never stacks them (§11.6).
 *
 * The derived status vocabulary is local: `enums.ts` is frozen and coupons'
 * EXHAUSTED does not apply here.
 */

export const PROMOTION_STATUSES = ["ACTIVE", "SCHEDULED", "EXPIRED", "DISABLED"] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

export const PROMOTION_STATUS_META: Record<PromotionStatus, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: "Live", tone: "success" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  EXPIRED: { label: "Ended", tone: "neutral" },
  DISABLED: { label: "Disabled", tone: "neutral" },
};

export function derivePromotionStatus(
  row: { isActive: boolean; startsAt: Date; endsAt: Date },
  now: Date = new Date(),
): PromotionStatus {
  if (!row.isActive) return "DISABLED";
  if (row.startsAt > now) return "SCHEDULED";
  if (row.endsAt < now) return "EXPIRED";
  return "ACTIVE";
}

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

export const PROMOTION_SORTS = ["name", "type", "value", "priority", "startsAt", "endsAt", "updatedAt"] as const;
export type PromotionSort = (typeof PROMOTION_SORTS)[number];

export function resolvePromotionSort(raw: string | undefined): PromotionSort {
  return (PROMOTION_SORTS as readonly string[]).includes(raw ?? "") ? (raw as PromotionSort) : "startsAt";
}

export type PromotionListFilters = {
  status?: PromotionStatus;
  type?: PromotionType;
  fundedBy?: DiscountFunder;
};

function pick<T extends string>(values: readonly T[], raw: string | null | undefined): T | undefined {
  return raw && (values as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

export function parsePromotionListFilters(params: SearchParams | URLSearchParams): PromotionListFilters {
  const get = (key: string) => (params instanceof URLSearchParams ? params.get(key) : one(params, key));
  return {
    status: pick(PROMOTION_STATUSES, get("status")),
    type: pick(PROMOTION_TYPES, get("type")),
    fundedBy: pick(DISCOUNT_FUNDERS, get("fundedBy")),
  };
}

// ---------------------------------------------------------------------------
// Form input
// ---------------------------------------------------------------------------

const idList = z.array(z.string().trim().min(1)).max(500, "That is more than 500 items.").default([]);

const requiredDate = (edge: "start" | "end") =>
  z
    .string({ error: "Enter a date." })
    .regex(DATE_INPUT_PATTERN, "Enter a date.")
    .transform((value) => (edge === "start" ? istStartOfDay(value) : istEndOfDay(value)));

export const promotionFormSchema = z
  .object({
    name: textSchema(120, "Name"),
    slug: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), slugSchema.optional()),
    description: optionalTextSchema(500),
    type: promotionTypeSchema.default("SALE"),
    discountType: promotionDiscountTypeSchema.default("PERCENT"),
    /** Percent points for PERCENT, paise for FIXED. */
    value: z.number({ error: "Enter a value." }).int("Whole numbers only.").min(1, "Enter a value greater than zero."),
    appliesTo: promotionAppliesToSchema.default("ALL"),
    categoryIds: idList,
    productIds: idList,
    sellerIds: idList,
    badgeText: optionalTextSchema(40),
    bannerMediaId: z.string().trim().min(1).nullable().default(null),
    priority: z.number().int().min(-1000).max(1000).default(0),
    startsAt: requiredDate("start"),
    endsAt: requiredDate("end"),
    isActive: z.boolean().default(true),
    fundedBy: discountFunderSchema.default("PLATFORM"),
  })
  .superRefine((value, ctx) => {
    if (value.discountType === "PERCENT" && value.value > 100) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a percentage between 1 and 100." });
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
    if (value.endsAt <= value.startsAt) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The promotion must end after it starts." });
    }
  })
  .transform((value) => ({
    ...value,
    categoryIds: value.appliesTo === "CATEGORIES" ? value.categoryIds : [],
    productIds: value.appliesTo === "PRODUCTS" ? value.productIds : [],
    sellerIds: value.appliesTo === "SELLERS" ? value.sellerIds : [],
  }));

export type PromotionFormInput = z.input<typeof promotionFormSchema>;
export type PromotionFormValues = z.output<typeof promotionFormSchema>;

export const promotionIdSchema = z.string().trim().min(1, "Missing promotion id.");

// ---------------------------------------------------------------------------
// Read shapes
// ---------------------------------------------------------------------------

export type PromotionRow = {
  id: string;
  name: string;
  slug: string;
  type: PromotionType;
  discountType: PromotionDiscountType;
  value: number;
  appliesTo: CouponAppliesTo;
  scopeCount: number;
  scopeLabel: string;
  badgeText: string | null;
  priority: number;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  fundedBy: DiscountFunder;
  status: PromotionStatus;
  /** Products currently carrying this promotion as their active one (A4). */
  affectedProducts: number;
  updatedAt: Date;
};

export type PromotionEditorData = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  type: PromotionType;
  discountType: PromotionDiscountType;
  value: number;
  appliesTo: CouponAppliesTo;
  categories: EntityRef[];
  products: EntityRef[];
  sellers: EntityRef[];
  badgeText: string | null;
  bannerMedia: PickedAsset | null;
  priority: number;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  fundedBy: DiscountFunder;
  status: PromotionStatus;
  affectedProducts: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AffectedProductRow = {
  id: string;
  title: string;
  slug: string;
  status: string;
  imageUrl: string | null;
  sellerName: string | null;
  pricePaise: number;
  effectivePricePaise: number;
  promotionPricePaise: number | null;
  /** True when this promotion is the one actually winning on the product. */
  applied: boolean;
  outrankedBy: string | null;
};

/** Discount label shared by list, form and affected-products table. */
export function describePromotionDiscount(input: { discountType: string; value: number }, formatPaise: (paise: number) => string): string {
  return input.discountType === "PERCENT" ? `${input.value}% off` : `${formatPaise(input.value)} off`;
}

export { PROMOTION_APPLIES_TO, PROMOTION_DISCOUNT_TYPES, PROMOTION_TYPES };
