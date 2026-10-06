import { formatPaise } from "@/lib/money";

import { formatIstWindow } from "./dates";

/**
 * One plain-English sentence describing a coupon, shared by the editor's live
 * summary card and the list's tooltip. Pure so the form can rebuild it on every
 * keystroke without a round trip - if the operator reads it and it sounds
 * wrong, the rule is wrong.
 */

export type CouponSummaryInput = {
  type: string;
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number | null;
  appliesTo: string;
  scopeCount: number;
  excludedCount: number;
  firstOrderOnly: boolean;
  targetedCustomers: number;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  fundedBy: string;
  isPublic: boolean;
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function describeDiscount(input: Pick<CouponSummaryInput, "type" | "value" | "maxDiscountPaise">): string {
  switch (input.type) {
    case "PERCENT":
      return input.maxDiscountPaise
        ? `${input.value}% off (up to ${formatPaise(input.maxDiscountPaise)})`
        : `${input.value}% off`;
    case "FIXED":
      return `${formatPaise(input.value)} off`;
    case "FREE_SHIPPING":
      return "Free shipping";
    default:
      return "Discount";
  }
}

export function describeScope(input: Pick<CouponSummaryInput, "appliesTo" | "scopeCount" | "excludedCount">): string {
  const nouns: Record<string, string> = { CATEGORIES: "category", PRODUCTS: "product", SELLERS: "seller" };
  const noun = nouns[input.appliesTo];
  const base = noun
    ? input.appliesTo === "CATEGORIES"
      ? `${plural(input.scopeCount, noun).replace("categorys", "categories")} (including sub-categories)`
      : plural(input.scopeCount, noun)
    : "the whole order";
  const exclusions = input.excludedCount > 0 ? `, excluding ${plural(input.excludedCount, "product")}` : "";
  return `${base}${exclusions}`;
}

export function couponSummary(input: CouponSummaryInput, now: Date = new Date()): string {
  const parts: string[] = [];

  const minimum = input.minOrderPaise ? ` on orders above ${formatPaise(input.minOrderPaise)}` : "";
  parts.push(`${describeDiscount(input)}${minimum} across ${describeScope(input)}.`);

  const window = formatIstWindow(input.startsAt, input.endsAt, now);
  parts.push(window === "always" ? "No start or end date." : `Valid ${window}.`);

  const limits: string[] = [];
  if (input.usageLimit) limits.push(`${plural(input.usageLimit, "use")} in total`);
  if (input.perCustomerLimit) limits.push(`${input.perCustomerLimit} per customer`);
  if (limits.length > 0) parts.push(`Limited to ${limits.join(", ")}.`);

  if (input.targetedCustomers > 0) parts.push(`Only for ${plural(input.targetedCustomers, "selected customer")}.`);
  if (input.firstOrderOnly) parts.push("First order only.");

  parts.push(input.fundedBy === "SELLER" ? "Funded by the sellers of the discounted items." : "Funded by the platform.");
  if (!input.isPublic) parts.push("Private: not listed on the storefront.");

  return parts.join(" ");
}
